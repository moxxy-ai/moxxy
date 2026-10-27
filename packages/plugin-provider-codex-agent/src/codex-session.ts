import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Readable, Writable } from 'node:stream';
import type {
  AgentAccountLimit,
  AgentApprovalDecision,
  AgentBackgroundWork,
  AgentStepEvent,
  AgentStepRequest,
  AgentToolCall,
  AgentToolOutcome,
  AgentWorkEnd,
  QuestionItem,
  QuestionOutcome,
  Skill,
  ToolDef,
} from '@moxxy/sdk';
import { QUESTION_CLOSED_AGENT_WENT_ON, QUESTION_CLOSED_NEW_MESSAGE, isContextWindowSize } from '@moxxy/sdk';
import {
  Inbox,
  JsonRpcError,
  JsonRpcLineClient,
  agentModeFor,
  earlierConversationNote,
  idleToolsHandler,
  moxxyToolsHandler,
  resumeAgentSession,
  sameSkills,
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
import { MOXXY_MCP_SERVER } from './constants.js';
import type {
  CodexApprovalPolicy,
  CodexApprovalsReviewer,
  CodexBackgroundTerminals,
  CodexConfigRead,
  CodexGoal,
  CodexRateLimitSnapshot,
  CodexSandboxPolicy,
  CodexSkillsList,
  CodexThreadResponse,
  CodexThreadSettingsReport,
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
  type CodexAskedQuestions,
  type CodexToolCall,
} from './translate.js';
import { accountLimitFrom, failedOnUsageLimit } from './account-limit.js';
import { CodexSubagents, labelOf } from './subagents.js';
import { readImageFile } from './view-image.js';

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
  /**
   * The model the turn runs. The thread opens on it: one opened on the config's
   * model and switched before the turn carries Codex's model-switch
   * instructions in every request after.
   */
  readonly model?: string;
  /** Every Moxxy tool of the conversation: Codex reads the list once, as the thread opens or resumes. */
  readonly tools?: ReadonlyArray<ToolDef>;
  /** The conversation's Moxxy skills: Codex reads those meant for it through one more Moxxy tool, listed with the tools. */
  readonly skills?: ReadonlyArray<Skill>;
  /** Work Codex left running ended while no Moxxy turn runs; `name` says what, `workId` which work. Codex itself starts no turn then. */
  readonly onAgentTurn?: (name: string, workId?: string) => void;
  /** What Codex's background work did, for the conversation to record at once: its list, a command's end, a subagent's steps after its turn. */
  readonly onActivity?: (events: ReadonlyArray<AgentStepEvent>) => void;
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
/** Only reading: what plan mode and the model's own asking run in. */
const READ_ONLY: CodexSandboxPolicy = { type: 'readOnly', networkAccess: false };
/**
 * Without auto-approve on a Codex set up for it: under `untrusted` Codex holds
 * every command but a known-safe read, and every edit, for the person, whatever
 * the sandbox. Under `on-request` it was the model's call to ask, and it mostly
 * tried the write, was blocked and gave up. The sandbox is the workspace, not
 * read-only: told it may only read, the model at times declined a change
 * without trying, so Codex never got to ask. Codex reports this sandbox back
 * with every field, so it is set the same way.
 */
const ASKING: Policy = {
  approvalPolicy: 'untrusted',
  sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
};
/**
 * Asking on a Codex that no longer takes `untrusted`: the model asks for each
 * write. Read-only, as `on-request` would let a write in the workspace run unasked.
 */
const MODEL_ASKS: Policy = { approvalPolicy: 'on-request', sandbox: READ_ONLY };
/**
 * Moxxy's tools reach Codex as a catalog of three small tools, kept out of
 * Codex's tool search: lent one by one, their full descriptions went with
 * every request (tens of thousands of tokens with the person's MCP servers).
 */
const LENT_AS = { catalog: true } as const;
/** Codex's fast mode (`/fast`), its `priority` service tier. */
const FAST_TIER = 'priority';
/** Codex's own name for its standard tier, which `null` restores. */
const STANDARD_TIER = 'default';
/** Asked of the model when the person's config leaves reasoning summaries to it. */
const REASONING_SUMMARY = 'auto';
/** Plan mode only reads: nothing is written and nobody is asked. */
const PLANNING: Policy = { approvalPolicy: 'never', sandbox: READ_ONLY };

export function isAuto(policy: Policy): boolean {
  return policy.approvalPolicy === 'never' && policy.sandbox.type === 'dangerFullAccess';
}

/** How much each approval policy asks; a granular one is ranked only against itself. */
const APPROVAL_RANK: Record<string, number> = { never: 0, 'on-request': 1, untrusted: 2 };
/** How much each sandbox holds back; an external one is ranked only against itself. */
const SANDBOX_RANK: Record<string, number> = { dangerFullAccess: 0, workspaceWrite: 1, readOnly: 2 };

/**
 * Whether `now` holds Codex back at least as much as `was` did: it asks at
 * least as often, in a sandbox at least as tight, and still asks the person
 * where they were asked. Anything not plainly so counts as looser.
 */
function holdsBackAsMuch(now: Policy & { readonly reviewer: CodexApprovalsReviewer }, was: Policy & { readonly reviewer: CodexApprovalsReviewer }): boolean {
  const atLeast = (a: number | undefined, b: number | undefined, same: boolean) => same || (a !== undefined && b !== undefined && a > b);
  const approvals = atLeast(rankOf(APPROVAL_RANK, now.approvalPolicy), rankOf(APPROVAL_RANK, was.approvalPolicy), same(now.approvalPolicy, was.approvalPolicy));
  const sandbox = atLeast(SANDBOX_RANK[now.sandbox.type], SANDBOX_RANK[was.sandbox.type], same(now.sandbox, was.sandbox));
  // Under `never` nobody is asked, so who would answer does not count.
  const person = now.approvalPolicy === 'never' || was.approvalPolicy === 'never' || now.reviewer === 'user' || was.reviewer !== 'user';
  return approvals && sandbox && person;
}

function rankOf(ranks: Record<string, number>, policy: CodexApprovalPolicy): number | undefined {
  return typeof policy === 'string' ? ranks[policy] : undefined;
}

/** The sandbox a config's `sandbox_mode` gives a thread. */
function sandboxOf(mode: SandboxMode, workspace: CodexConfigRead['config']['sandbox_workspace_write']): CodexSandboxPolicy {
  if (mode === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (mode === 'read-only') return { type: 'readOnly', networkAccess: false };
  return {
    type: 'workspaceWrite',
    writableRoots: workspace ? workspace.writable_roots : [],
    networkAccess: workspace ? workspace.network_access : false,
    excludeTmpdirEnvVar: workspace ? workspace.exclude_tmpdir_env_var : false,
    excludeSlashTmp: workspace ? workspace.exclude_slash_tmp : false,
  };
}

type SandboxMode = NonNullable<CodexConfigRead['config']['sandbox_mode']>;

/**
 * Moxxy tools Codex already has its own of, so they are not lent over MCP:
 * its file and shell tools, web search, background jobs, skills, memory, its
 * own plan and goal. `ask_user` is lent: outside plan mode Codex has no
 * question of its own. `recall` is lent: it searches Moxxy's record of the
 * whole conversation, which outlives Codex's own thread. The person's Moxxy
 * skills come as a `load_skill` of their own, listing them (see agent-skills).
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
  | { readonly kind: 'answered'; readonly asked: AskedQuestion }
  | { readonly kind: 'stop' }
  | { readonly kind: 'ended' };

/** A question Codex asked in a message, shown while it works. */
interface AskedQuestion {
  /** The message that asked it. */
  readonly itemId: string;
  readonly items: ReadonlyArray<QuestionItem>;
  /** Closes it unanswered, with the reason as its note. */
  readonly close: AbortController;
  readonly outcome: Promise<QuestionOutcome>;
  /** Answered or closed: `outcome` has settled. */
  done?: boolean;
  /** The answer as Codex reads it, once the person gave it. */
  answer?: string;
  /** Codex's turn could not take the answer; it goes in Codex's next message instead. */
  refused?: boolean;
}

const MAX_STDERR = 2048;
const DISMISSED = { kind: 'dismissed', reason: 'cancelled' } as const;
const STOPPED: AgentApprovalDecision = { allow: false, reason: 'The person stopped the turn.' };
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
  /**
   * The conversation has not been told how Codex runs yet. Only a thread
   * started for it does that: a conversation going on keeps the auto-approve
   * the person chose, which a new process resuming the thread knows nothing of.
   */
  private fresh: boolean;
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
  /** The question Codex asked while it works, open until answered, closed, or its turn ends. */
  private asked: AskedQuestion | undefined;
  /** The thread is new while the conversation may already have run: its first message carries the conversation so far. */
  private newThread: NewSessionReason | undefined;
  private goal: CodexGoal | undefined;
  /**
   * How Codex asks while auto-approve is off: ASKING on a Codex set up to run
   * without asking, else the person's own setup, or tighter if something
   * outside Moxxy tightened it since (Moxxy never loosens that back by itself).
   */
  private asking: Policy = ASKING;
  /** Something outside Moxxy made Codex ask while auto-approve was on; the switch shows it on the next turn. */
  private turnedOffElsewhere = false;
  /** Moxxy set back a change made outside it between turns; the next turn says so. */
  private restoredElsewhere = false;
  /** Codex turns that belong to the Moxxy turn running now. */
  private readonly myTurns = new Set<string>();
  /** The Codex turn each command still running started in, by item id: what Stop ends. */
  private readonly commandTurns = new Map<string, string>();
  /** Subagents Codex started; they work in threads of their own and may outlive a turn. */
  private readonly subagents = new CodexSubagents();
  /** Calls Codex left running when its turn ended, by item id; their end is shown when it comes. */
  private readonly leftRunning = new Map<string, CodexToolCall>();
  /** What that work did after its turn, for the turn opened to show it (or the person's next turn). */
  private late: AgentStepEvent[] = [];
  /** A turn was asked of the conversation to show what finished after Codex's turn. */
  private agentTurnPending = false;
  /** The background work last reported, to report it again only when it changes. */
  private shownWork: ReadonlyArray<AgentBackgroundWork> = [];
  /** Background work the person stopped: its end is recorded, but asks no turn of the conversation. */
  private readonly stopping = new Set<string>();
  /** The Moxxy tools Codex listed as the thread opened, the same for every turn. */
  private listed: ToolDef[];
  /** Names of Codex's own skills, read as the thread opens. */
  private ownSkills: ReadonlyArray<string> = [];
  /** Codex's own MCP servers that are on: Moxxy's server of the same name is left to Codex's. */
  private ownMcpServers: ReadonlyArray<string> = [];
  /** The Moxxy skills Codex listed with the tools; their instructions are read fresh at each call. */
  private offered: Skill[] = [];
  private activeTurn: string | undefined;
  private lastError: string | undefined;
  private lastErrorInfo: unknown;
  /** The account limit Codex last reported; its updates leave out what has not changed. */
  private limit: AgentAccountLimit | undefined;
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
    this.fresh = !settings.resume;
    this.listed = toolsLentToCodex(settings.tools ?? []);
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

  /**
   * Whether this Codex was started where the turn runs (a running thread
   * cannot move) and listed the tools the conversation has now: Codex reads
   * them only as a thread opens, so other tools mean resuming it in a new Codex.
   */
  fits(settings: Pick<CodexSessionSettings, 'cwd' | 'tools' | 'skills'>): boolean {
    return (
      settings.cwd === this.settings.cwd &&
      sameToolNames(this.lent(settings.tools), this.listed) &&
      sameSkills(this.skillsFor(settings.skills), this.offered)
    );
  }

  private lent(tools: ReadonlyArray<ToolDef> | undefined): ToolDef[] {
    return withoutOwnMcpServers(toolsLentToCodex(tools ?? []), this.ownMcpServers);
  }

  private skillsFor(skills: ReadonlyArray<Skill> | undefined): Skill[] {
    return skillsForAgent(skills ?? [], this.listed.map((tool) => tool.name), this.ownSkills);
  }

  async *turn(req: AgentStepRequest): AsyncGenerator<AgentStepEvent> {
    // A turn opened to show what Codex's background work did: Codex is sent nothing.
    if (req.continuesAgentTurn) {
      if (!this.agentTurnPending) return;
      this.agentTurnPending = false;
      yield { type: 'session', sessionId: this.threadId };
      yield* this.takeLate();
      return;
    }
    const mode = agentModeFor(req.mode);
    this.inTurn = true;
    this.myTurns.clear();
    this.activeTurn = undefined;
    this.lastError = undefined;
    this.lastErrorInfo = undefined;
    const onAbort = () => {
      this.inbox.push({ kind: 'stop' });
      void this.interrupt();
    };
    req.signal.addEventListener('abort', onAbort, { once: true });
    // The same skills Codex listed (`fits`), with their instructions as they are now.
    this.offered = this.skillsFor(req.skills);
    this.mcp.setHandler(
      moxxyToolsHandler(
        this.listed,
        { runTool: (call) => new Promise((resolve) => this.inbox.push({ kind: 'moxxy-tool', call, resolve })) },
        this.offered,
        LENT_AS,
      ),
    );
    try {
      yield { type: 'session', sessionId: this.threadId };
      // What finished while the person was writing shows first, in their turn.
      this.agentTurnPending = false;
      yield* this.takeLate();
      let autoApprove = req.autoApprove;
      // A new conversation's thread shows it how the person's Codex really runs
      // (one state), unless the conversation recorded a switch: that one wins.
      // In goal mode Codex runs with full access for the goal, not because the
      // person chose auto-approve, so that waits for the next turn.
      if (this.fresh && mode !== 'goal') {
        this.fresh = false;
        if (!req.autoApproveRecorded) {
          yield { type: 'auto_approve', enabled: isAuto(this.original) };
          if (!autoApprove) autoApprove = isAuto(this.original);
        }
      }
      if (this.turnedOffElsewhere && mode !== 'goal' && mode !== 'plan') {
        yield { type: 'auto_approve', enabled: false, elsewhere: true };
        autoApprove = false;
        this.turnedOffElsewhere = false;
      }
      if (this.restoredElsewhere) {
        yield { type: 'auto_approve_restored' };
        this.restoredElsewhere = false;
      }
      await this.apply(this.wanted(req, mode, autoApprove));
      // A new session of the agent's own gets the whole conversation; one it goes on in, the turns it was away for.
      const note = this.newThread ? earlierConversationNote(this.newThread, req.earlierConversation?.()) : req.missedTurns?.();
      this.newThread = undefined;
      if (note) this.pendingNotes.unshift(note);
      await this.begin(mode, req);
      yield* this.read(req, mode, new TurnTranslator(this.settings.cwd, (path) => readImageFile(path, this.settings.cwd)));
    } catch (err) {
      if (!req.signal.aborted) yield { type: 'error', message: this.alive ? messageOf(err) : this.endedMessage(), retryable: false };
    } finally {
      req.signal.removeEventListener('abort', onAbort);
      this.mcp.setHandler(idleToolsHandler(this.listed, this.offered, LENT_AS));
      this.inTurn = false;
      // The turn is over: nothing is left to take an answer.
      this.asked?.close.abort();
      this.asked = undefined;
      this.dismissQueued();
      // What outlives the turn now runs in the background.
      this.reportWork();
    }
  }

  /** Stop one work Codex runs in the background (`AgentBackgroundWork.id`); `false` when Codex runs no such work. */
  async stopWork(workId: string): Promise<boolean> {
    if (this.leftRunning.has(workId)) {
      this.stopping.add(workId);
      const stopped = await this.terminateCommand(workId);
      if (!stopped) this.stopping.delete(workId);
      return stopped;
    }
    const turn = this.subagents.turnOf(workId);
    if (turn === undefined) return false;
    this.stopping.add(workId);
    await this.client.request('turn/interrupt', { threadId: workId, turnId: turn }).catch(() => undefined);
    return true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.alive = false;
    // Codex's background work ends with its app-server.
    this.leftRunning.clear();
    this.reportWork([]);
    this.client.close();
    this.connection.close();
    this.dismissQueued();
    await this.mcp.close();
  }

  /** Codex's own skills that are switched on: a Moxxy skill of the same name is left to Codex's. */
  private async ownSkillNames(cwd: string): Promise<string[]> {
    const listed = await this.client.request<CodexSkillsList>('skills/list', { cwds: [cwd] }).catch(() => undefined);
    return (listed?.data ?? []).flatMap((entry) => entry.skills.filter((skill) => skill.enabled).map((skill) => skill.name));
  }

  private async open(): Promise<void> {
    await this.client.request('initialize', {
      clientInfo: { name: 'moxxy', title: 'Moxxy', version: CLIENT_VERSION },
      capabilities: { experimentalApi: true },
    });
    this.client.notify('initialized');
    const { cwd, resume, model } = this.settings;
    const read = await this.client.request<CodexConfigRead>('config/read', { cwd }).catch(() => undefined);
    // Codex hides MCP tools behind its tool search, where the model does not
    // look for Moxxy's, so the skill list and the three catalog tools sit in its
    // first list; the tools behind the catalog stay out of every request.
    const config = {
      mcp_servers: {
        [MOXXY_MCP_SERVER]: { url: this.mcp.url, http_headers: { Authorization: this.mcp.authorization }, omit_tools_from: ['deferred'] },
      },
      ...checklistFor(read),
    };
    this.ownSummary = read ? (read.config.model_reasoning_summary ?? null) : undefined;
    this.ownMcpServers = Object.entries(read?.config.mcp_servers ?? {})
      .filter(([name, server]) => name !== MOXXY_MCP_SERVER && server.enabled !== false)
      .map(([name]) => name);
    this.listed = this.lent(this.settings.tools);
    // Codex lists Moxxy's tools when the thread opens and keeps that list for the thread.
    this.ownSkills = await this.ownSkillNames(cwd);
    this.offered = this.skillsFor(this.settings.skills);
    this.mcp.setHandler(idleToolsHandler(this.listed, this.offered, LENT_AS));
    let thread: CodexThreadResponse | undefined;
    let resumed = false;
    if (resume) {
      const loaded = await resumeAgentSession({
        label: 'Codex',
        load: () => this.client.request<CodexThreadResponse>('thread/resume', { threadId: resume, cwd, config, ...(model ? { model } : {}) }),
        gone: threadGone,
      });
      if (loaded.kind === 'loaded') {
        thread = loaded.session;
        resumed = true;
        const found = await this.client.request<{ goal: CodexGoal | null }>('thread/goal/get', { threadId: thread.thread.id }).catch(() => undefined);
        this.goal = found?.goal ?? undefined;
      } else {
        this.newThread = 'lost';
      }
    } else {
      this.newThread = 'new';
    }
    thread ??= await this.client.request<CodexThreadResponse>('thread/start', { cwd, config, ...(model ? { model } : {}) });
    this.threadId = thread.thread.id;
    // A new thread runs as the person set Codex up. A resumed one keeps the approval
    // policy and reviewer Moxxy last set on it, so their own setup comes from their config.
    const own = resumed && read ? read.config : undefined;
    const running: Policy = { approvalPolicy: thread.approvalPolicy, sandbox: thread.sandbox };
    this.original = {
      approvalPolicy: (own && own.approval_policy) ?? running.approvalPolicy,
      sandbox: own && own.sandbox_mode ? sandboxOf(own.sandbox_mode, own.sandbox_workspace_write) : running.sandbox,
    };
    this.originalTier = thread.serviceTier && thread.serviceTier !== STANDARD_TIER ? thread.serviceTier : null;
    this.originalReviewer = (own && own.approvals_reviewer) ?? thread.approvalsReviewer ?? 'user';
    this.asking = isAuto(this.original) ? ASKING : this.original;
    this.current = {
      ...running,
      model: thread.model,
      ...(thread.reasoningEffort ? { effort: thread.reasoningEffort } : {}),
      serviceTier: this.originalTier,
      collaboration: 'default',
      reviewer: thread.approvalsReviewer ?? 'user',
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
      : this.asking;
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
    try {
      await this.client.request('thread/settings/update', { threadId: this.threadId, ...update });
    } catch (err) {
      if (update.approvalPolicy !== ASKING.approvalPolicy || this.asking !== ASKING) throw err;
      this.asking = MODEL_ASKS;
      return this.apply({ ...wanted, ...MODEL_ASKS });
    }
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
      if (item.kind === 'answered') {
        await this.steerAnswer(translator);
        continue;
      }
      const params = (item.params ?? {}) as Record<string, unknown>;
      this.noteGoal(item.method, params);
      const change = this.noteSettings(item.method, params);
      if (change === 'turned-off') {
        // Goal and plan mode run Codex their own way; the switch shows the change on the next turn outside them.
        if (mode === 'goal' || mode === 'plan') this.turnedOffElsewhere = true;
        else yield { type: 'auto_approve', enabled: false, elsewhere: true };
        continue;
      }
      if (change === 'loosened') {
        await this.restore();
        yield { type: 'auto_approve_restored' };
        continue;
      }
      if (change) continue;
      if (item.method === 'account/rateLimits/updated') {
        const limit = accountLimitFrom((params.rateLimits ?? {}) as CodexRateLimitSnapshot);
        if (limit) {
          this.limit = limit;
          yield { type: 'account_limit', limit };
        }
        continue;
      }
      // A subagent works in a thread of its own; its turns are not the conversation's,
      // though the subagents keep them for Stop.
      if (isTurnEvent(item.method) && params.threadId !== this.threadId) {
        yield* this.subagents.fromThread(item.method, params);
        continue;
      }
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
          if (failedOnUsageLimit(turn.error?.codexErrorInfo ?? this.lastErrorInfo)) {
            this.limit = this.limit ? { ...this.limit, state: 'reached' } : { state: 'reached' };
            yield { type: 'account_limit', limit: this.limit };
          }
          yield { type: 'error', message: `Codex: ${turn.error?.message ?? this.lastError ?? 'the turn failed'}`, retryable: false };
          return;
        }
        if (turn.status === 'interrupted' || req.signal.aborted) return;
        if (this.asked) {
          const asked = this.asked;
          this.asked = undefined;
          // Codex ended on the question (plan mode): it waits for the answer as its next message.
          // It said more since: it went on without one.
          const waits = translator.lastSaid(asked.itemId);
          if (!waits) asked.close.abort(QUESTION_CLOSED_AGENT_WENT_ON);
          const reply = replyTo(asked.items, await untilStopped(asked.outcome, req.signal, DISMISSED), waits);
          if (reply !== undefined) {
            await this.startTurn([{ type: 'text', text: reply, text_elements: [] }]);
            continue;
          }
          if (waits) return;
        }
        if (mode === 'goal') {
          // An open goal: Codex starts its next turn by itself.
          if (this.goal?.status === 'active') continue;
          yield { type: 'goal', status: this.goal?.status === 'complete' ? 'complete' : 'active' };
        }
        const left = translator.leftRunning();
        for (const [id, call] of left.calls) this.leftRunning.set(id, call);
        yield* left.events;
        return;
      }
      if (item.method === 'error') {
        const error = params.error as { message?: unknown; codexErrorInfo?: unknown } | undefined;
        if (params.willRetry !== true && error && typeof error.message === 'string') {
          this.lastError = error.message;
          this.lastErrorInfo = error.codexErrorInfo;
        }
        continue;
      }
      if (typeof params.threadId === 'string' && params.threadId !== this.threadId) {
        yield* this.subagents.fromThread(item.method, params);
        continue;
      }
      const ended = this.endOfLeftRunning(item.method, params);
      if (ended) {
        yield* ended.events;
        continue;
      }
      if (!this.belongsHere(params)) continue;
      if (isSubagentActivity(item.method, params)) {
        yield* this.subagents.activity(params.item);
        continue;
      }
      yield* contextWindowOf(item.method, params, req.model || this.current.model);
      yield* translator.translate(item.method, params);
      const question = translator.takeQuestions();
      if (question) this.askWhileWorking(question, req);
      await this.steerAnswer(translator);
    }
  }

  /**
   * Show Codex's question at once and let Codex work on: Codex asks in a
   * message and does not wait, so the answer goes into its running turn, or
   * waits for its turn to end when it ended on the question.
   */
  private askWhileWorking(question: CodexAskedQuestions, req: AgentStepRequest): void {
    // A newer question takes the place of one Codex went on past.
    this.asked?.close.abort(QUESTION_CLOSED_AGENT_WENT_ON);
    const items = fromAsyncQuestions(question.questions);
    const close = new AbortController();
    const asked: AskedQuestion = { itemId: question.itemId, items, close, outcome: req.host.ask(items, { signal: close.signal }) };
    this.asked = asked;
    void asked.outcome.then(
      (outcome) => {
        asked.done = true;
        if (outcome.kind === 'answered') asked.answer = answersMessage(items, outcome.answers);
        this.inbox.push({ kind: 'answered', asked });
      },
      () => {
        asked.done = true;
      },
    );
  }

  /**
   * The person's answer goes into Codex's running turn once Codex has gone on
   * from the question; until then Codex may still end its turn on it, and the
   * answer is its next message. A question closed unanswered is let go.
   */
  private async steerAnswer(translator: TurnTranslator): Promise<void> {
    const asked = this.asked;
    if (!asked?.done || asked.refused || this.activeTurn === undefined || !translator.movedOnFrom(asked.itemId)) return;
    if (asked.answer === undefined) {
      this.asked = undefined;
      return;
    }
    const turnId = this.activeTurn;
    const input = [{ type: 'text', text: asked.answer, text_elements: [] }];
    const steered = await this.client.request('turn/steer', { threadId: this.threadId, expectedTurnId: turnId, input }).then(
      () => true,
      () => false,
    );
    if (steered) {
      if (this.asked === asked) this.asked = undefined;
    } else asked.refused = true;
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
          // An empty answer lets Codex keep waiting. The new message needs its turn to release the session first.
          if (outcome.kind === 'dismissed' && outcome.note === QUESTION_CLOSED_NEW_MESSAGE) await this.interrupt();
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
    const stopped = new Set(this.myTurns);
    await this.client.request('turn/interrupt', { threadId: this.threadId, turnId }).catch(() => undefined);
    await this.endCommandsOf(stopped);
  }

  /**
   * Codex leaves an interrupted turn's commands running, so Stop ends the ones
   * these turns started. What an earlier turn left running (a dev server) is
   * not this turn's to stop.
   */
  private async endCommandsOf(turns: ReadonlySet<string>): Promise<void> {
    await this.terminateWhere((itemId) => {
      const turn = this.commandTurns.get(itemId);
      return turn !== undefined && turns.has(turn);
    });
  }

  /** End the command a call left running, found by the item that started it; `false` when no such command runs. */
  private async terminateCommand(itemId: string): Promise<boolean> {
    return (await this.terminateWhere((id) => id === itemId)) > 0;
  }

  /** End every background command of the thread whose item `pick` chooses; how many it ended. */
  private async terminateWhere(pick: (itemId: string) => boolean): Promise<number> {
    let ended = 0;
    let cursor: string | null = null;
    do {
      const page: CodexBackgroundTerminals | undefined = await this.client
        .request<CodexBackgroundTerminals>('thread/backgroundTerminals/list', { threadId: this.threadId, ...(cursor ? { cursor } : {}) })
        .catch(() => undefined);
      if (!page) return ended;
      for (const terminal of page.data) {
        if (!pick(terminal.itemId)) continue;
        await this.client.request('thread/backgroundTerminals/terminate', { threadId: this.threadId, processId: terminal.processId }).catch(() => undefined);
        ended += 1;
      }
      cursor = page.nextCursor;
    } while (cursor);
    return ended;
  }

  /** Which Codex turn started each command, noted as Codex reports it, ahead of the turn reading it. */
  private noteCommand(method: string, params: unknown): void {
    if (method !== 'item/started' && method !== 'item/completed') return;
    const note = params as { threadId?: unknown; turnId?: unknown; item?: { type?: unknown; id?: unknown } } | undefined;
    if (note?.threadId !== this.threadId || note.item?.type !== 'commandExecution' || typeof note.item.id !== 'string') return;
    if (method === 'item/completed') this.commandTurns.delete(note.item.id);
    else if (typeof note.turnId === 'string') this.commandTurns.set(note.item.id, note.turnId);
  }

  private belongsHere(params: Record<string, unknown>): boolean {
    if (typeof params.threadId === 'string' && params.threadId !== this.threadId) return false;
    return typeof params.turnId !== 'string' || this.myTurns.has(params.turnId);
  }

  private onNotification(method: string, params: unknown): void {
    this.noteCommand(method, params);
    // In a turn the goal's state is read in order with everything else Codex sent.
    if (this.inTurn) {
      this.inbox.push({ kind: 'note', method, params });
      return;
    }
    this.noteGoal(method, params);
    this.noteLate(method, params);
    const change = this.noteSettings(method, params);
    if (change === 'turned-off') this.turnedOffElsewhere = true;
    if (change === 'loosened') {
      this.restoredElsewhere = true;
      void this.restore().catch(() => undefined);
    }
  }

  /**
   * A change of the thread's approvals made without Moxxy (another client, a
   * hook): only the person loosens them. A change that holds Codex back at
   * least as much is `kept` (`turned-off` when auto-approve was on), a looser
   * one is `loosened` and set back. Codex reports Moxxy's own changes too; those
   * match what Moxxy set and are passed over.
   */
  private noteSettings(method: string, params: unknown): 'turned-off' | 'kept' | 'loosened' | undefined {
    if (method !== 'thread/settings/updated') return undefined;
    const update = params as { threadId?: unknown; threadSettings?: CodexThreadSettingsReport } | undefined;
    if (!update || update.threadId !== this.threadId || !update.threadSettings) return undefined;
    const settings = update.threadSettings;
    const now = { approvalPolicy: settings.approvalPolicy, sandbox: settings.sandboxPolicy, reviewer: settings.approvalsReviewer };
    const was = this.current;
    if (same(now.approvalPolicy, was.approvalPolicy) && same(now.sandbox, was.sandbox) && now.reviewer === was.reviewer) return undefined;
    if (!holdsBackAsMuch(now, was)) return 'loosened';
    this.current = { ...was, ...now };
    if (isAuto(now)) return 'kept';
    this.asking = { approvalPolicy: now.approvalPolicy, sandbox: now.sandbox };
    return isAuto(was) ? 'turned-off' : 'kept';
  }

  /** Put the thread's approvals back as Moxxy last set them. */
  private async restore(): Promise<void> {
    const { approvalPolicy, sandbox, reviewer } = this.current;
    await this.client.request('thread/settings/update', { threadId: this.threadId, approvalPolicy, sandboxPolicy: sandbox, approvalsReviewer: reviewer });
  }

  /**
   * Between turns: what Codex's background work does. Codex starts no turn
   * when it ends (0.155.1), so the conversation is asked for one to show it:
   * a subagent's tools and answer, a command's output.
   */
  private noteLate(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    // A subagent's steps are recorded as they come.
    if (typeof p.threadId === 'string' && p.threadId !== this.threadId) {
      const events = this.subagents.fromThread(method, p);
      this.report(events);
      // A subagent stopped in its own thread asks no turn: the person stopped it.
      if (events.some((event) => event.type === 'subagent_completed')) {
        this.stopping.delete(p.threadId);
        this.reportWork();
      }
      return;
    }
    const ended = this.endOfLeftRunning(method, p);
    if (ended) {
      // What the person stopped is ended for them already; it asks no turn.
      if (ended.stopped) return;
      this.late.push(...ended.events);
      this.askForTurn('A command Codex left running finished', ended.id);
      return;
    }
    if (!isSubagentActivity(method, p)) return;
    const done = this.subagents.activity(p.item).filter((event) => event.type === 'subagent_completed');
    if (done.length === 0) return;
    const item = p.item as { agentPath?: unknown; agentThreadId?: unknown };
    const workId = typeof item.agentThreadId === 'string' ? item.agentThreadId : undefined;
    if (workId !== undefined && this.stopping.delete(workId)) {
      this.report(done);
      this.reportWork();
      return;
    }
    this.late.push(...done);
    this.reportWork();
    this.askForTurn(`${labelOf(item.agentPath)} finished in the background`, workId);
  }

  /**
   * The end of a call Codex left running, as a call of its own beside the one
   * shown running; `undefined` for anything else. Its end is recorded for the
   * agents panel at once, with what the command printed last.
   */
  private endOfLeftRunning(
    method: string,
    params: Record<string, unknown>,
  ): { readonly id: string; readonly stopped: boolean; readonly events: AgentStepEvent[] } | undefined {
    const item = params.item as { id?: unknown; status?: unknown; exitCode?: unknown; aggregatedOutput?: unknown } | undefined;
    if (method !== 'item/completed' || typeof item?.id !== 'string') return undefined;
    const call = this.leftRunning.get(item.id);
    if (!call) return undefined;
    this.leftRunning.delete(item.id);
    const stopped = this.stopping.delete(item.id);
    const output = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : '';
    const status = stopped ? 'stopped' : commandEnd(item);
    this.report([{ type: 'background_work_ended', id: item.id, kind: 'command', label: workLabel(call), status, ...(output ? { output } : {}) }]);
    this.reportWork();
    const translator = new TurnTranslator(this.settings.cwd, (path) => readImageFile(path, this.settings.cwd));
    return { id: item.id, stopped, events: translator.translate('item/completed', { ...params, item: { ...item, id: `${item.id}-ended` } }) };
  }

  private askForTurn(name: string, workId?: string): void {
    if (this.closed || this.agentTurnPending) return;
    this.agentTurnPending = true;
    this.settings.onAgentTurn?.(name, workId);
  }

  /** What Codex runs in the background now: the commands its turns left running and the subagents still working. Reported when it changes. */
  private reportWork(work: ReadonlyArray<AgentBackgroundWork> = this.workNow()): void {
    if (sameWork(work, this.shownWork)) return;
    this.shownWork = work;
    this.report([{ type: 'background_work', work }]);
  }

  private workNow(): AgentBackgroundWork[] {
    const commands = [...this.leftRunning].map(([id, call]): AgentBackgroundWork => ({ id, kind: 'command', label: workLabel(call) }));
    return [...commands, ...this.subagents.running()];
  }

  private report(events: ReadonlyArray<AgentStepEvent>): void {
    if (events.length > 0) this.settings.onActivity?.(events);
  }

  private *takeLate(): Generator<AgentStepEvent> {
    const late = this.late;
    this.late = [];
    yield* late;
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
      else if (item.kind === 'note') {
        this.noteGoal(item.method, item.params);
        this.noteLate(item.method, item.params);
      }
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

/**
 * Codex's checklist (`update_plan`) is off by default since 0.152; Moxxy turns it on for its
 * own threads so the step list shows, unless the person chose either way in their config.
 * A dotted key changes only that setting, never the rest of the person's `[tools]`.
 */
function checklistFor(read: CodexConfigRead | undefined): Record<string, boolean> {
  const tools = read?.config.tools;
  if (tools && typeof tools.update_plan?.enabled === 'boolean') return {};
  return { 'tools.update_plan.enabled': true };
}

function isTurnEvent(method: string): boolean {
  return method === 'turn/started' || method === 'turn/completed';
}

function isSubagentActivity(method: string, params: Record<string, unknown>): boolean {
  if (method !== 'item/started' && method !== 'item/completed') return false;
  const item = params.item as { type?: unknown } | undefined;
  return item !== undefined && item.type === 'subAgentActivity';
}

/** The window Codex runs the turn's model with: its config's `model_context_window` or Codex's own default. */
function contextWindowOf(method: string, params: unknown, model: string): AgentStepEvent[] {
  if (method !== 'thread/tokenUsage/updated' || !model) return [];
  const usage = (params as { tokenUsage?: { modelContextWindow?: unknown } } | undefined)?.tokenUsage;
  const tokens = usage?.modelContextWindow;
  return isContextWindowSize(tokens) ? [{ type: 'context_window', model, tokens }] : [];
}

/** A background command as the person reads it: the command it runs. */
function workLabel(call: CodexToolCall): string {
  const input = call.input as { command?: unknown } | undefined;
  return typeof input?.command === 'string' && input.command ? input.command : call.name;
}

function commandEnd(item: { readonly status?: unknown; readonly exitCode?: unknown }): AgentWorkEnd {
  if (item.status === 'completed') return item.exitCode === 0 || item.exitCode === null || item.exitCode === undefined ? 'completed' : 'failed';
  return item.status === 'failed' ? 'failed' : 'stopped';
}

function sameWork(a: ReadonlyArray<AgentBackgroundWork>, b: ReadonlyArray<AgentBackgroundWork>): boolean {
  return a.length === b.length && a.every((work, i) => work.id === b[i]?.id && work.kind === b[i]?.kind && work.label === b[i]?.label);
}

/**
 * Codex's next message after its turn ended with a question open: the answer,
 * or, when Codex waits on the question and nobody can answer, that it picks
 * itself. None when it was closed unanswered.
 */
function replyTo(items: ReadonlyArray<QuestionItem>, outcome: QuestionOutcome, waits: boolean): string | undefined {
  if (outcome.kind === 'answered') return answersMessage(items, outcome.answers);
  return outcome.kind === 'unanswerable' && waits ? NOBODY_TO_ASK : undefined;
}
