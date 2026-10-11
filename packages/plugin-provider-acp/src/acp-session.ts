import { createRequire } from 'node:module';
import type { Readable, Writable } from 'node:stream';
import type { AgentApprovalDecision, AgentStepEvent, AgentStepRequest, AgentToolCall, AgentToolOutcome, ToolDef } from '@moxxy/sdk';
import {
  Inbox,
  JsonRpcError,
  JsonRpcLineClient,
  agentModeFor,
  moxxyToolsHandler,
  startMoxxyMcpServer,
  untilStopped,
  type AgentMode,
  type LiveSession,
  type MoxxyMcpServer,
} from '@moxxy/agent-connection-kit';
import type { AcpAgentSpec } from './agents.js';
import {
  ACP_PROTOCOL_VERSION,
  type AcpConfigOption,
  type AcpContentBlock,
  type AcpPermissionOutcome,
  type AcpPermissionRequest,
  type AcpPromptResponse,
  type AcpSessionResponse,
  type AcpSessionUpdate,
} from './protocol.js';
import { AcpTurnTranslator, toAcpPrompt, toTokenUsage, type AcpShownCall } from './translate.js';
import { askingConfig, runsWithoutAsking, type OpenCodeRule, type ReadAgentRules } from './rules.js';

/** A running ACP agent (`opencode acp`): its stdout, stdin and stderr. */
export interface AcpConnection {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly stderr?: Readable;
  close(): void;
}

export type StartAcpAgent = (opts: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> }) => Promise<AcpConnection>;

export interface AcpSessionSettings {
  readonly agent: AcpAgentSpec;
  readonly start: StartAcpAgent;
  readonly cwd: string;
  /** The conversation's agent session from an earlier process, to load. */
  readonly resume?: string;
  /** How the person's agent runs; without it Moxxy leaves the agent's own rules and the conversation's auto-approve alone. */
  readonly readRules?: ReadAgentRules;
}

type RequestItem = {
  readonly kind: 'request';
  readonly method: string;
  readonly params: unknown;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
};

type Item =
  | { readonly kind: 'note'; readonly params: unknown }
  | RequestItem
  | { readonly kind: 'moxxy-tool'; readonly call: AgentToolCall; readonly resolve: (outcome: AgentToolOutcome) => void }
  | { readonly kind: 'done'; readonly result: AcpPromptResponse }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'stop' }
  | { readonly kind: 'ended' };

const MAX_STDERR = 2048;
const MAX_DECLINE_FOLLOW_UPS = 3;
const STOPPED: AgentApprovalDecision = { allow: false, reason: 'The person stopped the turn.' };
const CANCELLED: AcpPermissionOutcome = { outcome: { outcome: 'cancelled' } };
const PLAN_MODE = 'plan';
const BUILD_MODE = 'build';
const SIGN_IN_EXPIRED = /token refresh failed|\b401\b|unauthori[sz]ed/i;
const CONFIG_CONTENT_ENV = 'OPENCODE_CONFIG_CONTENT';
const CLIENT_VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

export const CLIENT_CAPABILITIES = { fs: { readTextFile: false, writeTextFile: false }, terminal: false } as const;

/** Moxxy tools the agent lacks, lent over MCP for this turn. */
export function toolsLentTo(agent: AcpAgentSpec, tools: ReadonlyArray<ToolDef>): ToolDef[] {
  return tools.filter((tool) => !agent.ownTools.has(tool.name) && !tool.name.startsWith('memory_'));
}

/**
 * One running ACP agent with one session for one Moxxy conversation. Every
 * message the person sends is the next prompt of the same session, so the
 * agent keeps its context between turns. The agent's notifications, its
 * permission asks and Moxxy tool calls over MCP are queued together and
 * handled in order, so the log shows a call before the decision about it.
 */
export class AcpAgentSession implements LiveSession {
  private readonly inbox = new Inbox<Item>();
  private client: JsonRpcLineClient;
  private connection: AcpConnection;
  /** A replacement agent is loading the session: what it replays is history. */
  private loading = false;
  private alive = true;
  private closed = false;
  private inTurn = false;
  private sessionId = '';
  private options: ReadonlyArray<AcpConfigOption> = [];
  /** The agent mode the person's setup starts in, restored after plan mode. */
  private ownMode = BUILD_MODE;
  /** Why the person declined, for the next message when the turn ended first. */
  private pendingNotes: string[] = [];
  private stderr = '';
  /** No turn has shown the conversation yet how the agent runs. */
  private fresh = true;
  /** The agent's own rules, once read; `null` when it cannot say. */
  private ownRules: ReadonlyArray<OpenCodeRule> | null | undefined;
  /** This agent was started to ask before what its own rules allow. */
  private asking = false;
  /** Whether Moxxy answers the agent's asks for the person in this turn. */
  private autoApprove = false;

  static async start(settings: AcpSessionSettings): Promise<AcpAgentSession> {
    const mcp = await startMoxxyMcpServer({ name: settings.agent.mcpServerName });
    let session: AcpAgentSession | undefined;
    try {
      session = new AcpAgentSession(settings, mcp, await settings.start({ cwd: settings.cwd }));
      await session.open();
      return session;
    } catch (err) {
      if (session) await session.close();
      else await mcp.close();
      throw err;
    }
  }

  private constructor(
    readonly settings: AcpSessionSettings,
    private readonly mcp: MoxxyMcpServer,
    connection: AcpConnection,
  ) {
    this.connection = connection;
    this.client = this.listen(connection);
  }

  /** The client for a running agent, its notifications and asks queued for the turn. */
  private listen(connection: AcpConnection): JsonRpcLineClient {
    const client = new JsonRpcLineClient({ readable: connection.readable, writable: connection.writable, jsonrpc: true });
    connection.stderr?.on('data', (data: Buffer | string) => {
      this.stderr = (this.stderr + String(data)).slice(-MAX_STDERR);
    });
    // Only the agent in use ending ends the conversation's agent; a replaced one is expected to.
    const ended = () => {
      if (connection === this.connection) this.ended();
    };
    connection.readable.once('end', ended);
    connection.readable.once('close', ended);
    // Outside a turn nothing is shown: that drops the history `session/load` replays.
    client.onNotification((method, params) => {
      if (this.inTurn && !this.loading && method === 'session/update') this.inbox.push({ kind: 'note', params });
    });
    client.onRequest((method, params) =>
      this.inTurn ? new Promise((resolve, reject) => this.inbox.push({ kind: 'request', method, params, resolve, reject })) : refusal(method),
    );
    return client;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  /** Whether this agent was started where the turn runs (a running session cannot move). */
  fits(settings: Pick<AcpSessionSettings, 'cwd'>): boolean {
    return settings.cwd === this.settings.cwd;
  }

  async *turn(req: AgentStepRequest): AsyncGenerator<AgentStepEvent> {
    const mode = agentModeFor(req.mode);
    this.inTurn = true;
    const onAbort = () => {
      this.inbox.push({ kind: 'stop' });
      this.client.notify('session/cancel', { sessionId: this.sessionId });
    };
    req.signal.addEventListener('abort', onAbort, { once: true });
    this.mcp.setHandler(
      moxxyToolsHandler(toolsLentTo(this.settings.agent, req.tools), {
        runTool: (call) => new Promise((resolve) => this.inbox.push({ kind: 'moxxy-tool', call, resolve })),
      }),
    );
    try {
      yield { type: 'session', sessionId: this.sessionId };
      this.autoApprove = req.autoApprove;
      // A new conversation shows how the person's agent really runs (one
      // state). In goal mode Moxxy answers for the person because of the
      // goal, not because they chose auto-approve, so that waits.
      if (this.fresh && mode !== 'goal') {
        this.fresh = false;
        const rules = await this.rules();
        if (rules && runsWithoutAsking(rules) && !this.autoApprove) {
          this.autoApprove = true;
          yield { type: 'auto_approve', enabled: true };
        }
      }
      if (!this.autoApprove && mode !== 'goal') await this.askFromNowOn();
      // OpenCode reads the Moxxy tools when the session opens and keeps that
      // list: a turn that brings others has it read them again first.
      await this.mcp.announceTools({ signal: req.signal });
      await this.configure(req, mode);
      const notes = this.pendingNotes.map((text): AcpContentBlock => ({ type: 'text', text }));
      this.pendingNotes = [];
      let input: AcpContentBlock[] = [...notes, ...toAcpPrompt(req.prompt)];
      // The agent's answer to an ask carries no reason, and it ends its turn on
      // a refusal: the person's reason is its next message, in the same turn.
      // An agent that keeps asking for what was refused gets the reason with
      // the person's next message instead.
      for (let followUps = 0; ; followUps += 1) {
        if (req.signal.aborted) return;
        const declines: string[] = [];
        const finished = yield* this.prompt(input, req, declines);
        if (!finished || declines.length === 0 || followUps === MAX_DECLINE_FOLLOW_UPS) {
          this.pendingNotes.push(...declines);
          return;
        }
        input = declines.map((text): AcpContentBlock => ({ type: 'text', text }));
      }
    } catch (err) {
      if (!req.signal.aborted) yield { type: 'error', message: this.alive ? this.failureMessage(err) : this.endedMessage(), retryable: false };
    } finally {
      req.signal.removeEventListener('abort', onAbort);
      this.mcp.setHandler(undefined);
      this.inTurn = false;
      this.dismissQueued();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.alive = false;
    this.client.close();
    this.connection.close();
    this.dismissQueued();
    await this.mcp.close();
  }

  /** The rules of the agent the person runs, read once. */
  private async rules(): Promise<ReadonlyArray<OpenCodeRule> | undefined> {
    const { readRules, cwd } = this.settings;
    if (this.ownRules === undefined) this.ownRules = readRules ? ((await readRules({ cwd, agent: this.ownMode })) ?? null) : null;
    return this.ownRules ?? undefined;
  }

  /**
   * With auto-approve off the agent asks before what its own rules allow:
   * it is started again with those rules turned into asks (for this process
   * only, nothing written to its config) and loads the same session. Once
   * started so it stays, and Moxxy answers its asks while auto-approve is on.
   */
  private async askFromNowOn(): Promise<void> {
    if (this.asking) return;
    const rules = await this.rules();
    if (!rules || !runsWithoutAsking(rules)) return;
    const env = { [CONFIG_CONTENT_ENV]: askingConfig(this.ownMode, rules, process.env[CONFIG_CONTENT_ENV]) };
    const replaced = { connection: this.connection, client: this.client };
    const next = await this.settings.start({ cwd: this.settings.cwd, env });
    this.connection = next;
    this.client = this.listen(next);
    replaced.client.close();
    replaced.connection.close();
    this.asking = true;
    this.loading = true;
    try {
      await this.open(this.sessionId);
    } finally {
      this.loading = false;
    }
  }

  private async open(resume = this.settings.resume): Promise<void> {
    await this.client.request('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: { name: 'moxxy', title: 'Moxxy', version: CLIENT_VERSION },
    });
    const { cwd } = this.settings;
    const mcpServers = [
      {
        type: 'http',
        name: this.settings.agent.mcpServerName,
        url: this.mcp.url,
        headers: [{ name: 'Authorization', value: this.mcp.authorization }],
      },
    ];
    let session: AcpSessionResponse | undefined;
    if (resume) {
      session = await this.client.request<AcpSessionResponse>('session/load', { sessionId: resume, cwd, mcpServers }).catch(() => undefined);
      if (session) this.sessionId = resume;
    }
    if (!session) {
      session = await this.client.request<AcpSessionResponse>('session/new', { cwd, mcpServers });
      if (!session.sessionId) throw new Error(`${this.settings.agent.label} started no session.`);
      this.sessionId = session.sessionId;
    }
    this.options = session.configOptions ?? [];
    const mode = this.option('mode');
    if (mode && mode.currentValue !== PLAN_MODE) this.ownMode = mode.currentValue;
  }

  /** Model, effort and mode for this turn, changed on the session only where they differ. */
  private async configure(req: AgentStepRequest, mode: AgentMode): Promise<void> {
    const model = this.option('model');
    if (req.model && model && model.currentValue !== req.model) {
      await this.set(model.id, req.model).catch((err: unknown) => {
        throw new Error(`${this.settings.agent.label} could not switch to the model ${req.model}: ${messageOf(err)}`);
      });
    }
    const effort = typeof req.reasoning === 'object' ? req.reasoning.effort : undefined;
    const level = this.option('thought_level');
    if (effort && level && level.currentValue !== effort && offers(level, effort)) await this.set(level.id, effort);
    const agentMode = this.option('mode');
    const wanted = mode === 'plan' ? PLAN_MODE : this.ownMode;
    if (agentMode && agentMode.currentValue !== wanted && offers(agentMode, wanted)) await this.set(agentMode.id, wanted);
  }

  private option(category: string): AcpConfigOption | undefined {
    return this.options.find((option) => option.category === category) ?? this.options.find((option) => option.id === category);
  }

  private async set(configId: string, value: string): Promise<void> {
    const response = await this.client.request<AcpSessionResponse>('session/set_config_option', { sessionId: this.sessionId, configId, value });
    this.options = response.configOptions ?? this.options.map((option) => (option.id === configId ? { ...option, currentValue: value } : option));
  }

  /** One prompt, read until the agent answers it. False when the turn is over without it (stopped, failed). */
  private async *prompt(input: ReadonlyArray<AcpContentBlock>, req: AgentStepRequest, declines: string[]): AsyncGenerator<AgentStepEvent, boolean> {
    const translator = new AcpTurnTranslator(this.settings.agent.moxxyToolPrefix);
    this.client.request<AcpPromptResponse>('session/prompt', { sessionId: this.sessionId, prompt: input }).then(
      (result) => this.inbox.push({ kind: 'done', result }),
      (error: unknown) => this.inbox.push({ kind: 'failed', error }),
    );
    for (;;) {
      const item = await this.inbox.next();
      switch (item.kind) {
        case 'ended':
          yield* translator.finish();
          yield { type: 'error', message: this.endedMessage(), retryable: false };
          return false;
        case 'stop':
          // The agent answers the prompt as cancelled.
          continue;
        case 'moxxy-tool':
          item.resolve(await req.host.runTool(item.call));
          continue;
        case 'request':
          yield* this.answer(item, req, translator, declines);
          continue;
        case 'note': {
          const params = (item.params ?? {}) as { sessionId?: unknown; update?: AcpSessionUpdate };
          if (params.sessionId !== this.sessionId || !params.update) continue;
          yield* translator.update(params.update);
          continue;
        }
        case 'done':
          yield* translator.finish();
          if (item.result.usage) yield { type: 'usage', usage: toTokenUsage(item.result.usage) };
          return item.result.stopReason !== 'cancelled' && !req.signal.aborted;
        case 'failed':
          yield* translator.finish();
          if (!this.alive) {
            yield { type: 'error', message: this.endedMessage(), retryable: false };
            return false;
          }
          throw item.error;
      }
    }
  }

  /** What the agent asked of Moxxy, answered with the turn's host. */
  private async *answer(item: RequestItem, req: AgentStepRequest, translator: AcpTurnTranslator, declines: string[]): AsyncGenerator<AgentStepEvent> {
    if (item.method !== 'session/request_permission') {
      item.reject(new JsonRpcError(-32601, `Moxxy does not handle ${item.method}.`));
      return;
    }
    try {
      const ask = (item.params ?? {}) as AcpPermissionRequest;
      const callId = ask.toolCall.toolCallId;
      const { call, events } = translator.callFor(ask.toolCall);
      yield* events;
      // With auto-approve on Moxxy answers for the person, as OpenCode's own auto mode does; standing rules still apply.
      const decision = await untilStopped(
        req.host.approve({ callId, name: call.name, input: call.input, ...(this.autoApprove ? { policyOnly: true } : {}) }),
        req.signal,
        STOPPED,
      );
      if (req.signal.aborted) {
        item.resolve(CANCELLED);
        return;
      }
      item.resolve(permissionOutcome(decision, ask.options));
      if (!decision.allow) declines.push(declineNote(call, decision.reason));
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private failureMessage(err: unknown): string {
    const message = messageOf(err);
    const label = this.settings.agent.label;
    if (SIGN_IN_EXPIRED.test(message)) {
      return `${label} is signed out of the model's provider (${message}). Run \`${this.settings.agent.loginCommand}\` and try again.`;
    }
    return err instanceof JsonRpcError ? `${label}: ${message}` : message;
  }

  private ended(): void {
    if (!this.alive) return;
    this.alive = false;
    this.inbox.push({ kind: 'ended' });
  }

  private endedMessage(): string {
    const stderr = this.stderr.trim();
    const stopped = `${this.settings.agent.label} stopped.`;
    return stderr ? `${stopped}\n${stderr}` : stopped;
  }

  /** Answer whatever is still queued once no turn can: the agent must never wait on Moxxy forever. */
  private dismissQueued(): void {
    for (const item of this.inbox.drain()) {
      if (item.kind === 'ended') this.inbox.push(item);
      else if (item.kind === 'moxxy-tool') item.resolve({ ok: false, message: 'No Moxxy turn is running, so the tool cannot run now.' });
      else if (item.kind === 'request') {
        try {
          item.resolve(refusal(item.method));
        } catch (err) {
          item.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  }
}

/** What Moxxy tells the agent when nobody is in the conversation to decide. */
function refusal(method: string): unknown {
  if (method === 'session/request_permission') return CANCELLED;
  throw new JsonRpcError(-32601, `Moxxy does not handle ${method}.`);
}

function permissionOutcome(decision: AgentApprovalDecision, options: AcpPermissionRequest['options']): AcpPermissionOutcome {
  const find = (...kinds: ReadonlyArray<string>) => kinds.flatMap((kind) => options.filter((option) => option.kind === kind))[0];
  const chosen = !decision.allow ? find('reject_once', 'reject_always') : decision.always ? find('allow_always', 'allow_once') : find('allow_once', 'allow_always');
  return chosen ? { outcome: { outcome: 'selected', optionId: chosen.optionId } } : CANCELLED;
}

function offers(option: AcpConfigOption, value: string): boolean {
  return option.options === undefined || option.options.some((candidate) => candidate.value === value);
}

function declineNote(call: AcpShownCall, reason: string): string {
  const input = (call.input ?? {}) as { command?: unknown; file_path?: unknown };
  const what =
    typeof input.command === 'string' ? `${call.name} \`${input.command}\``
    : typeof input.file_path === 'string' ? `${call.name} (${input.file_path})`
    : call.name;
  return `The person declined ${what}. Their reason: ${reason}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
