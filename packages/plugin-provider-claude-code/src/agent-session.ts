import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AgentScheduledWakeup, AgentStepEvent, AgentStepHost, AgentStepRequest, AgentToolCall, AgentToolOutcome, Skill, ToolDef } from '@moxxy/sdk';
import {
  Inbox,
  agentModeFor,
  earlierConversationNote,
  idleToolsHandler,
  moxxyToolsHandler,
  resumeAgentSession,
  sameToolNames,
  skillsForAgent,
  startMoxxyMcpServer,
  type AgentMode,
  type LiveSession,
  type MoxxyMcpServer,
  type NewSessionReason,
  untilStopped,
  withoutOwnMcpServers,
} from '@moxxy/agent-connection-kit';
import { isContextWindowSize } from '@moxxy/sdk';
import { fromClaudeQuestions, toClaudeAnswers } from './questions.js';
import type {
  ClaudeAgentSdk,
  ClaudeEffort,
  ClaudeMessage,
  ClaudeModelUsage,
  ClaudePermissionMode,
  ClaudePermissionResult,
  ClaudePreToolUseOutput,
  ClaudeQuery,
  ClaudeUserContent,
  ClaudeUserMessage,
  ClaudeStopInput,
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
import { ClaudeBackgroundWork } from './background-work.js';
import { ClaudeSubagents } from './subagents.js';
import { ClaudeTaskList } from './task-list.js';
import { dueWakeup, wakeupsOf } from './scheduled-wakeups.js';

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
  /** The conversation's Moxxy skills: Claude reads those meant for it through one more Moxxy tool. */
  readonly skills?: ReadonlyArray<Skill>;
  /** Claude took up a turn by itself while no Moxxy turn runs; `name` says what for, `workId` which background work ended. */
  readonly onAgentTurn?: (name: string, workId?: string) => void;
  /** What Claude's background work did, for the conversation to record at once: its list, a command's end, a helper's steps between turns. */
  readonly onActivity?: (events: ReadonlyArray<AgentStepEvent>) => void;
}

/**
 * Moxxy tools Claude Code already has its own of, so they are not lent over
 * MCP: its file and shell tools, web, background jobs, questions, skills,
 * memory, its own plan (ExitPlanMode) and goal (`/goal`). `recall` is lent:
 * it searches Moxxy's record of the whole conversation, which outlives
 * Claude's own session. The person's Moxxy skills come as a `load_skill` of
 * their own, listing them (see agent-skills).
 */
const CLAUDE_HAS_ITS_OWN = new Set([
  'Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Sleep', 'Wait', 'StopJob',
  'web_search', 'web_fetch', 'ask_user', 'session_recall',
  'load_skill', 'reload_skills', 'synthesize_skill', 'load_tool',
  'plan_complete', 'goal_complete', 'goal_abandon',
]);

const toolNames = (tools: ReadonlyArray<ToolDef>) => tools.map((tool) => tool.name);

/**
 * Moxxy's tools reach Claude as a catalog of three small tools. Claude lists
 * every deferred tool by name in each request (hundreds once the person's MCP
 * servers are set up); behind the catalog it reads the groups and looks a tool
 * up when it wants one.
 */
const LENT_AS = { catalog: true } as const;

export function toolsLentToClaude(tools: ReadonlyArray<ToolDef>): ToolDef[] {
  return tools.filter((tool) => !CLAUDE_HAS_ITS_OWN.has(tool.name) && !tool.name.startsWith('memory_'));
}

/** Modes in which Claude acts without asking the person: `auto` lets its own classifier decide. */
export function runsWithoutAsking(mode: ClaudePermissionMode | undefined): boolean {
  return mode === 'bypassPermissions' || mode === 'auto';
}

/**
 * The permission mode a new Claude starts in; `undefined` keeps the mode from
 * the person's Claude settings. `ownMode` is that mode when the conversation
 * recorded auto-approve off: one that acts without asking is set to ask, so the
 * person's switch wins over their own default.
 */
export function startingPermissionMode(mode: AgentMode, autoApprove: boolean, ownMode?: ClaudePermissionMode): ClaudePermissionMode | undefined {
  if (mode === 'plan') return 'plan';
  if (mode === 'goal' || autoApprove) return 'bypassPermissions';
  return runsWithoutAsking(ownMode) ? 'default' : undefined;
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
      /** Asked from inside one of Claude's subagents. */
      readonly inSubagent: boolean;
      readonly resolve: (result: ClaudePermissionResult) => void;
    }
  | {
      readonly kind: 'hook';
      readonly callId: string;
      readonly name: string;
      readonly input: unknown;
      readonly inSubagent: boolean;
      readonly resolve: (output: ClaudePreToolUseOutput) => void;
    }
  | { readonly kind: 'moxxy-tool'; readonly call: AgentToolCall; readonly resolve: (outcome: AgentToolOutcome) => void };

const NOT_IN_A_TURN = 'Nobody is in the Moxxy conversation right now to answer this.';
const NO_RULES_YET = 'Moxxy could not check this call against its rules: no turn has run in this conversation yet.';
/** Moxxy's record of the conversation goes first, on its own (and `/goal` must start the person's message). */
const READ_ONLY_REPLY = 'Reply with OK only: the person\'s message follows next.';
class SessionGone extends Error {}
const MAX_STDERR = 2048;
/** Where Claude's plan mode keeps the plan it writes: `~/.claude/plans/<name>.md`. */
const PLAN_FILE = /[\\/]\.claude[\\/]plans[\\/][^\\/]+\.md$/;

/** The plan file a Write or Edit of Claude's touches, if it is one. */
export function claudePlanFileOf(name: string, input: unknown): string | undefined {
  if (name !== 'Write' && name !== 'Edit' && name !== 'MultiEdit') return undefined;
  const path = typeof input === 'object' && input !== null ? (input as { file_path?: unknown }).file_path : undefined;
  return typeof path === 'string' && PLAN_FILE.test(path) ? path : undefined;
}
/** Claude's answer for a plan the person now decides on in Moxxy: no "approved", no second copy of it. */
const PLAN_HANDED_OVER =
  'The plan is now with the person in Moxxy, who will implement it, have it rewritten or dismiss it there. ' +
  'Stay in plan mode and end your turn now without repeating the plan.';

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
  /** This turn handed Claude's plan to the plan card through ExitPlanMode. */
  private planHandedOver = false;
  /** A turn ended before Claude's `result` (its reader stopped early); the next turn waits it out. */
  private owesResult = false;
  /** Claude took up a turn by itself and no Moxxy turn has read it yet. */
  private agentTurnPending = false;
  /** When Claude set itself to come back, as its last `Stop` said. */
  private wakeups: AgentScheduledWakeup[] = [];
  /** Claude's tasks by id, named as they started, to say which one finished. */
  private readonly taskNames = new Map<string, string>();
  /** The task whose end Claude takes up next, once it finished in the background. */
  private finishedTask: string | undefined;
  /** That task as Moxxy's background work (`AgentBackgroundWork.id`). */
  private finishedWork: string | undefined;
  /** What Claude runs in the background, as its list says. */
  private readonly background = new ClaudeBackgroundWork();
  /** The last turn's host: Moxxy's rules for a call made while no turn runs (a helper in the background). */
  private lastHost: AgentStepHost | undefined;
  private permissionMode: ClaudePermissionMode | undefined;
  /** Claude's task list, which its tools change one task at a time across turns. */
  private readonly tasks = new ClaudeTaskList();
  /** Claude's subagents; one in the background ends after the turn that started it. */
  private readonly subagents = new ClaudeSubagents();
  /** Reads a background helper's messages while no turn runs; the next turn reads them again and shows nothing twice. */
  private readonly between: TurnTranslator;
  /** The conversation's auto-approve as this turn knows it: as it began, then as Claude's mode changed it. */
  private switchedOn = false;
  private model: string;
  private goalActive = false;
  private stderr = '';
  /** The Moxxy tools Claude is shown: every one of the conversation, the same in every mode. */
  private listed: ToolDef[];
  /** The Moxxy skills Claude is offered. */
  private offered: Skill[];

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
    this.between = new TurnTranslator(settings.cwd, this.tasks, this.subagents);
    // Claude reads Moxxy's tools as it starts: they are listed before it does.
    this.listed = toolsLentToClaude(settings.tools ?? []);
    this.offered = skillsForAgent(settings.skills ?? [], toolNames(this.listed), []);
    mcp.setHandler(idleToolsHandler(this.listed, this.offered, LENT_AS));
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
        hooks: {
          PreToolUse: [{ hooks: [async (input) => this.onPreToolUse(input.tool_name, input.tool_input, input.tool_use_id, input.agent_id !== undefined)] }],
          Stop: [{ hooks: [async (input) => this.onStop(input)] }],
        },
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
    // Claude's own turn was already read by a turn of the person's.
    if (req.continuesAgentTurn && !this.agentTurnPending) return;
    const ownTurn = req.continuesAgentTurn === true;
    const mode = agentModeFor(req.mode);
    this.inTurn = true;
    this.lastHost = req.host;
    this.switchedOn = req.autoApprove;
    const interrupt = () => void this.query.interrupt().catch(() => undefined);
    req.signal.addEventListener('abort', interrupt, { once: true });
    const all = withoutOwnMcpServers(toolsLentToClaude(req.allTools ?? req.tools), await this.ownMcpServerNames());
    if (!sameToolNames(all, this.listed)) this.listed = all;
    try {
      this.offered = skillsForAgent(req.skills ?? [], toolNames(this.listed), await this.ownSkillNames());
      this.mcp.setHandler(
        moxxyToolsHandler(
          this.listed,
          { runTool: (call) => new Promise((resolve) => this.inbox.push({ kind: 'moxxy-tool', call, resolve })) },
          this.offered,
          LENT_AS,
        ),
      );
      // The conversation gained or lost a tool or a skill since Claude read the list: it reads it again on this notice.
      await this.mcp.announceTools({ signal: req.signal });
      if (!ownTurn) {
        if (this.owesResult && !(await this.settlePrevious())) {
          yield this.endedError();
          return;
        }
        await this.align(req, mode);
        const note = this.newSession ? earlierConversationNote(this.newSession, req.earlierConversation?.()) : req.missedTurns?.();
        this.newSession = undefined;
        const prefix = mode === 'goal' && !this.goalActive ? '/goal ' : '';
        // The record goes in a message of its own: sent together, Claude took the person's message for part of the record.
        if (note) await this.silently(`${note}\n\n${READ_ONLY_REPLY}`);
        if (mode === 'goal') this.goalActive = true;
        this.send(toClaudeContent(req.prompt, prefix));
      }
      const translator = new TurnTranslator(this.settings.cwd, this.tasks, this.subagents);
      this.planHandedOver = false;
      let planFile: string | undefined;
      for (;;) {
        const item = await this.inbox.next();
        if (item.kind === 'ended') {
          yield* translator.finish();
          yield this.endedError(item.error);
          return;
        }
        if (item.kind === 'message') {
          if (isOwnResult(item.message, this.owesResult)) {
            this.agentTurnPending = false;
            this.finishedTask = undefined;
            this.finishedWork = undefined;
            if (ownTurn) {
              yield* translator.finish();
              yield* resultEvents(item.message, req.signal.aborted, this.model);
              break;
            }
          }
          if (isPersonResult(item.message, this.owesResult)) {
            this.owesResult = false;
            yield* translator.finish();
            yield* resultEvents(item.message, req.signal.aborted, this.model);
            break;
          }
          const reported = isInit(item.message) || isModeChange(item.message) ? item.message.permissionMode : undefined;
          // Only the person lets Claude act without asking: a mode that does, set outside Moxxy while auto-approve is off, is set back.
          // A mode not known yet is the person's own Claude setup, shown as it is.
          const was = this.permissionMode;
          const restore = reported !== undefined && was !== undefined && mode !== 'goal' && !this.switchedOn && runsWithoutAsking(reported) && !runsWithoutAsking(was);
          if (restore) {
            await this.setPermissionMode(was);
            yield { type: 'auto_approve_restored' };
          } else if (reported !== undefined) {
            this.permissionMode = reported;
          }
          for (const event of translator.translate(item.message)) {
            if (event.type === 'tool_call') planFile = claudePlanFileOf(event.name, event.input) ?? planFile;
            if (event.type === 'auto_approve') {
              // In goal mode Claude runs bypassPermissions for the goal, not because the person chose auto-approve.
              if (mode === 'goal' || restore) continue;
              this.switchedOn = event.enabled;
              yield isModeChange(item.message) ? { ...event, elsewhere: true } : event;
              continue;
            }
            yield event;
          }
          continue;
        }
        yield* this.handle(item, req, translator, mode);
      }
      // Claude wrote or changed its plan but ended without handing it over: it still goes on the plan card.
      if (mode === 'plan' && !this.planHandedOver && planFile && !req.signal.aborted) {
        const plan = await readFile(planFile, 'utf8').catch(() => '');
        if (plan.trim()) yield { type: 'plan', text: plan.trim() };
      }
      if (mode === 'goal' && !ownTurn && !req.signal.aborted) {
        const status = await this.goalStatus();
        if (status === 'complete') this.goalActive = false;
        if (status) yield { type: 'goal', status };
      }
    } finally {
      req.signal.removeEventListener('abort', interrupt);
      this.mcp.setHandler(idleToolsHandler(this.listed, this.offered, LENT_AS));
      this.inTurn = false;
      this.dismissQueued();
    }
  }

  /** Stop one work Claude runs in the background (`AgentBackgroundWork.id`); `false` when Claude runs no such work. */
  async stopWork(workId: string): Promise<boolean> {
    const task = this.background.taskOf(workId);
    if (task === undefined || !this.alive) return false;
    await this.query.stopTask(task);
    return true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.alive = false;
    // Claude's background work ends with it.
    this.report(this.background.stopped());
    this.input.push(null);
    this.query.close();
    this.dismissQueued();
    await this.mcp.close();
  }

  /** What Claude asked of Moxxy, answered in order with the turn's host. */
  private async *handle(item: Exclude<Item, { kind: 'message' | 'ended' }>, req: AgentStepRequest, translator: TurnTranslator, mode: AgentMode): AsyncGenerator<AgentStepEvent> {
    switch (item.kind) {
      case 'moxxy-tool':
        item.resolve(await req.host.runTool(item.call));
        return;
      case 'hook': {
        yield* translator.announce(item.callId, item.name, item.input, { inSubagent: item.inSubagent });
        const decision = await req.host.approve({ callId: item.callId, name: item.name, input: item.input, policyOnly: true });
        item.resolve(
          decision.allow ? {} : refusedByRules(decision.reason),
        );
        return;
      }
      case 'approve':
        if (item.name === 'AskUserQuestion') {
          item.resolve(await this.answerQuestion(item.input, req));
          return;
        }
        // In Moxxy's plan mode the plan is the person's to answer on the plan card, like Codex's and OpenCode's.
        if (item.name === 'ExitPlanMode' && mode === 'plan' && typeof item.input.plan === 'string') {
          yield* translator.announce(item.callId, item.name, item.input, { inSubagent: item.inSubagent });
          yield* translator.handOver(item.callId, 'The plan is with the person, on the plan card.');
          this.planHandedOver = true;
          yield { type: 'plan', text: item.input.plan };
          item.resolve({ behavior: 'deny', message: PLAN_HANDED_OVER });
          return;
        }
        yield* translator.announce(item.callId, item.name, item.input, { inSubagent: item.inSubagent });
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
    if (plan !== undefined && this.switchedOn) void this.setPermissionMode('bypassPermissions');
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
    // Known before Claude reports it back, so the report is not taken for a change made elsewhere.
    this.permissionMode = mode;
    await this.query.setPermissionMode(mode);
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
  /** Claude's own skills and commands, not its built-in ones: a Moxxy skill of the same name is left to Claude's. */
  /** Claude's own MCP servers that are on: Moxxy's server of the same name is left to Claude's. */
  private async ownMcpServerNames(): Promise<string[]> {
    try {
      const servers = await this.query.mcpServerStatus();
      return servers.filter((server) => server.name !== MOXXY_MCP_SERVER && server.status !== 'disabled').map((server) => server.name);
    } catch {
      return [];
    }
  }

  private async ownSkillNames(): Promise<string[]> {
    try {
      const commands = await this.query.supportedCommands();
      return commands.filter((command) => !command.builtin).flatMap((command) => [command.name, ...(command.aliases ?? [])]);
    } catch {
      return [];
    }
  }

  private async silently(text: string, onMessage?: (message: ClaudeMessage) => void): Promise<void> {
    this.send(text);
    for (;;) {
      const item = await this.inbox.next();
      if (item.kind === 'ended') return;
      if (item.kind !== 'message') {
        refuse(item);
        continue;
      }
      if (isPersonResult(item.message, this.owesResult)) {
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
      else if (isPersonResult(item.message, this.owesResult)) {
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
      for await (const message of this.query) {
        this.inbox.push({ kind: 'message', message });
        this.notice(message);
      }
      this.inbox.push({ kind: 'ended' });
    } catch (err) {
      this.inbox.push({ kind: 'ended', error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.alive = false;
      this.report(this.background.stopped());
    }
  }

  private onCanUseTool(
    name: string,
    input: Record<string, unknown>,
    options: { readonly toolUseID?: string; readonly agentID?: string; readonly description?: string; readonly title?: string; readonly mcpServer?: { readonly name: string; readonly source: string } },
  ): Promise<ClaudePermissionResult> {
    // Moxxy asks about its own tools when it runs them; a second window would ask twice.
    const server = options.mcpServer;
    if (name.startsWith(MOXXY_TOOL_PREFIX) && server && server.name === MOXXY_MCP_SERVER && server.source === 'dynamic') {
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }
    if (!this.inTurn) return Promise.resolve({ behavior: 'deny', message: NOT_IN_A_TURN });
    const description = options.description ?? options.title;
    return new Promise((resolve) =>
      this.inbox.push({
        kind: 'approve',
        callId: options.toolUseID ?? randomUUID(),
        name,
        input,
        ...(description ? { description } : {}),
        inSubagent: options.agentID !== undefined,
        resolve,
      }),
    );
  }

  /** Claude ended a turn: what it set itself to come back for is said again, whenever it changed. */
  private async onStop(input: ClaudeStopInput): Promise<Record<string, never>> {
    // An older Claude does not say; nothing is listed rather than a guess.
    if (input.session_crons) this.setWakeups(wakeupsOf(input.session_crons, Date.now()));
    return {};
  }

  private setWakeups(wakeups: AgentScheduledWakeup[]): void {
    if (JSON.stringify(wakeups) === JSON.stringify(this.wakeups)) return;
    this.wakeups = wakeups;
    this.report([{ type: 'scheduled_wakeups', wakeups }]);
  }

  private onPreToolUse(name: string, input: unknown, callId: string, inSubagent: boolean): Promise<ClaudePreToolUseOutput> {
    if (name.startsWith(MOXXY_TOOL_PREFIX)) return Promise.resolve({});
    if (!this.inTurn) return this.checkRulesBetweenTurns(name, input, callId);
    return new Promise((resolve) => this.inbox.push({ kind: 'hook', callId, name, input, inSubagent, resolve }));
  }

  /** A call made while no turn runs (a helper in the background) still meets Moxxy's rules. */
  private async checkRulesBetweenTurns(name: string, input: unknown, callId: string): Promise<ClaudePreToolUseOutput> {
    const host = this.lastHost;
    if (!host) return refusedByRules(NO_RULES_YET);
    const decision = await host.approve({ callId, name, input, policyOnly: true });
    return decision.allow ? {} : refusedByRules(decision.reason);
  }

  /**
   * Watch what Claude sends whether or not a turn runs: which task finished,
   * and Claude taking up a turn by itself (its `init` while Moxxy is idle),
   * which the conversation opens a turn for.
   */
  private notice(message: ClaudeMessage): void {
    if (message.type === 'system') {
      const note = message as { subtype?: unknown; task_id?: unknown; tool_use_id?: unknown; description?: unknown };
      if (note.subtype === 'task_started' && typeof note.task_id === 'string' && typeof note.description === 'string') {
        this.taskNames.set(note.task_id, note.description);
      }
      if (note.subtype === 'task_notification' && typeof note.task_id === 'string') {
        this.finishedTask = this.taskNames.get(note.task_id) ?? this.finishedTask;
        this.finishedWork = this.background.workIdOf(note.task_id, typeof note.tool_use_id === 'string' ? note.tool_use_id : undefined);
        void this.background.end(note).then((events) => this.report(events));
      }
      this.report(this.background.fromNote(note));
    }
    if (!this.inTurn && isBackgroundHelperNote(message)) this.report(this.between.translate(message));
    if (this.closed || this.inTurn || this.owesResult || this.agentTurnPending || !isInit(message)) return;
    this.agentTurnPending = true;
    const due = this.finishedTask ? undefined : dueWakeup(this.wakeups, Date.now());
    // A one-shot wakeup is spent once Claude comes back for it; its Stop says what is left.
    if (due && !due.recurring) this.setWakeups(this.wakeups.filter((wakeup) => wakeup !== due));
    const name = this.finishedTask ? `${this.finishedTask} finished in the background` : due ? 'Scheduled check-in' : 'A background task finished';
    this.settings.onAgentTurn?.(name, this.finishedWork);
  }

  private report(events: ReadonlyArray<AgentStepEvent>): void {
    if (events.length > 0) this.settings.onActivity?.(events);
  }

  /**
   * Answer whatever is still queued once no turn can: Claude must never wait on
   * Moxxy forever. What is left of a turn whose reader stopped early is dropped,
   * up to its result; what Claude sent after it is its own (a helper in the
   * background, a turn it took up) and stays for the next reader.
   */
  private dismissQueued(): void {
    const kept: ClaudeMessage[] = [];
    let ended: Extract<Item, { kind: 'ended' }> | undefined;
    for (const item of this.inbox.drain()) {
      if (item.kind === 'ended') ended = item;
      else if (item.kind !== 'message') refuse(item);
      else if (!this.owesResult) kept.push(item.message);
      else if (isPersonResult(item.message, this.owesResult)) this.owesResult = false;
    }
    for (const message of kept) {
      this.inbox.push({ kind: 'message', message });
      this.notice(message);
    }
    if (ended) this.inbox.push(ended);
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

function* resultEvents(message: Extract<ClaudeMessage, { type: 'result' }>, stopped: boolean, model: string): Generator<AgentStepEvent> {
  if (message.usage) yield { type: 'usage', usage: toTokenUsage(message.usage) };
  const tokens = contextWindowOf(message.modelUsage, model);
  if (tokens !== undefined) yield { type: 'context_window', model, tokens };
  if (!message.is_error || stopped) return;
  const detail = message.errors && message.errors.length > 0 ? message.errors.join('; ') : (message.result ?? message.subtype);
  yield { type: 'error', message: `Claude Code: ${detail}`, retryable: false };
}

/**
 * The window Claude ran the model with. `modelUsage` is keyed by the model string Claude
 * used (`claude-opus-5-5[1m]`) and also lists helper models, so match the turn's own.
 */
function contextWindowOf(usage: Readonly<Record<string, ClaudeModelUsage>> | undefined, model: string): number | undefined {
  if (!usage) return undefined;
  for (const [key, entry] of Object.entries(usage)) {
    const named = key === model || key.replace(/\[[^\]]*\]$/, '') === model || entry.canonicalModel === model;
    if (named && isContextWindowSize(entry.contextWindow)) return entry.contextWindow;
  }
  return undefined;
}

/** The `result` of a turn Claude took up by itself. */
function isOwnResult(message: ClaudeMessage, owed: boolean): message is Extract<ClaudeMessage, { type: 'result' }> {
  return message.type === 'result' && 'is_error' in message && !isPersonResult(message, owed);
}

function refusedByRules(reason: string): ClaudePreToolUseOutput {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

/**
 * The `result` of the person's turn. A turn Claude started itself is not: one after a background
 * task carries its origin, but one it woke itself up for (ScheduleWakeup, /loop) carries none, so
 * a result without an origin is the person's only while Moxxy waits for one (`owed`), as from
 * a Claude too old to send origins.
 */
function isPersonResult(message: ClaudeMessage, owed: boolean): message is Extract<ClaudeMessage, { type: 'result' }> {
  if (message.type !== 'result' || !('is_error' in message)) return false;
  const origin = (message as { origin?: { kind?: string } }).origin;
  return origin === undefined ? owed : origin.kind === 'human';
}

/** A background helper's own message, or Claude's report on one of its tasks. */
function isBackgroundHelperNote(message: ClaudeMessage): boolean {
  if (message.type === 'assistant') return message.parent_tool_use_id !== null && message.parent_tool_use_id !== undefined;
  return message.type === 'system' && 'subtype' in message && (message.subtype === 'task_progress' || message.subtype === 'task_notification');
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
