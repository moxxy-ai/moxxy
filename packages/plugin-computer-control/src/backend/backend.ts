import { defineTool, zodToJsonSchema, type LifecycleHooks, type SurfaceDef, type ToolContext, type ToolDef, type ToolImageResult } from '@moxxy/sdk';
import { z } from 'zod';
import { withComputerGuidance } from '../contract/guidance.js';
import { parseKeyCombo, type KeyPlatform } from '../contract/keys.js';
import { ComputerUseError, describeResult, isErrorCode, type ActionResult } from '../contract/outcome.js';
import { ProgressTracker, fingerprint } from '../contract/progress.js';
import { computerTools, type ComputerAction } from '../contract/tools.js';
import { diffTrees, formatTree, type AppTree, type TreeView } from '../contract/tree.js';
import { wrapUntrusted } from '../contract/untrusted.js';
import { controlStateSchemaFor } from '../helper/protocol.js';
import { HelperError, HelperTransport } from '../helper/transport.js';
import {
  accessFromLog, accessGrantSchema, categorize, checkAccess, checkKeys, defaultTier, maxTier, requiredTier,
  type AccessGrant, type AccessTier, type AppGrant,
} from './access.js';
import { hintFor, loadAppHints, type AppHint } from './app-hints.js';
import {
  actResultSchema, appStateSchema, contractEventsFor, imageSchema, listAppsResultSchema, resolveAppsResultSchema, statusResultSchema,
  type AppState, type HelperImage,
} from './rpc.js';
import { PreviewController, type PreviewCodec, type PreviewSource } from '../preview/controller.js';
import { buildComputerPreviewSurface } from '../preview/surface.js';
import { TurnControls } from './turn-controls.js';

/** Everything platform-specific the shared backend needs: which helper to start and which key rules apply. */
export interface PlatformProfile {
  readonly platform: KeyPlatform;
  readonly protocolVersion: number;
  readonly helperPath: string;
  readonly helperArgs: readonly string[];
  readonly verifyHelper: () => Promise<void>;
  readonly unavailableMessage: string;
  readonly timeoutMs?: number;
  /** What the helper's live preview can produce; JPEG frames only when absent. */
  readonly previewCodecs?: readonly PreviewCodec[];
}

interface Turn {
  readonly sessionId: string;
  readonly turnId: string;
  readonly transport: HelperTransport;
  /** Last tree the model saw per app; indices belong to this helper, so the map dies with it. */
  readonly trees: Map<string, AppTree>;
  /** What the model last saw of each app, to notice an action that changed nothing. */
  readonly seen: Map<string, string>;
  readonly progress: ProgressTracker;
  /** Apps whose hint the model has already been shown in this turn. */
  readonly hinted: Set<string>;
  dispose(): void;
}

type ToolName = keyof typeof computerTools;
type Input<N extends ToolName> = z.output<(typeof computerTools)[N]['input']>;
type Handlers = { readonly [N in ToolName]: (input: Input<N>, ctx: ToolContext) => Promise<unknown> };

const turnKey = (sessionId: string, turnId: string) => JSON.stringify([sessionId, turnId]);

function withImage(text: string, image: HelperImage | undefined): string | ToolImageResult {
  return image ? { mediaType: image.mediaType, base64: image.base64, forModel: text } : text;
}

/** Long enough for an app to read the gesture as a drag, not a click. */
const DRAG_MS = 600;

/** Tools that only look: the same call between actions is how the agent watches an app. */
const LOOKING: ReadonlySet<string> = new Set(['computer_status', 'computer_list_apps', 'computer_get_app_state', 'computer_zoom']);

/** Helpers get chords from the one xdotool parser instead of parsing key syntax themselves, and a drag as a path. */
function forHelper(step: ComputerAction): Record<string, unknown> {
  if (step.action === 'drag') {
    return { action: 'drag', path: [[step.from_x, step.from_y], [step.to_x, step.to_y]], duration_ms: DRAG_MS, mouse_button: 'left' };
  }
  const fields: Record<string, unknown> = { ...step };
  if (typeof fields.key === 'string') fields.chord = parseKeyCombo(fields.key);
  if (typeof fields.modifiers === 'string') fields.held = parseKeyCombo(fields.modifiers).modifiers;
  return fields;
}

/** A coded helper refusal becomes a Computer Use error carrying the model's next step. */
function asComputerUseError(error: unknown): unknown {
  return error instanceof HelperError && isErrorCode(error.code) ? new ComputerUseError(error.code, error.detail) : error;
}

/** The Codex/Claude-style tool set on top of one disposable native helper per session turn. */
export class ComputerBackend {
  private readonly turns = new Map<string, Turn>();
  readonly controls = new TurnControls();
  /** The human's live picture of the app in use; frames never reach the model or the session log. */
  readonly preview = new PreviewController();

  readonly hooks: LifecycleHooks;

  constructor(private readonly profile: PlatformProfile, private readonly hints: ReadonlyArray<AppHint> = loadAppHints()) {
    this.hooks = {
      onBeforeProviderCall: withComputerGuidance(profile.platform),
      onInit: (ctx) => { ctx.services.register('computerControl', this.controls.forSession(ctx.sessionId)); },
      onTurnEnd: (ctx) => this.release(ctx.sessionId, ctx.turnId),
      onShutdown: (ctx) => this.release(ctx.sessionId),
    };
  }

  surfaces(): SurfaceDef[] {
    return [buildComputerPreviewSurface(this.preview)];
  }

  tools(): ToolDef[] {
    return (Object.keys(computerTools) as ToolName[]).map((name) => {
      const { description, input } = computerTools[name];
      const handler = this.handlers[name] as (input: unknown, ctx: ToolContext) => Promise<unknown>;
      return defineTool({
        name, description, inputSchema: input,
        inputJsonSchema: zodToJsonSchema(input),
        permission: { action: 'prompt' }, icon: 'workspace',
        ...(LOOKING.has(name) ? { liveState: true } : {}),
        isolation: { capabilities: { subprocess: true, commands: [this.profile.helperPath], net: { mode: 'none' } } },
        handler,
      });
    });
  }

  async release(sessionId: string, turnId?: string): Promise<void> {
    const closing: Promise<void>[] = [];
    for (const [key, turn] of this.turns) {
      if (turn.sessionId !== sessionId || (turnId !== undefined && key !== turnKey(sessionId, turnId))) continue;
      this.turns.delete(key);
      turn.dispose();
      closing.push(turn.transport.close());
      this.controls.detach(turn.sessionId, turn.turnId);
    }
    await Promise.all(closing);
  }

  private readonly handlers: Handlers = {
    computer_status: async (input, ctx) => {
      const { turn, result } = await this.call(ctx, 'status', {}, statusResultSchema);
      // A model fills this optional field even when nothing is missing; a pane is opened only for a missing permission.
      const missing = input.open_settings === 'accessibility' ? !result.permissions.accessibility : !result.permissions.screenRecording;
      if (!input.open_settings || !missing) return { platform: this.profile.platform, ...result };
      const opened = z.object({ opened: z.boolean() }).parse(await turn.transport.request('permissions.request', { kind: input.open_settings }, ctx.signal));
      return { platform: this.profile.platform, ...result, settings_opened: opened.opened };
    },
    computer_list_apps: async (input, ctx) => {
      const { result } = await this.call(ctx, 'list_apps', input, listAppsResultSchema);
      const granted = new Map(accessFromLog(ctx.log).apps.map((app) => [app.id, app.tier]));
      return { ...result, apps: result.apps.map((app) => ({ ...app, ...(granted.has(app.id) ? { access: granted.get(app.id) } : {}) })) };
    },
    computer_request_access: async (input, ctx) => {
      const { result } = await this.call(ctx, 'resolve_apps', { names: input.apps }, resolveAppsResultSchema);
      const elevated = new Set((input.full_access ?? []).map((name) => name.toLowerCase()));
      const granted = new Map<string, AppGrant>();
      const unresolved: AccessGrant['unresolved'] = [];
      for (const app of result.apps) {
        if (app.status === 'not_found') { unresolved.push({ app: app.request, reason: 'not_found' }); continue; }
        if (app.status === 'ambiguous') { unresolved.push({ app: app.request, reason: 'ambiguous', candidates: app.candidates }); continue; }
        const tier: AccessTier = elevated.has(app.request.toLowerCase()) ? 'full' : defaultTier(categorize(app));
        const previous = granted.get(app.id);
        granted.set(app.id, { id: app.id, name: app.name, tier: previous ? maxTier(previous.tier, tier) : tier });
      }
      return accessGrantSchema.parse({
        kind: 'computer_access', granted: [...granted.values()], unresolved,
        clipboard_read: input.clipboard_read ?? false, clipboard_write: input.clipboard_write ?? false,
        system_key_combos: input.system_key_combos ?? false,
      });
    },
    computer_get_app_state: async (input, ctx) => {
      const grant = checkAccess(accessFromLog(ctx.log), input.app, 'read');
      const web = categorize(grant) === 'browser' ? { web: true } : {};
      const params = { app: grant.id, ...(input.window_id ? { window_id: input.window_id } : {}), screenshot: true, ...web };
      const { turn, result } = await this.call(ctx, 'get_app_state', params, appStateSchema, grant.name);
      return this.present(turn, grant, result, [], input.disable_diff);
    },
    computer_click: (input, ctx) => this.act(input, 'click', ctx),
    computer_type_text: (input, ctx) => this.act(input, 'type_text', ctx),
    computer_press_key: (input, ctx) => this.act(input, 'press_key', ctx),
    computer_scroll: (input, ctx) => this.act(input, 'scroll', ctx),
    computer_drag: (input, ctx) => this.act(input, 'drag', ctx),
    computer_set_value: (input, ctx) => this.act(input, 'set_value', ctx),
    computer_perform_secondary_action: (input, ctx) => this.act(input, 'perform_secondary_action', ctx),
    computer_zoom: async (input, ctx) => {
      const access = accessFromLog(ctx.log);
      const grant = checkAccess(access, input.app, 'read');
      const params = { region: input.region, app: grant.id, allowed: access.apps.map((app) => app.id) };
      const { result } = await this.call(ctx, 'zoom', params, imageSchema, grant.name);
      return withImage(`Zoomed region [${input.region.join(', ')}] at ${result.width}x${result.height}. Reading aid only: coordinates keep referring to the screenshot, never to this image.`, result);
    },
  };

  private async act(input: { app: string } & Record<string, unknown>, action: ComputerAction['action'], ctx: ToolContext): Promise<unknown> {
    const { app, ...fields } = input;
    const step = { action, ...fields } as ComputerAction;
    const access = accessFromLog(ctx.log);
    const grant = checkAccess(access, app, requiredTier(step));
    checkKeys(step, access.flags, this.profile.platform);
    const params = { app: grant.id, action: forHelper(step), allowed: access.apps.map((granted) => granted.id) };
    const signature = JSON.stringify(step);
    (await this.turn(ctx)).progress.check(grant.id, signature);
    const { turn, result } = await this.call(ctx, 'act', params, actResultSchema, grant.name);
    const { state } = result;
    if (!state) return describeResult(result.result);
    const [outcome, note] = this.judge(turn, grant.id, signature, result.result, state);
    return this.present(turn, grant, state, [describeResult(outcome), ...note]);
  }

  /** A delivered action that leaves the app looking the same twice in a row did not work: say so. */
  private judge(turn: Turn, app: string, signature: string, result: ActionResult, state: AppState): [ActionResult, string[]] {
    if (result.outcome === 'ineffective') {
      // The helper saw no change itself: that counts toward the limit like an unchanged state.
      turn.progress.record(app, signature, false);
      return [result, []];
    }
    if (result.outcome !== 'delivered') {
      turn.progress.forget(app);
      return [result, []];
    }
    const before = turn.seen.get(app);
    const unchanged = turn.progress.record(app, signature, before === undefined || before !== fingerprint(state.tree, state.screenshot));
    if (unchanged >= 2) return [{ outcome: 'ineffective', code: 'no_progress' }, []];
    return [result, unchanged === 1 ? ['Nothing visible changed after this action: the tree and screenshot are the same as before it.'] : []];
  }

  private present(turn: Turn, grant: AppGrant, state: AppState, prefix: string[], disableDiff = false): string | ToolImageResult {
    this.controls.target(turn.sessionId, turn.turnId, { app: grant.name, window: state.tree.window ?? null });
    const view: TreeView = disableDiff ? { kind: 'full', text: formatTree(state.tree) } : diffTrees(turn.trees.get(grant.id), state.tree);
    turn.trees.set(grant.id, state.tree);
    turn.seen.set(grant.id, fingerprint(state.tree, state.screenshot));
    const hint = turn.hinted.has(grant.id) ? undefined : hintFor(this.hints, grant);
    turn.hinted.add(grant.id);
    const parts = [...prefix, ...(hint ? [`Notes for ${grant.name}:\n${hint}`] : []), wrapUntrusted(view.text, grant.name)];
    if (state.screenshot) parts.push(`Screenshot ${state.screenshot.width}x${state.screenshot.height}: x and y in actions are pixels of this image.`);
    else if (state.screenshotUnavailable) parts.push(`No screenshot: ${state.screenshotUnavailable}`);
    if (state.contentPending) parts.push('The page content is not readable yet (still loading, or the window is hidden): look again before you report what the page says.');
    return withImage(parts.join('\n\n'), state.screenshot);
  }

  private async call<T>(ctx: ToolContext, method: string, params: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>, target?: string): Promise<{ turn: Turn; result: T }> {
    const turn = await this.turn(ctx);
    this.controls.activity(ctx.sessionId, ctx.turnId, 'recovering', target);
    let raw: unknown;
    try {
      raw = await turn.transport.request(method, params, ctx.signal);
    } catch (error) {
      throw asComputerUseError(error);
    } finally {
      this.controls.activity(ctx.sessionId, ctx.turnId, 'idle');
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      const where = issue ? ` (${issue.path.join('.')}: ${issue.message})` : '';
      throw new ComputerUseError('helper_failed', `The helper returned an invalid ${method} result${where}`);
    }
    return { turn, result: parsed.data };
  }

  private async turn(ctx: ToolContext): Promise<Turn> {
    ctx.signal.throwIfAborted();
    const key = turnKey(ctx.sessionId, ctx.turnId);
    const previous = this.turns.get(key);
    if (previous && !previous.transport.closed) return previous;
    if (previous) throw new Error('Computer Use stopped for this turn. Start a new turn to regain control and observe again.');
    try { await this.profile.verifyHelper(); } catch { throw new Error(this.profile.unavailableMessage); }
    ctx.signal.throwIfAborted();
    // No await between the final lookup and registration: parallel calls share one child.
    const existing = this.turns.get(key);
    if (existing) return existing;
    const controlState = controlStateSchemaFor(this.profile.protocolVersion);
    const events = contractEventsFor(this.profile.protocolVersion);
    // Preview requests carry a signal that never aborts: an aborted request ends the helper.
    const idle = new AbortController().signal;
    const source: PreviewSource = {
      codecs: this.profile.previewCodecs ?? ['jpeg'],
      // A helper that only makes pictures does not know the `codec` field.
      start: async (fps, codec) => { await transport.request('preview.start', codec === 'jpeg' ? { fps } : { fps, codec }, idle); },
      stop: async () => { if (!transport.closed) await transport.request('preview.stop', {}, idle); },
      keyframe: async () => { if (!transport.closed) await transport.request('preview.keyframe', {}, idle); },
    };
    const transport: HelperTransport = new HelperTransport(this.profile.helperPath, [...this.profile.helperArgs, '--parent', String(process.pid)], {
      protocolVersion: this.profile.protocolVersion,
      timeoutMs: this.profile.timeoutMs ?? 15_000,
      events,
      onEvent: (event) => {
        if (event.event === 'control_state') this.controls.update(ctx.sessionId, ctx.turnId, controlState.parse(event).state);
        else if (event.event === 'cursor') this.controls.cursor(ctx.sessionId, ctx.turnId, events.cursor.parse(event).cursor);
        else if (event.event === 'preview_frame') {
          const frame = events.preview_frame.parse(event);
          if (frame.error) this.preview.failed(source, frame.error);
          else this.preview.frame(source, frame.image);
        } else if (event.event === 'preview_chunk') {
          const { version: _version, event: _event, ...chunk } = events.preview_chunk.parse(event);
          this.preview.chunk(source, chunk);
        }
      },
    });
    const abort = () => { void this.release(ctx.sessionId, ctx.turnId); };
    ctx.signal.addEventListener('abort', abort, { once: true });
    const detachPreview = this.preview.attach(source);
    // A helper that stopped or died has no picture to show any more.
    void transport.done.then(detachPreview);
    const turn: Turn = {
      sessionId: ctx.sessionId, turnId: ctx.turnId, transport, trees: new Map(), seen: new Map(), progress: new ProgressTracker(), hinted: new Set(),
      dispose: () => { ctx.signal.removeEventListener('abort', abort); detachPreview(); },
    };
    this.turns.set(key, turn);
    this.controls.attach(ctx.sessionId, ctx.turnId, transport);
    return turn;
  }
}
