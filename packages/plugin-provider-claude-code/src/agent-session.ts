import { randomUUID } from 'node:crypto';
import type { AgentStepEvent, AgentStepRequest, AgentToolCall, AgentToolOutcome, ToolDef } from '@moxxy/sdk';
import {
  Inbox,
  agentModeFor,
  earlierConversationNote,
  idleToolsHandler,
  moxxyToolsHandler,
  resumeAgentSession,
  sameToolNames,
  startMoxxyMcpServer,
  type AgentMode,
  type LiveSession,
  type MoxxyMcpServer,
  type NewSessionReason,
  untilStopped,
} from '@moxxy/agent-connection-kit';
import { fromClaudeQuestions, toClaudeAnswers } from './questions.js';
import type {
  ClaudeAgentSdk,
  ClaudeEffort,
  ClaudeMessage,
  ClaudePermissionMode,
  ClaudePermissionResult,
  ClaudePreToolUseOutput,
  ClaudeQuery,
  ClaudeUserContent,
  ClaudeUserMessage,
} from './sdk-types.js';
import {
  MOXXY_MCP_SERVER,
  MOXXY_TOOL_PREFIX,
  TurnTranslator,
  goalStatusFrom,
  isModeChange,
  toClaudeContent,
  toTokenUsage,
} from './translate.js';

export interface ClaudeSessionSettings {
  readonly sdk: ClaudeAgentSdk;
  readonly cwd: string;
  readonly model: string;
  readonly effort?: ClaudeEffort;
  /** The person's own Claude Code CLI. */
  readonly executable?: string;
  readonly resume?: string;
  readonly permissionMode?: ClaudePermissionMode;
  /** Every Moxxy tool of the conversation: Claude reads the list as it starts, and again on a notice. */
  readonly tools?: ReadonlyArray<ToolDef>;
}

/**
 * Moxxy tools Claude Code already has its own of, so they are not lent over
 * MCP: its file and shell tools, web, background jobs, questions, skills,
 * memory, its own plan (ExitPlanMode) and goal (`/goal`). `recall` is lent:
 * it searches Moxxy's record of the whole conversation, which outlives
 * Claude's own session.
 */
const CLAUDE_HAS_ITS_OWN = new Set([
  'Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Sleep', 'Wait', 'StopJob',
  'web_search', 'web_fetch', 'ask_user', 'session_recall',
  'load_skill', 'reload_skills', 'synthesize_skill', 'load_tool',
  'plan_complete', 'goal_complete', 'goal_abandon',
]);

export function toolsLentToClaude(tools: ReadonlyArray<ToolDef>): ToolDef[] {
  return tools.filter((tool) => !CLAUDE_HAS_ITS_OWN.has(tool.name) && !tool.name.startsWith('memory_'));
}

/** The permission mode a new Claude starts in; `undefined` keeps the mode from the person's Claude settings. */
export function startingPermissionMode(mode: AgentMode, autoApprove: boolean): ClaudePermissionMode | undefined {
  if (mode === 'plan') return 'plan';
  if (mode === 'goal' || autoApprove) return 'bypassPermissions';
  return undefined;
}

type Item =
  | { readonly kind: 'message'; readonly message: ClaudeMessage }
  | { readonly kind: 'ended'; readonly error?: string }
  | {
      readonly kind: 'approve';
      readonly callId: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
      readonly description?: string;
      readonly resolve: (result: ClaudePermissionResult) => void;
    }
  | {
      readonly kind: 'hook';
      readonly callId: string;
      readonly name: string;
      readonly input: unknown;
      readonly resolve: (output: ClaudePreToolUseOutput) => void;
    }
  | { readonly kind: 'moxxy-tool'; readonly call: AgentToolCall; readonly resolve: (outcome: AgentToolOutcome) => void };

const NOT_IN_A_TURN = 'Nobody is in the Moxxy conversation right now to answer this.';
/** In goal mode `/goal` must start the message, so the conversation so far goes first, on its own. */
const READ_ONLY_REPLY = 'Reply with OK only: the person\'s message follows next.';
class SessionGone extends Error {}
const MAX_STDERR = 2048;

/**
 * One running Claude Code (one Agent SDK `query()`) for one Moxxy
 * conversation. Every message the person sends is the next user message of
 * the same query, so Claude keeps its context, tools and goal between turns.
 * Everything Claude asks of Moxxy (approvals, the PreToolUse rule check,
 * Moxxy tools over MCP) is queued with its messages and handled in order, so
 * the log shows a call before the decision about it.
 */
export class ClaudeAgentSession implements LiveSession {
  private readonly input = new Inbox<ClaudeUserMessage | null>();
  private readonly inbox = new Inbox<Item>();
  private readonly query: ClaudeQuery;
  private alive = true;
  private closed = false;
  private inTurn = false;
  /** A turn ended before Claude's `result` (its reader stopped early); the next turn waits it out. */
  private owesResult = false;
  private permissionMode: ClaudePermissionMode | undefined;
  private model: string;
  private goalActive = false;
  private stderr = '';
  /** The Moxxy tools Claude is shown: every one of the conversation, the same in every mode. */
  private listed: ToolDef[];

  static async start(settings: ClaudeSessionSettings): Promise<ClaudeAgentSession> {
    const checked = await withoutLostSession(settings);
    const mcp = await startMoxxyMcpServer({ name: 'moxxy' });
    try {
      return new ClaudeAgentSession(checked.settings, mcp, checked.newSession);
    } catch (err) {
      await mcp.close();
      throw err;
    }
  }

  private constructor(
    readonly settings: ClaudeSessionSettings,
    private readonly mcp: MoxxyMcpServer,
    /** Claude's session is new while the conversation may already have run: its first message carries the conversation so far. */
    private newSession: NewSessionReason | undefined,
  ) {
    this.model = settings.model;
    this.permissionMode = settings.permissionMode;
    // Claude reads Moxxy's tools as it starts: they are listed before it does.
    this.listed = toolsLentToClaude(settings.tools ?? []);
    mcp.setHandler(idleToolsHandler(this.listed));
    this.query = settings.sdk.query({
      prompt: this.userMessages(),
      options: {
        cwd: settings.cwd,
        model: settings.model,
        ...(settings.effort ? { effort: settings.effort } : {}),
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        ...(settings.executable ? { pathToClaudeCodeExecutable: settings.executable } : {}),
        ...(settings.permissionMode ? { permissionMode: settings.permissionMode } : {}),
        // Lets Moxxy's auto-approve switch Claude to bypassPermissions mid-session.
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        ...(settings.resume ? { resume: settings.resume } : {}),
        mcpServers: { [MOXXY_MCP_SERVER]: { type: 'http', url: mcp.url, headers: { Authorization: mcp.authorization } } },
        canUseTool: (name, input, options) => this.onCanUseTool(name, input, options),
        hooks: { PreToolUse: [{ hooks: [async (input) => this.onPreToolUse(input.tool_name, input.tool_input, input.tool_use_id)] }] },
        env: claudeEnv(),
        stderr: (data) => {
          this.stderr = (this.stderr + data).slice(-MAX_STDERR);
        },
      },
    });
    void this.pump();
  }

  get isAlive(): boolean {
    return this.alive;
  }

  /** Whether this Claude was started with what the turn needs (settings a running Claude cannot change). */
  fits(settings: Pick<ClaudeSessionSettings, 'effort' | 'executable' | 'cwd'>): boolean {
    return (
      settings.effort === this.settings.effort &&
      settings.executable === this.settings.executable &&
      settings.cwd === this.settings.cwd
    );
  }

  async *turn(req: AgentStepRequest): AsyncGenerator<AgentStepEvent> {
    const mode = agentModeFor(req.mode);
    this.inTurn = true;
    const interrupt = () => void this.query.interrupt().catch(() => undefined);
    req.signal.addEventListener('abort', interrupt, { once: true });
    const all = toolsLentToClaude(req.allTools ?? req.tools);
    if (!sameToolNames(all, this.listed)) this.listed = all;
    this.mcp.setHandler(
      moxxyToolsHandler(this.listed, {
        runTool: (call) => new Promise((resolve) => this.inbox.push({ kind: 'moxxy-tool', call, resolve })),
      }),
    );
    try {
      // The conversation gained or lost a tool since Claude read the list: it reads it again on this notice.
      await this.mcp.announceTools({ signal: req.signal });
      if (this.owesResult && !(await this.settlePrevious())) {
        yield this.endedError();
        return;
      }
      await this.align(req, mode);
      const note = this.newSession ? earlierConversationNote(this.newSession, req.earlierConversation?.()) : undefined;
      this.newSession = undefined;
      const prefix = mode === 'goal' && !this.goalActive ? '/goal ' : '';
      if (note && prefix) await this.silently(`${note}\n\n${READ_ONLY_REPLY}`);
      if (mode === 'goal') this.goalActive = true;
      const content = toClaudeContent(req.prompt, prefix);
      this.send(note && !prefix && typeof content !== 'string' ? [{ type: 'text', text: note }, ...content] : content);
      const translator = new TurnTranslator(this.settings.cwd);
      for (;;) {
        const item = await this.inbox.next();
        if (item.kind === 'ended') {
          yield this.endedError(item.error);
          return;
        }
        if (item.kind === 'message') {
          if (isPersonResult(item.message)) {
            this.owesResult = false;
            yield* resultEvents(item.message, req.signal.aborted);
            break;
          }
          if (isInit(item.message)) this.permissionMode = item.message.permissionMode ?? this.permissionMode;
          else if (isModeChange(item.message)) this.permissionMode = item.message.permissionMode;
          for (const event of translator.translate(item.message)) {
            // In goal mode Claude runs bypassPermissions for the goal, not because the person chose auto-approve.
            if (event.type === 'auto_approve' && mode === 'goal') continue;
            yield event;
          }
          continue;
        }
        yield* this.handle(item, req, translator);
      }
      if (mode === 'goal' && !req.signal.aborted) {
        const status = await this.goalStatus();
        if (status === 'complete') this.goalActive = false;
        if (status) yield { type: 'goal', status };
      }
    } finally {
      req.signal.removeEventListener('abort', interrupt);
      this.mcp.setHandler(idleToolsHandler(this.listed));
      this.inTurn = false;
      this.dismissQueued();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.alive = false;
    this.input.push(null);
    this.query.close();
    this.dismissQueued();
    await this.mcp.close();
  }

  /** What Claude asked of Moxxy, answered in order with the turn's host. */
  private async *handle(item: Exclude<Item, { kind: 'message' | 'ended' }>, req: AgentStepRequest, translator: TurnTranslator): AsyncGenerator<AgentStepEvent> {
    switch (item.kind) {
      case 'moxxy-tool':
        item.resolve(await req.host.runTool(item.call));
        return;
      case 'hook': {
        yield* translator.announce(item.callId, item.name, item.input);
        const decision = await req.host.approve({ callId: item.callId, name: item.name, input: item.input, policyOnly: true });
        item.resolve(
          decision.allow
            ? {}
            : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } },
        );
        return;
      }
      case 'approve':
        if (item.name === 'AskUserQuestion') {
          item.resolve(await this.answerQuestion(item.input, req));
          return;
        }
        yield* translator.announce(item.callId, item.name, item.input);
        item.resolve(await this.decide(item, req));
        return;
    }
  }

  private async decide(item: Extract<Item, { kind: 'approve' }>, req: AgentStepRequest): Promise<ClaudePermissionResult> {
    const plan = item.name === 'ExitPlanMode' && typeof item.input.plan === 'string' ? item.input.plan : undefined;
    const description = plan ?? item.description;
    const decision = await untilStopped(
      req.host.approve({ callId: item.callId, name: item.name, input: item.input, ...(description ? { description } : {}) }),
      req.signal,
      { allow: false as const, reason: 'The person stopped the turn.' },
    );
    if (!decision.allow) return { behavior: 'deny', message: decision.reason };
    // An approved plan runs at once; with auto-approve on, without asking again.
    if (plan !== undefined && req.autoApprove) void this.setPermissionMode('bypassPermissions');
    return { behavior: 'allow', updatedInput: item.input };
  }

  private async answerQuestion(input: Record<string, unknown>, req: AgentStepRequest): Promise<ClaudePermissionResult> {
    const items = fromClaudeQuestions(input);
    const outcome = await untilStopped(req.host.ask(items), req.signal, { kind: 'dismissed' as const, reason: 'cancelled' as const });
    switch (outcome.kind) {
      case 'answered':
        return { behavior: 'allow', updatedInput: { ...input, answers: toClaudeAnswers(items, outcome.answers) } };
      case 'dismissed':
        return { behavior: 'deny', message: 'The person closed the question without answering.' };
      case 'unanswerable':
        return {
          behavior: 'deny',
          message: 'Nobody is there to answer questions right now. Pick the sensible choice yourself and say which one you picked.',
        };
    }
  }

  /** Model, mode and goal as this turn wants them, changed on the running Claude. */
  private async align(req: AgentStepRequest, mode: AgentMode): Promise<void> {
    if (req.model && req.model !== this.model) {
      await this.query.setModel(req.model);
      this.model = req.model;
    }
    if (mode !== 'goal' && this.goalActive) {
      await this.silently('/goal clear');
      this.goalActive = false;
    }
    const wanted =
      startingPermissionMode(mode, req.autoApprove) ??
      (this.permissionMode === 'bypassPermissions' || this.permissionMode === 'plan' ? 'default' : undefined);
    if (wanted && wanted !== this.permissionMode) await this.setPermissionMode(wanted);
  }

  private async setPermissionMode(mode: ClaudePermissionMode): Promise<void> {
    await this.query.setPermissionMode(mode);
    this.permissionMode = mode;
  }

  /** After a goal turn: ask `/goal` once whether the goal is still open. Its answer is not shown. */
  private async goalStatus(): Promise<'active' | 'complete' | undefined> {
    let status: 'active' | 'complete' | undefined;
    await this.silently('/goal', (message) => {
      if (message.type !== 'assistant' || !('message' in message)) return;
      for (const block of message.message.content) {
        if (block.type === 'text' && 'text' in block && typeof block.text === 'string') status = goalStatusFrom(block.text) ?? status;
      }
    });
    return status;
  }

  /** Send a command and read through to its result without showing anything. */
  private async silently(text: string, onMessage?: (message: ClaudeMessage) => void): Promise<void> {
    this.send(text);
    for (;;) {
      const item = await this.inbox.next();
      if (item.kind === 'ended') return;
      if (item.kind !== 'message') {
        refuse(item);
        continue;
      }
      if (isPersonResult(item.message)) {
        this.owesResult = false;
        return;
      }
      onMessage?.(item.message);
    }
  }

  /** Wait out the result of a turn whose reader stopped early, so it does not leak into this one. */
  private async settlePrevious(): Promise<boolean> {
    await this.query.interrupt().catch(() => undefined);
    for (;;) {
      const item = await this.inbox.next();
      if (item.kind === 'ended') return false;
      if (item.kind !== 'message') refuse(item);
      else if (isPersonResult(item.message)) {
        this.owesResult = false;
        return true;
      }
    }
  }

  private send(content: ClaudeUserContent): void {
    this.owesResult = true;
    this.input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' } });
  }

  private async *userMessages(): AsyncGenerator<ClaudeUserMessage> {
    for (;;) {
      const message = await this.input.next();
      if (message === null) return;
      yield message;
    }
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.query) this.inbox.push({ kind: 'message', message });
      this.inbox.push({ kind: 'ended' });
    } catch (err) {
      this.inbox.push({ kind: 'ended', error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.alive = false;
    }
  }

  private onCanUseTool(
    name: string,
    input: Record<string, unknown>,
    options: { readonly toolUseID?: string; readonly description?: string; readonly title?: string; readonly mcpServer?: { readonly name: string; readonly source: string } },
  ): Promise<ClaudePermissionResult> {
    // Moxxy asks about its own tools when it runs them; a second window would ask twice.
    const server = options.mcpServer;
    if (name.startsWith(MOXXY_TOOL_PREFIX) && server && server.name === MOXXY_MCP_SERVER && server.source === 'dynamic') {
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }
    if (!this.inTurn) return Promise.resolve({ behavior: 'deny', message: NOT_IN_A_TURN });
    const description = options.description ?? options.title;
    return new Promise((resolve) =>
      this.inbox.push({ kind: 'approve', callId: options.toolUseID ?? randomUUID(), name, input, ...(description ? { description } : {}), resolve }),
    );
  }

  private onPreToolUse(name: string, input: unknown, callId: string): Promise<ClaudePreToolUseOutput> {
    if (name.startsWith(MOXXY_TOOL_PREFIX) || !this.inTurn) return Promise.resolve({});
    return new Promise((resolve) => this.inbox.push({ kind: 'hook', callId, name, input, resolve }));
  }

  /** Answer whatever is still queued once no turn can: Claude must never wait on Moxxy forever. */
  private dismissQueued(): void {
    for (const item of this.inbox.drain()) {
      if (item.kind === 'message' || item.kind === 'ended') {
        if (item.kind === 'message' && isPersonResult(item.message)) this.owesResult = false;
        if (item.kind === 'ended') this.inbox.push(item);
        continue;
      }
      refuse(item);
    }
  }

  private endedError(error?: string): AgentStepEvent {
    const detail = error ?? 'Claude Code stopped.';
    const stderr = this.stderr.trim();
    return { type: 'error', message: stderr && !detail.includes(stderr) ? `${detail}\n${stderr}` : detail, retryable: false };
  }
}

/**
 * The settings to start Claude with: without `resume` when Claude's session
 * for this conversation no longer exists (Claude would fail every turn on it),
 * so the conversation goes on in a new one. A check that keeps failing stops
 * the turn rather than start over.
 */
async function withoutLostSession(settings: ClaudeSessionSettings): Promise<{ settings: ClaudeSessionSettings; newSession?: NewSessionReason }> {
  const { resume, sdk } = settings;
  if (!resume) return { settings, newSession: 'new' };
  if (!sdk.getSessionInfo) return { settings };
  const resumed = await resumeAgentSession({
    label: 'Claude Code',
    load: async () => {
      if (!(await sdk.getSessionInfo?.(resume))) throw new SessionGone(`Claude has no session ${resume}.`);
      return resume;
    },
    gone: (error) => error instanceof SessionGone,
  });
  if (resumed.kind === 'loaded') return { settings };
  const { resume: _lost, ...fresh } = settings;
  return { settings: fresh, newSession: 'lost' };
}

function refuse(item: Exclude<Item, { kind: 'message' | 'ended' }>): void {
  switch (item.kind) {
    case 'approve':
      item.resolve({ behavior: 'deny', message: NOT_IN_A_TURN });
      return;
    case 'hook':
      item.resolve({});
      return;
    case 'moxxy-tool':
      item.resolve({ ok: false, message: 'No Moxxy turn is running, so the tool cannot run now.' });
      return;
  }
}

function* resultEvents(message: Extract<ClaudeMessage, { type: 'result' }>, stopped: boolean): Generator<AgentStepEvent> {
  if (message.usage) yield { type: 'usage', usage: toTokenUsage(message.usage) };
  if (!message.is_error || stopped) return;
  const detail = message.errors && message.errors.length > 0 ? message.errors.join('; ') : (message.result ?? message.subtype);
  yield { type: 'error', message: `Claude Code: ${detail}`, retryable: false };
}

function isPersonResult(message: ClaudeMessage): message is Extract<ClaudeMessage, { type: 'result' }> {
  if (message.type !== 'result' || !('is_error' in message)) return false;
  // A turn Claude started itself after a background task is not the person's.
  const origin = (message as { origin?: { kind?: string } }).origin;
  return origin === undefined || origin.kind === 'human';
}

function isInit(message: ClaudeMessage): message is Extract<ClaudeMessage, { subtype: 'init' }> {
  return message.type === 'system' && 'subtype' in message && message.subtype === 'init';
}

/**
 * The environment for Claude Code: Moxxy's own, without the markers that make
 * Claude refuse to start as a nested session when Moxxy itself was launched
 * from Claude Code. The SDK replaces the environment, so it is spread here.
 */
export function claudeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'moxxy' };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}
