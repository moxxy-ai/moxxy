import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Readable, Writable } from 'node:stream';
import type { AgentApprovalDecision, AgentStepEvent, AgentStepRequest, AgentToolCall, AgentToolOutcome, ToolDef } from '@moxxy/sdk';
import {
  Inbox,
  JsonRpcError,
  JsonRpcLineClient,
  agentModeFor,
  earlierConversationNote,
  moxxyToolsHandler,
  resumeAgentSession,
  startMoxxyMcpServer,
  untilStopped,
  type AgentMode,
  type LiveSession,
  type MoxxyMcpServer,
  type NewSessionReason,
} from '@moxxy/agent-connection-kit';
import { MOXXY_MCP_SERVER } from './constants.js';
import type {
  CodexApprovalPolicy,
  CodexApprovalsReviewer,
  CodexConfigRead,
  CodexGoal,
  CodexSandboxPolicy,
  CodexThreadResponse,
  CodexTurn,
  CodexUserInput,
  CodexUserInputQuestion,
} from './protocol.js';
import {
  TurnTranslator,
  answersMessage,
  fromAsyncQuestions,
  fromUserInputQuestions,
  promptText,
  shownCommand,
  toCodexInput,
  toUserInputAnswers,
  type CodexToolCall,
} from './translate.js';

/** A running `codex app-server`: its stdout, stdin and stderr. */
export interface CodexConnection {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly stderr?: Readable;
  close(): void;
}

export type StartCodexAppServer = (opts: { readonly cwd: string }) => Promise<CodexConnection>;

export interface CodexSessionSettings {
  readonly start: StartCodexAppServer;
  readonly cwd: string;
  /** The conversation's Codex thread from an earlier process, to resume. */
  readonly resume?: string;
  /** The Moxxy tools of the turn that starts this Codex: Codex reads them once, as the thread opens. */
  readonly tools?: ReadonlyArray<ToolDef>;
}

interface Policy {
  readonly approvalPolicy: CodexApprovalPolicy;
  readonly sandbox: CodexSandboxPolicy;
}

interface ThreadSettings extends Policy {
  readonly model: string;
  readonly effort?: string;
  /** Codex's service tier; `null` is its standard one. */
  readonly serviceTier: string | null;
  readonly collaboration: 'plan' | 'default';
  readonly reviewer: CodexApprovalsReviewer;
  /** The reasoning summary asked of the model; `null` leaves it to the model's default. */
  readonly summary: string | null;
}

/** Moxxy's auto-approve, as Codex runs it: no approvals, full access. */
const AUTO: Policy = { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } };
/** Without auto-approve on a Codex set up for it: Codex asks before anything that writes. */
const ASKING: Policy = { approvalPolicy: 'on-request', sandbox: { type: 'readOnly', networkAccess: false } };
/** Codex's fast mode (`/fast`), its `priority` service tier. */
const FAST_TIER = 'priority';
/** Codex's own name for its standard tier, which `null` restores. */
const STANDARD_TIER = 'default';
/** Asked of the model when the person's config leaves reasoning summaries to it. */
const REASONING_SUMMARY = 'auto';
/** Plan mode only reads: nothing is written and nobody is asked. */
const PLANNING: Policy = { approvalPolicy: 'never', sandbox: ASKING.sandbox };

export function isAuto(policy: Policy): boolean {
  return policy.approvalPolicy === 'never' && policy.sandbox.type === 'dangerFullAccess';
}

/**
 * Moxxy tools Codex already has its own of, so they are not lent over MCP:
 * its file and shell tools, web search, background jobs, skills, memory, its
 * own plan and goal. `ask_user` is lent: outside plan mode Codex has no
 * question of its own. `recall` is lent: it searches Moxxy's record of the
 * whole conversation, which outlives Codex's own thread.
 */
const CODEX_HAS_ITS_OWN = new Set([
  'Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Sleep', 'Wait', 'StopJob',
  'web_search', 'web_fetch', 'session_recall',
  'load_skill', 'reload_skills', 'synthesize_skill', 'load_tool',
  'plan_complete', 'goal_complete', 'goal_abandon',
]);

export function toolsLentToCodex(tools: ReadonlyArray<ToolDef>): ToolDef[] {
  return tools.filter((tool) => !CODEX_HAS_ITS_OWN.has(tool.name) && !tool.name.startsWith('memory_'));
}

type RequestItem = {
  readonly kind: 'request';
  readonly method: string;
  readonly params: unknown;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
};

type Item =
  | { readonly kind: 'note'; readonly method: string; readonly params: unknown }
  | RequestItem
  | { readonly kind: 'moxxy-tool'; readonly call: AgentToolCall; readonly resolve: (outcome: AgentToolOutcome) => void }
  | { readonly kind: 'stop' }
  | { readonly kind: 'ended' };

const MAX_STDERR = 2048;
const DISMISSED = { kind: 'dismissed', reason: 'cancelled' } as const;
const STOPPED: AgentApprovalDecision = { allow: false, reason: 'The person stopped the turn.' };
const NO_TURN_TOOL: AgentToolOutcome = { ok: false, message: 'No Moxxy turn is running, so the tool cannot run now.' };
const NOBODY_TO_ASK = 'Nobody is there to answer questions right now. Pick the sensible choice yourself and say which one you picked.';
const CLIENT_VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

/**
 * One running `codex app-server` with one thread for one Moxxy conversation.
 * Every message the person sends is the next turn of the same thread, so
 * Codex keeps its context, tools and goal between turns. Codex's
 * notifications and its requests to Moxxy (approvals, questions) and Moxxy
 * tool calls over MCP are queued together and handled in order, so the log
 * shows a call before the decision about it.
 */
export class CodexAgentSession implements LiveSession {
  private readonly inbox = new Inbox<Item>();
  private readonly client: JsonRpcLineClient;
  private alive = true;
  private closed = false;
  private inTurn = false;
  /** The thread has not reported its own policy to the conversation yet. */
  private fresh = true;
  private threadId = '';
  /** How the person's Codex config runs the thread; restored when Moxxy no longer overrides it. */
  private original: Policy = AUTO;
  private originalTier: string | null = null;
  private originalReviewer: CodexApprovalsReviewer = 'user';
  /** `model_reasoning_summary` from the person's config: `null` unset, `undefined` unread. */
  private ownSummary: string | null | undefined;
  private current: ThreadSettings = { ...AUTO, model: '', serviceTier: null, collaboration: 'default', reviewer: 'user', summary: null };
  /** Why the person declined, for Codex's next message when its turn could not take it. */
  private pendingNotes: string[] = [];
  /** The thread is new while the conversation may already have run: its first message carries the conversation so far. */
  private newThread: NewSessionReason | undefined;
  private goal: CodexGoal | undefined;
  /** Codex turns that belong to the Moxxy turn running now. */
  private readonly myTurns = new Set<string>();
  private activeTurn: string | undefined;
  private lastError: string | undefined;
  private stderr = '';

  static async start(settings: CodexSessionSettings): Promise<CodexAgentSession> {
    const mcp = await startMoxxyMcpServer({ name: MOXXY_MCP_SERVER });
    let session: CodexAgentSession | undefined;
    try {
      session = new CodexAgentSession(settings, mcp, await settings.start({ cwd: settings.cwd }));
      await session.open();
      return session;
    } catch (err) {
      if (session) await session.close();
      else await mcp.close();
      throw err;
    }
  }

  private constructor(
    readonly settings: CodexSessionSettings,
    private readonly mcp: MoxxyMcpServer,
    private readonly connection: CodexConnection,
  ) {
    this.client = new JsonRpcLineClient({ readable: connection.readable, writable: connection.writable });
    connection.stderr?.on('data', (data: Buffer | string) => {
      this.stderr = (this.stderr + String(data)).slice(-MAX_STDERR);
    });
    const ended = () => this.ended();
    connection.readable.once('end', ended);
    connection.readable.once('close', ended);
    this.client.onNotification((method, params) => this.onNotification(method, params));
    this.client.onRequest((method, params) =>
      this.inTurn ? new Promise((resolve, reject) => this.inbox.push({ kind: 'request', method, params, resolve, reject })) : refusal(method),
    );
  }

  get isAlive(): boolean {
    return this.alive;
  }

  /** Whether this Codex was started where the turn runs (a running thread cannot move). */
  fits(settings: Pick<CodexSessionSettings, 'cwd'>): boolean {
    return settings.cwd === this.settings.cwd;
  }

  async *turn(req: AgentStepRequest): AsyncGenerator<AgentStepEvent> {
    const mode = agentModeFor(req.mode);
    this.inTurn = true;
    this.myTurns.clear();
    this.activeTurn = undefined;
    this.lastError = undefined;
    const onAbort = () => {
      this.inbox.push({ kind: 'stop' });
      void this.interrupt();
    };
    req.signal.addEventListener('abort', onAbort, { once: true });
    this.mcp.setHandler(
      moxxyToolsHandler(toolsLentToCodex(req.tools), {
        runTool: (call) => new Promise((resolve) => this.inbox.push({ kind: 'moxxy-tool', call, resolve })),
      }),
    );
    try {
      yield { type: 'session', sessionId: this.threadId };
      let autoApprove = req.autoApprove;
      // A new thread shows the conversation how the person's Codex really runs
      // (one state). In goal mode Codex runs with full access for the goal, not
      // because the person chose auto-approve, so that waits for the next turn.
      if (this.fresh && mode !== 'goal') {
        this.fresh = false;
        yield { type: 'auto_approve', enabled: isAuto(this.original) };
        if (!autoApprove) autoApprove = isAuto(this.original);
      }
      await this.apply(this.wanted(req, mode, autoApprove));
      if (this.newThread) {
        const note = earlierConversationNote(this.newThread, req.earlierConversation?.());
        this.newThread = undefined;
        if (note) this.pendingNotes.unshift(note);
      }
      await this.begin(mode, req);
      yield* this.read(req, mode, new TurnTranslator());
    } catch (err) {
      if (!req.signal.aborted) yield { type: 'error', message: this.alive ? messageOf(err) : this.endedMessage(), retryable: false };
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

  private async open(): Promise<void> {
    await this.client.request('initialize', {
      clientInfo: { name: 'moxxy', title: 'Moxxy', version: CLIENT_VERSION },
      capabilities: { experimentalApi: true },
    });
    this.client.notify('initialized');
    const { cwd, resume } = this.settings;
    const config = { mcp_servers: { [MOXXY_MCP_SERVER]: { url: this.mcp.url, http_headers: { Authorization: this.mcp.authorization } } } };
    const read = await this.client.request<CodexConfigRead>('config/read', { cwd }).catch(() => undefined);
    this.ownSummary = read ? (read.config.model_reasoning_summary ?? null) : undefined;
    // Codex lists Moxxy's tools when the thread opens and keeps that list for the thread.
    this.mcp.setHandler(moxxyToolsHandler(toolsLentToCodex(this.settings.tools ?? []), { runTool: async () => NO_TURN_TOOL }));
    let thread: CodexThreadResponse | undefined;
    if (resume) {
      const resumed = await resumeAgentSession({
        label: 'Codex',
        load: () => this.client.request<CodexThreadResponse>('thread/resume', { threadId: resume, cwd, config }),
        gone: threadGone,
      });
      if (resumed.kind === 'loaded') {
        thread = resumed.session;
        const found = await this.client.request<{ goal: CodexGoal | null }>('thread/goal/get', { threadId: thread.thread.id }).catch(() => undefined);
        this.goal = found?.goal ?? undefined;
      } else {
        this.newThread = 'lost';
      }
    } else {
      this.newThread = 'new';
    }
    thread ??= await this.client.request<CodexThreadResponse>('thread/start', { cwd, config });
    this.mcp.setHandler(undefined);
    this.threadId = thread.thread.id;
    this.original = { approvalPolicy: thread.approvalPolicy, sandbox: thread.sandbox };
    this.originalTier = thread.serviceTier && thread.serviceTier !== STANDARD_TIER ? thread.serviceTier : null;
    this.originalReviewer = thread.approvalsReviewer ?? 'user';
    this.current = {
      ...this.original,
      model: thread.model,
      ...(thread.reasoningEffort ? { effort: thread.reasoningEffort } : {}),
      serviceTier: this.originalTier,
      collaboration: 'default',
      reviewer: this.originalReviewer,
      summary: this.ownSummary ?? null,
    };
  }

  /** What the thread should run with for this turn's mode, model and auto-approve. */
  private wanted(req: AgentStepRequest, mode: AgentMode, autoApprove: boolean): ThreadSettings {
    const effort = typeof req.reasoning === 'object' ? req.reasoning.effort : undefined;
    const ownAuto = isAuto(this.original);
    const policy =
      mode === 'plan' ? PLANNING
      : mode === 'goal' || autoApprove ? (ownAuto ? this.original : AUTO)
      : ownAuto ? ASKING
      : this.original;
    return {
      ...policy,
      model: req.model || this.current.model,
      ...(effort ? { effort } : {}),
      // Fast mode off hands the tier back to how the person set Codex up.
      serviceTier: req.fast ? FAST_TIER : this.originalTier,
      collaboration: mode === 'plan' ? 'plan' : 'default',
      // While Moxxy does not answer for the person, the person answers: never Codex's own reviewer.
      reviewer: mode !== 'plan' && mode !== 'goal' && !autoApprove ? 'user' : this.originalReviewer,
      // Codex streams no summary of its thinking unless asked; a summary the person set stays theirs.
      summary: this.ownSummary === null ? REASONING_SUMMARY : this.current.summary,
    };
  }

  /** Change on the thread only what differs; nothing is written to the person's Codex config. */
  private async apply(wanted: ThreadSettings): Promise<void> {
    const current = this.current;
    const effort = wanted.effort ?? current.effort;
    const update: Record<string, unknown> = {};
    if (!same(wanted.approvalPolicy, current.approvalPolicy)) update.approvalPolicy = wanted.approvalPolicy;
    if (!same(wanted.sandbox, current.sandbox)) update.sandboxPolicy = wanted.sandbox;
    if (wanted.model !== current.model) update.model = wanted.model;
    if (wanted.effort && wanted.effort !== current.effort) update.effort = wanted.effort;
    if (wanted.serviceTier !== current.serviceTier) update.serviceTier = wanted.serviceTier;
    if (wanted.reviewer !== current.reviewer) update.approvalsReviewer = wanted.reviewer;
    if (wanted.summary !== null && wanted.summary !== current.summary) update.summary = wanted.summary;
    if (wanted.collaboration !== current.collaboration) {
      update.collaborationMode = {
        mode: wanted.collaboration,
        settings: { model: wanted.model, reasoning_effort: effort ?? null, developer_instructions: null },
      };
    }
    if (Object.keys(update).length === 0) return;
    await this.client.request('thread/settings/update', { threadId: this.threadId, ...update });
    this.current = { ...wanted, ...(effort ? { effort } : {}) };
  }

  /** Start the turn: a goal Codex works on by itself, or the person's message. */
  private async begin(mode: AgentMode, req: AgentStepRequest): Promise<void> {
    const input = toCodexInput(req.prompt);
    if (mode === 'goal' && this.goal?.status === 'active') return this.startTurn(input);
    // A goal left behind (met, or stopped before leaving goal mode) must not keep Codex going.
    if (this.goal) await this.clearGoal();
    if (mode !== 'goal') return this.startTurn(input);
    const set = await this.client.request<{ goal: CodexGoal }>('thread/goal/set', { threadId: this.threadId, objective: promptText(req.prompt) });
    this.goal = set.goal;
  }

  private async startTurn(input: ReadonlyArray<CodexUserInput>): Promise<void> {
    const notes = this.pendingNotes.map((text): CodexUserInput => ({ type: 'text', text, text_elements: [] }));
    this.pendingNotes = [];
    const started = await this.client.request<{ turn: CodexTurn }>('turn/start', { threadId: this.threadId, input: [...notes, ...input] });
    this.myTurns.add(started.turn.id);
    this.activeTurn = started.turn.id;
  }

  private async clearGoal(): Promise<void> {
    await this.client.request('thread/goal/clear', { threadId: this.threadId }).catch(() => undefined);
    this.goal = undefined;
  }

  /** Read Codex until the Moxxy turn is over: its turn ended, or its goal stopped running. */
  private async *read(req: AgentStepRequest, mode: AgentMode, translator: TurnTranslator): AsyncGenerator<AgentStepEvent> {
    const finished = new Set<string>();
    for (;;) {
      const item = await this.inbox.next();
      if (item.kind === 'ended') {
        yield { type: 'error', message: this.endedMessage(), retryable: false };
        return;
      }
      if (item.kind === 'stop') {
        if (this.activeTurn === undefined) return;
        continue;
      }
      if (item.kind === 'moxxy-tool') {
        item.resolve(await req.host.runTool(item.call));
        continue;
      }
      if (item.kind === 'request') {
        yield* this.answer(item, req, translator);
        continue;
      }
      const params = (item.params ?? {}) as Record<string, unknown>;
      this.noteGoal(item.method, params);
      if (item.method === 'turn/started') {
        const turn = params.turn as CodexTurn | undefined;
        if (!turn) continue;
        this.myTurns.add(turn.id);
        this.activeTurn = turn.id;
        if (req.signal.aborted) void this.interrupt();
        // A goal turn Codex started by itself takes what waited for its next message.
        else if (this.pendingNotes.length > 0) await this.steerPending(turn.id);
        continue;
      }
      if (item.method === 'turn/completed') {
        const turn = params.turn as CodexTurn | undefined;
        if (!turn || !this.myTurns.has(turn.id) || finished.has(turn.id)) continue;
        finished.add(turn.id);
        if (this.activeTurn === turn.id) this.activeTurn = undefined;
        if (turn.status === 'failed') {
          yield { type: 'error', message: `Codex: ${turn.error?.message ?? this.lastError ?? 'the turn failed'}`, retryable: false };
          return;
        }
        if (turn.status === 'interrupted' || req.signal.aborted) return;
        if (translator.questions.length > 0) {
          const answer = await this.answerQuestions(translator, req);
          if (answer === undefined) return;
          await this.startTurn([{ type: 'text', text: answer, text_elements: [] }]);
          continue;
        }
        if (mode === 'goal') {
          // An open goal: Codex starts its next turn by itself.
          if (this.goal?.status === 'active') continue;
          yield { type: 'goal', status: this.goal?.status === 'complete' ? 'complete' : 'active' };
        }
        return;
      }
      if (item.method === 'error') {
        const error = params.error as { message?: unknown } | undefined;
        if (params.willRetry !== true && error && typeof error.message === 'string') this.lastError = error.message;
        continue;
      }
      if (!this.belongsHere(params)) continue;
      yield* translator.translate(item.method, params);
    }
  }

  /** Codex's plan-mode questions, asked in the Moxxy question card; the answers become its next message. */
  private async answerQuestions(translator: TurnTranslator, req: AgentStepRequest): Promise<string | undefined> {
    const items = fromAsyncQuestions(translator.questions);
    translator.questions = [];
    const outcome = await untilStopped(req.host.ask(items), req.signal, DISMISSED);
    switch (outcome.kind) {
      case 'answered':
        return answersMessage(items, outcome.answers);
      case 'unanswerable':
        return NOBODY_TO_ASK;
      case 'dismissed':
        return undefined;
    }
  }

  /** What Codex asked of Moxxy, answered with the turn's host. */
  private async *answer(item: RequestItem, req: AgentStepRequest, translator: TurnTranslator): AsyncGenerator<AgentStepEvent> {
    const p = (item.params ?? {}) as Record<string, unknown>;
    try {
      switch (item.method) {
        case 'item/commandExecution/requestApproval':
        case 'item/fileChange/requestApproval': {
          const callId = String(p.itemId);
          const call = translator.callOf(callId) ?? approvalCall(item.method, p);
          yield* translator.announce(callId, call);
          const decision = await this.decide(req, callId, call, p.reason);
          item.resolve({ decision: approvalDecision(decision, p.availableDecisions) });
          await this.explainDecline(req, call, decision);
          return;
        }
        case 'item/permissions/requestApproval': {
          const callId = String(p.itemId);
          const call = { name: 'request_permissions', input: p.permissions };
          yield* translator.announce(callId, call);
          const decision = await this.decide(req, callId, call, p.reason);
          yield { type: 'tool_result', callId, ok: decision.allow, ...(decision.allow ? { output: 'granted' } : { error: decision.reason }) };
          item.resolve(decision.allow ? { permissions: withoutNulls(p.permissions), scope: decision.always ? 'session' : 'turn' } : { permissions: {}, scope: 'turn' });
          await this.explainDecline(req, call, decision);
          return;
        }
        case 'item/tool/requestUserInput': {
          const items = fromUserInputQuestions(Array.isArray(p.questions) ? (p.questions as CodexUserInputQuestion[]) : []);
          const outcome = await untilStopped(req.host.ask(items), req.signal, DISMISSED);
          item.resolve({ answers: outcome.kind === 'answered' ? toUserInputAnswers(items, outcome.answers) : {} });
          return;
        }
        case 'mcpServer/elicitation/request': {
          // Moxxy asks about its own tools when it runs them.
          if (p.serverName === MOXXY_MCP_SERVER) {
            item.resolve({ action: 'accept', content: {}, _meta: null });
            return;
          }
          const message = typeof p.message === 'string' ? p.message : `${String(p.serverName)} asks to go ahead.`;
          const callId = `elicitation_${randomUUID()}`;
          const call = { name: `mcp__${String(p.serverName)}`, input: { message } };
          yield* translator.announce(callId, call);
          const decision = await this.decide(req, callId, call, message);
          yield { type: 'tool_result', callId, ok: decision.allow, ...(decision.allow ? { output: 'accepted' } : { error: decision.reason }) };
          item.resolve(decision.allow ? { action: 'accept', content: {}, _meta: null } : { action: 'decline', content: null, _meta: null });
          await this.explainDecline(req, call, decision);
          return;
        }
        default:
          item.reject(new JsonRpcError(-32601, `Moxxy does not handle ${item.method}.`));
      }
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private decide(req: AgentStepRequest, callId: string, call: CodexToolCall, reason: unknown): Promise<AgentApprovalDecision> {
    const description = typeof reason === 'string' && reason ? { description: reason } : {};
    return untilStopped(req.host.approve({ callId, name: call.name, input: call.input, ...description }), req.signal, STOPPED);
  }

  /**
   * Codex's answer to an approval is a bare `decline`, so the person's reason
   * goes into its running turn (`turn/steer`), or its next message when the
   * turn can no longer take input.
   */
  private async explainDecline(req: AgentStepRequest, call: CodexToolCall, decision: AgentApprovalDecision): Promise<void> {
    if (decision.allow || req.signal.aborted) return;
    const text = declineNote(call, decision.reason);
    const turnId = this.activeTurn;
    const steered =
      turnId !== undefined &&
      (await this.client.request('turn/steer', { threadId: this.threadId, expectedTurnId: turnId, input: [{ type: 'text', text, text_elements: [] }] }).then(
        () => true,
        () => false,
      ));
    if (!steered) this.pendingNotes.push(text);
  }

  private async steerPending(turnId: string): Promise<void> {
    const notes = this.pendingNotes;
    this.pendingNotes = [];
    const input = notes.map((text): CodexUserInput => ({ type: 'text', text, text_elements: [] }));
    const steered = await this.client.request('turn/steer', { threadId: this.threadId, expectedTurnId: turnId, input }).then(
      () => true,
      () => false,
    );
    if (!steered) this.pendingNotes.unshift(...notes);
  }

  private async interrupt(): Promise<void> {
    const turnId = this.activeTurn;
    if (turnId === undefined) return;
    await this.client.request('turn/interrupt', { threadId: this.threadId, turnId }).catch(() => undefined);
  }

  private belongsHere(params: Record<string, unknown>): boolean {
    if (typeof params.threadId === 'string' && params.threadId !== this.threadId) return false;
    return typeof params.turnId !== 'string' || this.myTurns.has(params.turnId);
  }

  private onNotification(method: string, params: unknown): void {
    // In a turn the goal's state is read in order with everything else Codex sent.
    if (this.inTurn) this.inbox.push({ kind: 'note', method, params });
    else this.noteGoal(method, params);
  }

  /** Keep the goal's state, whether or not a turn is reading. */
  private noteGoal(method: string, params: unknown): void {
    if (method === 'thread/goal/updated') {
      const goal = (params as { goal?: CodexGoal } | undefined)?.goal;
      if (goal) this.goal = goal;
    } else if (method === 'thread/goal/cleared') {
      this.goal = undefined;
    }
  }

  private ended(): void {
    if (!this.alive) return;
    this.alive = false;
    this.inbox.push({ kind: 'ended' });
  }

  private endedMessage(): string {
    const stderr = this.stderr.trim();
    return stderr ? `Codex stopped.\n${stderr}` : 'Codex stopped.';
  }

  /** Answer whatever is still queued once no turn can: Codex must never wait on Moxxy forever. */
  private dismissQueued(): void {
    for (const item of this.inbox.drain()) {
      if (item.kind === 'ended') this.inbox.push(item);
      else if (item.kind === 'note') this.noteGoal(item.method, item.params);
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

/** What Moxxy tells Codex when nobody is in the conversation to decide. */
function refusal(method: string): unknown {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' };
    case 'item/permissions/requestApproval':
      return { permissions: {}, scope: 'turn' };
    case 'item/tool/requestUserInput':
      return { answers: {} };
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null, _meta: null };
    default:
      throw new JsonRpcError(-32601, `Moxxy does not handle ${method}.`);
  }
}

function approvalCall(method: string, p: Record<string, unknown>): CodexToolCall {
  if (method === 'item/fileChange/requestApproval') return { name: 'apply_patch', input: { changes: [] } };
  return { name: 'Bash', input: { command: shownCommand(String(p.command ?? '')), cwd: p.cwd } };
}

function approvalDecision(decision: AgentApprovalDecision, offered: unknown): string {
  if (!decision.allow) return 'decline';
  const forSession = !Array.isArray(offered) || offered.includes('acceptForSession');
  return decision.always && forSession ? 'acceptForSession' : 'accept';
}

function declineNote(call: CodexToolCall, reason: string): string {
  const input = (call.input ?? {}) as { command?: unknown; changes?: ReadonlyArray<{ path?: unknown }> };
  const what =
    typeof input.command === 'string' ? `${call.name} \`${input.command}\``
    : Array.isArray(input.changes) && input.changes.length > 0 ? `${call.name} (${input.changes.map((change) => String(change.path)).join(', ')})`
    : call.name;
  return `The person declined ${what}. Their reason: ${reason}`;
}

function withoutNulls(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined));
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Codex's answer to resuming a thread it no longer has, or never could have. */
function threadGone(error: unknown): boolean {
  return error instanceof JsonRpcError && /no rollout found|invalid session id/i.test(error.message);
}
