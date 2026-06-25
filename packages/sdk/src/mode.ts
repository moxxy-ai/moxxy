import type { CacheStrategyDef } from './cache-strategy.js';
import type { CompactorDef } from './compactor.js';
import type { EmittedEvent, MoxxyEvent } from './events.js';
import type { HookDispatcher } from './hooks.js';
import type { ServiceRegistry } from './services.js';
import type { SessionId, TurnId } from './ids.js';
import type { EventLogReader } from './log.js';
import type { PermissionResolver } from './permission.js';
import type { LLMProvider } from './provider.js';
import type { Skill } from './skill.js';
import type { SubagentSpawner } from './subagent.js';
import type { ToolDef } from './tool.js';

export interface ToolRegistry {
  list(): ReadonlyArray<ToolDef>;
  get(name: string): ToolDef | undefined;
  execute(name: string, input: unknown, signal: AbortSignal, opts?: ToolExecuteOpts): Promise<unknown>;
}

export interface ToolExecuteOpts {
  readonly callId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly log?: EventLogReader;
  readonly cwd?: string;
}

export interface SkillRegistry {
  list(): ReadonlyArray<Skill>;
  get(id: string): Skill | undefined;
  byName(name: string): Skill | undefined;
  filterByTriggers(prompt: string): ReadonlyArray<Skill>;
}

export interface PluginHostHandle {
  list(): ReadonlyArray<{
    name: string;
    version: string;
    loaded: boolean;
    /**
     * Contribution categories the plugin registered (e.g. `['provider']`,
     * `['tool','command']`). Lets a UI group plugins by kind. Optional so a
     * thin-client `RemoteSession` can omit it.
     */
    kinds?: ReadonlyArray<string>;
  }>;
  reload(): Promise<void>;
}

/**
 * Turn-boundary elision (context-on-demand) settings, resolved from config and
 * carried on the ModeContext. All fields optional; {@link runElisionIfNeeded}
 * applies defaults and floors (e.g. keepRecentTurns is floored at 2).
 */
export interface ElisionSettings {
  readonly enabled?: boolean;
  readonly keepRecentTurns?: number;
  readonly minContextRatioToElide?: number;
  readonly elideConversational?: boolean;
  readonly conversationalRecallThreshold?: number;
  readonly maxRecallBytes?: number;
  readonly neverElideTools?: ReadonlyArray<string>;
}

export interface ModeContext {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  /**
   * The session's working directory and environment, mirrored from
   * {@link AppContext}. Threaded into the `dispatchToolCall` hook context so
   * `onToolCall` hooks that gate on cwd/env (path-based policy/security hooks)
   * see the real per-session values rather than empty placeholders. Tools
   * themselves get cwd via the tool registry's default; this carries the same
   * truth to the hook layer so the two never disagree.
   */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly model: string;
  readonly systemPrompt?: string;
  readonly provider: LLMProvider;
  readonly tools: ToolRegistry;
  readonly skills: SkillRegistry;
  readonly log: EventLogReader;
  readonly compactor: CompactorDef | null;
  /** Active prompt-caching strategy (or null when none is registered). */
  readonly cacheStrategy: CacheStrategyDef | null;
  /** Elision (context-on-demand) settings; undefined → defaults apply. */
  readonly elision?: ElisionSettings;
  /** When true, send only always-on + loaded tool schemas; index the rest. */
  readonly lazyTools?: boolean;
  /**
   * Per-provider reasoning/thinking preference, resolved from the active
   * provider's config at session build. Forwarded to the provider as
   * `ProviderRequest.reasoning` by {@link collectProviderStream}, gated on the
   * active model's `supportsReasoning`. Absent/false → reasoning off.
   */
  readonly reasoning?: { readonly effort?: 'low' | 'medium' | 'high' } | boolean;
  readonly permissions: PermissionResolver;
  /**
   * Optional generic "ask the user a question" gate. Any loop strategy can
   * call this to surface a checkpoint to the user — plan-execute uses it
   * after producing a plan, but a code-execution loop could use it for
   * "run this command?" or a refactor loop for "apply this diff?". When
   * absent (headless / non-TTY), strategies should proceed as if the user
   * picked the default option, or fail closed depending on the strategy.
   */
  readonly approval?: ApprovalResolver;
  readonly hooks: HookDispatcher;
  readonly pluginHost: PluginHostHandle;
  /** Inter-plugin service registry (mirrors {@link AppContext.services}). */
  readonly services: ServiceRegistry;
  readonly signal: AbortSignal;
  readonly maxIterations?: number;
  /**
   * Spawn one or more child agents that share the parent's registries
   * but run in isolation. Children stream their events back to the
   * parent log as `plugin_event` records with `subagent_*` subtypes.
   * Absent in synthetic test contexts that don't model a full Session.
   */
  readonly subagents?: SubagentSpawner;
  /**
   * Request the session switch its active mode AFTER this turn fully drains.
   * Used by terminal workflow modes (BMAD finishing its last phase) to hand
   * control back to a normal mode so the next message isn't trapped in the
   * workflow. The switch is applied post-turn by the runner; an unknown /
   * unregistered mode name is ignored. Absent in synthetic test contexts.
   */
  readonly requestModeSwitch?: (modeName: string) => void;
  emit(event: EmittedEvent): Promise<MoxxyEvent>;
}

/**
 * Generic approval-dialog request. The TUI renders `title` as the header,
 * `body` as a verbatim block (plan text, diff, command preview, etc.), and
 * a single-select list of `options`. An option may set `requestsText` so
 * the dialog prompts for follow-up text after selection (e.g. redraft
 * feedback). `kind` is a loose tag the dialog/CLI can use for styling.
 */
export interface ApprovalRequest {
  readonly title: string;
  readonly body: string;
  readonly options: ReadonlyArray<ApprovalOption>;
  readonly defaultOptionId?: string;
  readonly kind?: string;
}

export interface ApprovalOption {
  readonly id: string;
  readonly label: string;
  readonly hotkey?: string;
  readonly description?: string;
  readonly requestsText?: boolean;
  readonly textPrompt?: string;
  readonly danger?: boolean;
}

export interface ApprovalDecision {
  readonly optionId: string;
  /** Free-text follow-up the user typed when the option had `requestsText: true`. */
  readonly text?: string;
}

export interface ApprovalResolver {
  readonly name: string;
  confirm(req: ApprovalRequest): Promise<ApprovalDecision>;
}

/**
 * Optional presentation hint a mode can advertise so channels render a
 * persistent, accent-coloured badge while it is active — even mid-run,
 * when the usual mode footer is hidden behind a "Thinking" marker. This
 * lets a high-autonomy mode (e.g. goal mode, which auto-approves tools and
 * keeps working unattended) always be obvious to the user. Modes that omit
 * it get the plain `mode: <name>` footer treatment.
 *
 * Carried on {@link SessionInfo.activeModeBadge} so thin clients (desktop
 * over RPC) see it too — keep it plain data (it crosses the wire).
 */
export interface ModeBadge {
  /** Short, uppercase label for the badge (e.g. "GOAL"). Keep it tiny. */
  readonly label: string;
  /**
   * Accent tone each channel maps to its palette. `attention` for
   * elevated / autonomous modes the user must always notice; `info` for a
   * quieter highlight. Defaults to `info` when omitted.
   */
  readonly tone?: 'attention' | 'info';
}

export interface ModeDef {
  readonly name: string;
  /**
   * One-line summary of what this mode does. Rendered next to the mode
   * name in the TUI /mode picker so users have context without
   * memorising plugin internals. Keep short — the picker truncates.
   */
  readonly description?: string;
  /**
   * Optional presentation hint. When set, channels surface a persistent
   * accent badge while this mode is active. See {@link ModeBadge}.
   */
  readonly badge?: ModeBadge;
  run(ctx: ModeContext): AsyncIterable<MoxxyEvent>;
}

/**
 * Legacy mode-name → current-name map for backward compatibility. Modes were
 * renamed/slimmed: `tool-use`→`default`, `deep-research`→`research`, and the
 * removed `plan-execute`/`bmad`/`developer` modes fall back to `default`. Any
 * mode name arriving from persisted or external state — config files,
 * `~/.moxxy/preferences.json`, a desktop workspace's stored mode, a runner
 * `setMode` RPC — is funneled through {@link migrateModeName} so an old name
 * resolves to the current one instead of crashing with "Mode not registered".
 */
const LEGACY_MODE_NAMES: Readonly<Record<string, string>> = {
  'tool-use': 'default',
  'deep-research': 'research',
  'plan-execute': 'default',
  bmad: 'default',
  developer: 'default',
};

/** Map a possibly-legacy mode name to its current name (identity if unknown). */
export function migrateModeName(name: string): string {
  // Own-property check: `name` is externally-sourced (config / preferences /
  // setMode RPC). A bare `LEGACY_MODE_NAMES[name]` index would resolve inherited
  // Object.prototype members (`toString`, `constructor`, `__proto__`, …) — all
  // truthy Functions, so `?? name` would NOT fall through and the function would
  // return a Function, breaking its `string` contract and shadowing a mode
  // legitimately named `toString`.
  return Object.hasOwn(LEGACY_MODE_NAMES, name) ? LEGACY_MODE_NAMES[name]! : name;
}
