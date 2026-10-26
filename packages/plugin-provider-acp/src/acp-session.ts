import { createRequire } from 'node:module';
import type { Readable, Writable } from 'node:stream';
import { isContextWindowSize, waitFor, type AgentApprovalDecision, type AgentBackgroundWork, type AgentStepEvent, type AgentStepRequest, type AgentToolCall, type AgentToolOutcome, type Skill, type ToolDef } from '@moxxy/sdk';
import {
  Inbox,
  JsonRpcError,
  JsonRpcLineClient,
  agentModeFor,
  earlierConversationNote,
  idleToolsHandler,
  moxxyToolsHandler,
  resumeAgentSession,
  sameToolNames,
  skillsForAgent,
  startMoxxyMcpServer,
  untilStopped,
  type AgentMode,
  type LiveSession,
  type MoxxyMcpServer,
  type NewSessionReason,
  withoutOwnMcpServers,
} from '@moxxy/agent-connection-kit';
import type { AcpAgentSpec } from './agents.js';
import {
  ACP_PROTOCOL_VERSION,
  type AcpConfigOption,
  type AcpContentBlock,
  type AcpInitializeResponse,
  type AcpPermissionOutcome,
  type AcpPermissionRequest,
  type AcpPromptResponse,
  type AcpSessionList,
  type AcpSessionResponse,
  type AcpSessionUpdate,
} from './protocol.js';
import { AcpTurnTranslator, toAcpPrompt, toTokenUsage, type AcpShownCall } from './translate.js';
import { abortOpenCodeSession, watchOpenCodeEvents, type OpenCodeApi, type OpenCodeEvent, type OpenCodeEventWatch } from './opencode-api.js';
import { OpenCodeHelpers } from './opencode-helpers.js';
import { askingConfig, asksOutsideProject, runsWithoutAsking, type OpenCodeRule, type ReadAgentMcpServers, type ReadAgentRules } from './rules.js';

/** A running ACP agent (`opencode acp`): its stdout, stdin and stderr. */
export interface AcpConnection {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly stderr?: Readable;
  /** OpenCode's HTTP API, where it reports its subagents; without it Moxxy sees no background work. */
  readonly api?: OpenCodeApi;
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
  /** The agent's own MCP servers: Moxxy's server of the same name is left to the agent's. */
  readonly readMcpServers?: ReadAgentMcpServers;
  /** Every Moxxy tool of the conversation: the agent reads the list as the session opens, and again on a notice. */
  readonly tools?: ReadonlyArray<ToolDef>;
  /** The conversation's Moxxy skills: the agent reads those meant for it through one more Moxxy tool. */
  readonly skills?: ReadonlyArray<Skill>;
  /** The agent started a turn by itself while no Moxxy turn runs (a background subagent finished); `name` says why, `workId` which work. */
  readonly onAgentTurn?: (name: string, workId?: string) => void;
  /** What the agent's background work did, for the conversation to record at once: its list, a subagent's steps and end. */
  readonly onActivity?: (events: ReadonlyArray<AgentStepEvent>) => void;
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
  /** What OpenCode's HTTP API says for the turn: steps of a subagent it waits for, a reached account limit. */
  | { readonly kind: 'api'; readonly events: ReadonlyArray<AgentStepEvent> }
  /** The conversation's session went idle and the agent has been quiet since: a turn it started by itself is over. */
  | { readonly kind: 'idle' }
  | { readonly kind: 'ended' };

const MAX_STDERR = 2048;
const MAX_DECLINE_FOLLOW_UPS = 3;
const STOPPED: AgentApprovalDecision = { allow: false, reason: 'The person stopped the turn.' };
const CANCELLED: AcpPermissionOutcome = { outcome: { outcome: 'cancelled' } };
const PLAN_MODE = 'plan';
const BUILD_MODE = 'build';
const SIGN_IN_EXPIRED = /token refresh failed|\b401\b|unauthori[sz]ed/i;
const CONFIG_CONTENT_ENV = 'OPENCODE_CONFIG_CONTENT';
/** ACP's error for a resource, here a session, that does not exist. */
const RESOURCE_NOT_FOUND = -32002;
/** How many pages of the agent's sessions Moxxy reads before it stops looking. */
const MAX_SESSION_PAGES = 50;
/** How long the first turn waits for the agent's list of commands; OpenCode sends it as the session opens. */
const COMMANDS_WAIT_MS = 2_000;
/** How long the agent stays quiet on ACP after OpenCode says its session is idle before a turn it started by itself counts as over (ACP lags its HTTP API). */
const SETTLE_MS = 300;
/** Steps kept per subagent whose start the conversation has not seen yet. */
const MAX_HELD_STEPS = 64;
/** ACP updates that show the agent at work: one outside any turn means it started one by itself. */
const WORK_UPDATES = new Set(['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan']);
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
  /** The Moxxy tools the agent is shown: every one of the conversation, the same in every mode. */
  private listed: ToolDef[];
  /** The Moxxy skills the agent is offered. */
  private offered: Skill[];
  /** Names of the agent's own commands and skills, as it last announced them. */
  private ownCommands: ReadonlyArray<string> = [];
  private commandsHeard = false;
  private commandsAwaited = false;
  private readonly commandWakers = new Set<() => void>();
  /** The session is new while the conversation may already have run: its first prompt carries the conversation so far. */
  private newSession: NewSessionReason | undefined;
  private stderr = '';
  /** No turn has shown the conversation yet how the agent runs. */
  private fresh = true;
  /** The agent's own rules, once read; `null` when it cannot say. */
  private ownRules: ReadonlyArray<OpenCodeRule> | null | undefined;
  private ownMcpServers: ReadonlyArray<string> | undefined;
  /** This agent was started to ask before what its own rules allow. */
  private asking = false;
  /** Whether Moxxy answers the agent's asks for the person in this turn. */
  private autoApprove = false;
  /** Auto-approve is on because Moxxy turned it on, not because the person chose it. */
  private adopted = false;
  /** The agent can list its sessions, which tells a gone session from a failed load. */
  private canList = false;
  /** A replacement agent could not load the session: the next turn starts the agent again. */
  private broken = false;
  /** OpenCode's events, read while its HTTP API is up. */
  private watch: OpenCodeEventWatch | undefined;
  /** The subagents OpenCode runs, read from its events. */
  private readonly helpers = new OpenCodeHelpers(() => this.sessionId);
  /** Subagents whose start the conversation has seen; the steps of others wait for it. */
  private readonly shownHelpers = new Set<string>();
  private readonly heldSteps = new Map<string, AgentStepEvent[]>();
  /** The background work last reported, to report it again only when it changes. */
  private shownWork: ReadonlyArray<AgentBackgroundWork> = [];
  /** OpenCode started a turn by itself and the conversation was asked for one to show it. */
  private agentTurnPending = false;
  /** A turn reads the one OpenCode started by itself. */
  private readingOwnTurn = false;
  /** OpenCode's session works now, as its events last said. */
  private agentBusy = false;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** This turn showed the account limit reached. */
  private limitShown = false;

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
    this.listed = toolsLentTo(settings.agent, settings.tools ?? []);
    this.offered = this.skillsFor(settings.skills);
    this.mcp.setHandler(idleToolsHandler(this.listed, this.offered));
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
    // The agent at work outside one started a turn by itself, which the conversation is asked to show.
    client.onNotification((method, params) => {
      if (method !== 'session/update') return;
      const commands = announcedCommands(params);
      if (commands) {
        this.ownCommands = commands;
        this.commandsHeard = true;
        this.commandWakers.forEach((wake) => wake());
        return;
      }
      if (this.loading) return;
      if (!this.inTurn && !this.agentTurnPending && this.startsOwnTurn(params)) this.askForTurn('A background task finished');
      if (!this.inTurn && !this.agentTurnPending) return;
      this.inbox.push({ kind: 'note', params });
      if (this.settleTimer) this.settleSoon();
    });
    client.onRequest((method, params) =>
      this.inTurn || this.agentTurnPending ? new Promise((resolve, reject) => this.inbox.push({ kind: 'request', method, params, resolve, reject })) : refusal(method),
    );
    return client;
  }

  get isAlive(): boolean {
    return this.alive && !this.broken;
  }

  /**
   * The agent lists its commands just after its session opens, maybe after the
   * turn began: the first turn waits for that list, an agent that never sends
   * one only briefly.
   */
  private async hearCommands(signal: AbortSignal): Promise<void> {
    if (this.commandsHeard || this.commandsAwaited) return;
    this.commandsAwaited = true;
    await waitFor(() => this.commandsHeard || undefined, {
      wakeOn: [
        (wake) => {
          this.commandWakers.add(wake);
          return () => this.commandWakers.delete(wake);
        },
      ],
      timeoutMs: COMMANDS_WAIT_MS,
      signal,
    });
  }

  /** A Moxxy skill named like one of the agent's own commands or skills is left to the agent's. */
  private skillsFor(skills: ReadonlyArray<Skill> | undefined): Skill[] {
    return skillsForAgent(skills ?? [], this.listed.map((tool) => tool.name), this.ownCommands);
  }

  /** Whether this agent was started where the turn runs (a running session cannot move). */
  fits(settings: Pick<AcpSessionSettings, 'cwd'>): boolean {
    return settings.cwd === this.settings.cwd;
  }

  async *turn(req: AgentStepRequest): AsyncGenerator<AgentStepEvent> {
    // A turn opened to show the one OpenCode started by itself: OpenCode is sent nothing.
    if (req.continuesAgentTurn) {
      if (this.agentTurnPending) yield* this.ownTurn(req);
      return;
    }
    const mode = agentModeFor(req.mode);
    this.inTurn = true;
    // A turn OpenCode started by itself and not shown yet is read by this one: OpenCode answers this prompt after it.
    this.agentTurnPending = false;
    this.clearSettle();
    this.limitShown = false;
    const onAbort = () => {
      this.inbox.push({ kind: 'stop' });
      this.client.notify('session/cancel', { sessionId: this.sessionId });
    };
    req.signal.addEventListener('abort', onAbort, { once: true });
    const all = withoutOwnMcpServers(toolsLentTo(this.settings.agent, req.allTools ?? req.tools), await this.mcpServers());
    if (!sameToolNames(all, this.listed)) this.listed = all;
    try {
      yield { type: 'session', sessionId: this.sessionId };
      this.autoApprove = req.autoApprove;
      // Auto-approve OpenCode's own rules turned on, not the person: the
      // person still answers what those rules ask (work outside the project).
      // Once the person turned it off, auto-approve on again is their choice.
      if (req.autoApproveFromAgent !== undefined) this.adopted = req.autoApprove && req.autoApproveFromAgent;
      else if (!req.autoApprove) this.adopted = false;
      // A new conversation shows how the person's agent really runs (one
      // state); a conversation going on, or one that recorded a switch, keeps
      // the auto-approve the person chose. In goal mode Moxxy answers for the person because of the goal,
      // not because they chose auto-approve, so that waits.
      if (this.fresh && mode !== 'goal') {
        this.fresh = false;
        const rules = await this.rules();
        const ownAuto = rules !== undefined && runsWithoutAsking(rules);
        if (this.settings.resume) {
          // Told nothing of who turned it on, while the agent's own rules would have, it asks as if the person did not.
          if (ownAuto && this.autoApprove && req.autoApproveFromAgent === undefined) this.adopted = true;
        } else if (ownAuto && !this.autoApprove && !req.autoApproveRecorded) {
          this.autoApprove = true;
          this.adopted = true;
          yield { type: 'auto_approve', enabled: true };
        }
      }
      if (!this.autoApprove && mode !== 'goal') await this.askFromNowOn();
      // OpenCode reads the Moxxy tools when the session opens and keeps that
      // list: when the conversation gained or lost a tool or a skill, it reads them again first.
      await this.hearCommands(req.signal);
      this.offered = this.skillsFor(req.skills);
      this.mcp.setHandler(
        moxxyToolsHandler(
          this.listed,
          { runTool: (call) => new Promise((resolve) => this.inbox.push({ kind: 'moxxy-tool', call, resolve })) },
          this.offered,
        ),
      );
      await this.mcp.announceTools({ signal: req.signal });
      await this.configure(req, mode);
      // A new session of the agent's own gets the whole conversation; one it goes on in, the turns it was away for.
      const note = this.newSession ? earlierConversationNote(this.newSession, req.earlierConversation?.()) : req.missedTurns?.();
      this.newSession = undefined;
      if (note) this.pendingNotes.unshift(note);
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
      this.mcp.setHandler(idleToolsHandler(this.listed, this.offered));
      this.inTurn = false;
      this.dismissQueued();
    }
  }

  /** Stop one subagent OpenCode runs in the background (`AgentBackgroundWork.id`); `false` when it runs no such work. */
  async stopWork(workId: string): Promise<boolean> {
    const api = this.connection.api;
    const session = api ? this.helpers.stop(workId) : undefined;
    if (!api || !session) return false;
    const stopped = await abortOpenCodeSession(api, this.settings.cwd, session);
    if (!stopped) this.helpers.unstop(workId);
    return stopped;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.alive = false;
    this.unwatch();
    this.client.close();
    this.connection.close();
    this.dismissQueued();
    await this.mcp.close();
  }

  /** The agent's own MCP servers that are on, read once. */
  private async mcpServers(): Promise<ReadonlyArray<string>> {
    const { readMcpServers, cwd } = this.settings;
    if (this.ownMcpServers === undefined) {
      const servers = readMcpServers ? ((await readMcpServers({ cwd }).catch(() => undefined)) ?? []) : [];
      this.ownMcpServers = servers.filter((name) => name !== this.settings.agent.mcpServerName);
    }
    return this.ownMcpServers;
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
    // The subagents of the OpenCode replaced end with it.
    this.unwatch();
    this.connection = next;
    this.client = this.listen(next);
    replaced.client.close();
    replaced.connection.close();
    this.asking = true;
    this.loading = true;
    try {
      await this.open(this.sessionId);
    } catch (err) {
      this.broken = true;
      throw err;
    } finally {
      this.loading = false;
    }
  }

  private async open(resume = this.settings.resume): Promise<void> {
    const init = await this.client.request<AcpInitializeResponse>('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: { name: 'moxxy', title: 'Moxxy', version: CLIENT_VERSION },
    });
    this.canList = init.agentCapabilities?.sessionCapabilities?.list !== undefined;
    // OpenCode serves its HTTP API once it answered `initialize`.
    this.watchEvents();
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
      const resumed = await resumeAgentSession({
        label: this.settings.agent.label,
        load: () => this.client.request<AcpSessionResponse>('session/load', { sessionId: resume, cwd, mcpServers }),
        gone: (error) => this.sessionGone(error, resume),
      });
      if (resumed.kind === 'loaded') {
        session = resumed.session;
        this.sessionId = resume;
      } else {
        this.newSession = 'lost';
      }
    } else {
      this.newSession = 'new';
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

  /**
   * Whether a session the agent failed to load no longer exists. OpenCode 1.18
   * answers a missing session as it answers a failure ("OpenCode service
   * failure"), so its session list decides; an agent that can say neither
   * keeps the session as existing, and nothing replaces it.
   */
  private async sessionGone(error: unknown, sessionId: string): Promise<boolean> {
    if (error instanceof JsonRpcError && error.code === RESOURCE_NOT_FOUND) return true;
    if (!this.canList) return false;
    try {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
        const listed = await this.client.request<AcpSessionList>('session/list', { cwd: this.settings.cwd, ...(cursor ? { cursor } : {}) });
        if (listed.sessions.some((session) => session.sessionId === sessionId)) return false;
        if (!listed.nextCursor) return true;
        cursor = listed.nextCursor;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** How full OpenCode's context is (`used`) and the window it runs the turn's model with (`size`), from its `usage_update`. */
  private contextOf(update: AcpSessionUpdate, requested: string): AgentStepEvent[] {
    if (update.sessionUpdate !== 'usage_update') return [];
    const { used, size } = update as { used?: unknown; size?: unknown };
    const model = requested || this.option('model')?.currentValue;
    return [
      ...(typeof used === 'number' && Number.isSafeInteger(used) && used >= 0 ? [{ type: 'context_used' as const, tokens: used }] : []),
      ...(typeof model === 'string' && model !== '' && isContextWindowSize(size) ? [{ type: 'context_window' as const, model, tokens: size }] : []),
    ];
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
    const translator = new AcpTurnTranslator(this.settings.agent.moxxyToolPrefix, this.settings.cwd);
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
        case 'idle':
          continue;
        case 'moxxy-tool':
          item.resolve(await req.host.runTool(item.call));
          continue;
        case 'request':
          yield* this.answer(item, req, translator, declines);
          continue;
        case 'api':
          yield* item.events;
          continue;
        case 'note':
          yield* this.shown(item.params, translator, req);
          continue;
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
      yield* this.withHeldSteps(events);
      // With auto-approve on Moxxy answers for the person, as OpenCode's own auto mode does; standing rules still apply.
      // Work outside the project OpenCode asks about even on its defaults: while
      // Moxxy turned auto-approve on, not the person, the person still answers.
      const askPerson = this.adopted && asksOutsideProject(ask.toolCall.rawInput);
      const answering = askPerson ? { askPerson: true } : this.autoApprove ? { policyOnly: true } : {};
      const decision = await untilStopped(
        req.host.approve({ callId, name: call.name, input: call.input, ...answering }),
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

  /**
   * A turn OpenCode started by itself: a background subagent finished and
   * OpenCode prompted its session with the result. It is read until OpenCode's
   * session is idle again; its asks and Moxxy tool calls are answered as in any turn.
   */
  private async *ownTurn(req: AgentStepRequest): AsyncGenerator<AgentStepEvent> {
    this.inTurn = true;
    this.readingOwnTurn = true;
    this.limitShown = false;
    const onAbort = () => {
      this.inbox.push({ kind: 'stop' });
      this.client.notify('session/cancel', { sessionId: this.sessionId });
    };
    req.signal.addEventListener('abort', onAbort, { once: true });
    this.mcp.setHandler(
      moxxyToolsHandler(
        this.listed,
        { runTool: (call) => new Promise((resolve) => this.inbox.push({ kind: 'moxxy-tool', call, resolve })) },
        this.offered,
      ),
    );
    const translator = new AcpTurnTranslator(this.settings.agent.moxxyToolPrefix, this.settings.cwd);
    // Already over (OpenCode's ACP lags its events), it is read to the end of what came.
    if (!this.agentBusy) this.settleSoon();
    try {
      yield { type: 'session', sessionId: this.sessionId };
      for (;;) {
        const item = await this.inbox.next();
        switch (item.kind) {
          case 'ended':
            yield* translator.finish();
            yield { type: 'error', message: this.endedMessage(), retryable: false };
            return;
          case 'idle':
            yield* translator.finish();
            return;
          case 'moxxy-tool':
            item.resolve(await req.host.runTool(item.call));
            continue;
          case 'request': {
            const declines: string[] = [];
            yield* this.answer(item, req, translator, declines);
            this.pendingNotes.push(...declines);
            continue;
          }
          case 'api':
            yield* item.events;
            continue;
          case 'note':
            yield* this.shown(item.params, translator, req);
            continue;
          default:
            continue;
        }
      }
    } finally {
      req.signal.removeEventListener('abort', onAbort);
      this.mcp.setHandler(idleToolsHandler(this.listed, this.offered));
      this.agentTurnPending = false;
      this.readingOwnTurn = false;
      this.inTurn = false;
      this.clearSettle();
      this.dismissQueued();
    }
  }

  /** One ACP update of the conversation's session as agent events. */
  private *shown(params: unknown, translator: AcpTurnTranslator, req: AgentStepRequest): Generator<AgentStepEvent> {
    const { sessionId, update } = (params ?? {}) as { sessionId?: unknown; update?: AcpSessionUpdate };
    if (sessionId !== this.sessionId || !update) return;
    yield* this.contextOf(update, req.model);
    yield* this.withHeldSteps(translator.update(update));
  }

  /** The events, each subagent's start followed by the steps it took before the conversation saw it start. */
  private *withHeldSteps(events: Iterable<AgentStepEvent>): Generator<AgentStepEvent> {
    for (const event of events) {
      yield event;
      if (event.type !== 'subagent_started') continue;
      this.shownHelpers.add(event.id);
      const held = this.heldSteps.get(event.id) ?? [];
      this.heldSteps.delete(event.id);
      if (this.helpers.inBackground(event.id)) this.report(held);
      else yield* held;
    }
  }

  /** Start reading the events of the OpenCode in use, when it serves its HTTP API. */
  private watchEvents(): void {
    this.watch?.close();
    const api: OpenCodeApi | undefined = this.connection.api;
    if (!api) return;
    this.watch = watchOpenCodeEvents(api, this.settings.cwd, (event) => this.onEvent(event), {
      // Without events the end of a turn OpenCode started by itself would never come.
      onDisconnected: () => {
        if (this.agentTurnPending || this.readingOwnTurn) this.settleSoon();
      },
    });
  }

  /** Stop reading OpenCode's events: its subagents end with it. */
  private unwatch(): void {
    this.watch?.close();
    this.watch = undefined;
    this.clearSettle();
    this.helpers.clear();
    this.shownHelpers.clear();
    this.heldSteps.clear();
    this.agentBusy = false;
    this.reportWork([]);
  }

  private onEvent(event: OpenCodeEvent): void {
    if (this.closed) return;
    const news = this.helpers.take(event);
    for (const step of news.steps) this.deliver(step);
    if (news.workChanged) this.reportWork();
    if (news.status) {
      this.agentBusy = news.status === 'busy';
      if (this.agentBusy) this.clearSettle();
      else if (this.agentTurnPending || this.readingOwnTurn) this.settleSoon();
    }
    // OpenCode would wait for the reset, hours maybe, retrying: the turn ends on the limit, as Claude's does.
    if (news.limitReached && this.inTurn && !this.limitShown) {
      this.limitShown = true;
      this.inbox.push({ kind: 'api', events: [{ type: 'account_limit', limit: { state: 'reached' } }] });
      this.client.notify('session/cancel', { sessionId: this.sessionId });
    }
    if (news.finished && !this.inTurn) {
      const { label, failed, workId } = news.finished;
      this.askForTurn(`${label} ${failed ? 'failed' : 'finished'} in the background`, workId);
    }
  }

  /**
   * A subagent's step: in the turn that waits for it, or recorded at once for
   * one working in the background. A step of a subagent whose start the
   * conversation has not seen waits for it.
   */
  private deliver(step: AgentStepEvent): void {
    const id = 'id' in step && typeof step.id === 'string' ? step.id : undefined;
    if (id === undefined) return;
    if (!this.shownHelpers.has(id)) {
      const held = this.heldSteps.get(id) ?? [];
      if (held.length < MAX_HELD_STEPS) held.push(step);
      this.heldSteps.set(id, held);
      return;
    }
    if (this.inTurn && !this.helpers.inBackground(id)) this.inbox.push({ kind: 'api', events: [step] });
    else this.report([step]);
  }

  /** Whether an ACP update outside any turn shows the agent at work in the conversation's session. */
  private startsOwnTurn(params: unknown): boolean {
    const { sessionId, update } = (params ?? {}) as { sessionId?: unknown; update?: { sessionUpdate?: unknown } };
    return this.watch !== undefined && sessionId === this.sessionId && typeof update?.sessionUpdate === 'string' && WORK_UPDATES.has(update.sessionUpdate);
  }

  private askForTurn(name: string, workId?: string): void {
    if (this.closed || this.agentTurnPending) return;
    this.agentTurnPending = true;
    // Already idle by the time ACP shows its work, the turn is over once the agent is quiet.
    if (!this.agentBusy) this.settleSoon();
    this.settings.onAgentTurn?.(name, workId);
  }

  /** The turn OpenCode started by itself is over once its session is idle and ACP has been quiet a moment. */
  private settleSoon(): void {
    this.clearSettle();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      this.inbox.push({ kind: 'idle' });
    }, SETTLE_MS);
  }

  private clearSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
  }

  /** What OpenCode runs in the background now; reported when it changes. */
  private reportWork(work: ReadonlyArray<AgentBackgroundWork> = this.helpers.running()): void {
    if (sameWork(work, this.shownWork)) return;
    this.shownWork = work;
    this.report([{ type: 'background_work', work }]);
  }

  private report(events: ReadonlyArray<AgentStepEvent>): void {
    if (events.length > 0) this.settings.onActivity?.(events);
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
      else if (item.kind === 'api') this.report(item.events.filter((event) => event.type !== 'account_limit'));
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

function sameWork(a: ReadonlyArray<AgentBackgroundWork>, b: ReadonlyArray<AgentBackgroundWork>): boolean {
  return a.length === b.length && a.every((work, i) => work.id === b[i]?.id && work.label === b[i]?.label);
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

/** The names in an `available_commands_update`, the agent's commands and skills; `undefined` for any other update. */
function announcedCommands(params: unknown): string[] | undefined {
  const update = (params as { update?: { sessionUpdate?: unknown; availableCommands?: unknown } } | null)?.update;
  if (!update || update.sessionUpdate !== 'available_commands_update' || !Array.isArray(update.availableCommands)) return undefined;
  return update.availableCommands.flatMap((command: { name?: unknown }) => (typeof command.name === 'string' ? [command.name] : []));
}
