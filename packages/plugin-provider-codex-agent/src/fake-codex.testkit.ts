/**
 * A stand-in for `codex app-server`, the external boundary of the Codex agent
 * connection. It speaks the same newline JSON-RPC over the same two streams,
 * shaped after recorded 0.155.1 sessions: `thread/start` answers with the
 * thread as the person's config runs it, `turn/start` answers and then streams
 * `turn/started`, items and `turn/completed`, approvals are requests to Moxxy,
 * a goal starts its own turns until it is met, and Moxxy's tools are called
 * over Moxxy's MCP server with the real MCP client. What Codex does in a turn
 * is a scene the test writes.
 */
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Inbox } from '@moxxy/agent-connection-kit';
import type { CodexConnection } from './codex-session.js';
import type { CodexApprovalPolicy, CodexGoal, CodexGoalStatus, CodexSandboxPolicy, CodexUserInput } from './protocol.js';

export interface FakeCodexTurn {
  readonly id: string;
  readonly threadId: string;
  readonly input: ReadonlyArray<CodexUserInput>;
  /** The person's words in this turn ('' for a turn a goal started). */
  readonly text: string;
  /** Set on a turn the goal started (the first one and each continuation). */
  readonly objective?: string;
  readonly thread: FakeThread;
  readonly server: FakeCodexServer;
  /** Aborted when Moxxy interrupts the turn. */
  readonly signal: AbortSignal;
  started(item: Record<string, unknown>): void;
  completed(item: Record<string, unknown>): void;
  /** An agent message, streamed as deltas and then completed. */
  say(text: string, extra?: Record<string, unknown>): void;
  /** A shell command; with `approval` Codex asks Moxxy first and returns the decision. */
  run(command: string, output: string, opts?: { readonly approval?: boolean; readonly reason?: string }): Promise<unknown>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  callMoxxyTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown; isError?: boolean }>;
  usage(input: number, output: number, cached?: number): void;
  goal(status: CodexGoalStatus): void;
  /** The next text Moxxy steers into this running turn (`turn/steer`). */
  steered(): Promise<string>;
}

export type CodexScene = (turn: FakeCodexTurn) => Promise<void | { readonly status: 'failed'; readonly error: string }>;

export interface FakeThread {
  readonly id: string;
  readonly cwd: string;
  readonly ephemeral: boolean;
  readonly startParams: Record<string, unknown>;
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxPolicy;
  model: string;
  effort: string | null;
  serviceTier: string | null;
  collaborationMode: string;
  goal: CodexGoal | undefined;
  mcp: { readonly url: string; readonly headers: Record<string, string> } | undefined;
}

export interface FakeCodexDefaults {
  readonly approvalPolicy?: CodexApprovalPolicy;
  readonly sandbox?: CodexSandboxPolicy;
  readonly model?: string;
  readonly effort?: string | null;
  readonly serviceTier?: string | null;
  /** Refuse `turn/steer`, as Codex does for a turn that cannot take more input. */
  readonly refuseSteer?: boolean;
}

/** The person's Codex install: every app-server Moxxy starts, and the threads it saved. */
export class FakeCodex {
  readonly servers: FakeCodexServer[] = [];
  /** Threads saved to disk, which a later process can `thread/resume`. */
  readonly saved = new Map<string, FakeThread>();
  threadCount = 0;
  turnCount = 0;

  constructor(
    readonly scene: CodexScene,
    readonly defaults: FakeCodexDefaults = {},
  ) {}

  /** What Moxxy calls to start `codex app-server`. */
  readonly start = async (opts: { readonly cwd: string }): Promise<CodexConnection> => {
    const server = new FakeCodexServer(this, opts.cwd);
    this.servers.push(server);
    return server.connection;
  };

  get last(): FakeCodexServer {
    const server = this.servers.at(-1);
    if (!server) throw new Error('Codex was never started');
    return server;
  }
}

export class FakeCodexServer {
  readonly requests: Array<{ readonly method: string; readonly params: Record<string, unknown> }> = [];
  readonly notifications: string[] = [];
  readonly threads = new Map<string, FakeThread>();
  readonly connection: CodexConnection;
  closed = false;
  private readonly toMoxxy = new PassThrough();
  private readonly fromMoxxy = new PassThrough();
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private nextRequestId = 0;
  private active: { id: string; threadId: string; stop: AbortController; steers: Inbox<string> } | undefined;
  private readonly mcpClients: Client[] = [];

  constructor(
    private readonly codex: FakeCodex,
    readonly cwd: string,
  ) {
    createInterface({ input: this.fromMoxxy }).on('line', (line) => void this.receive(line));
    this.connection = {
      readable: this.toMoxxy,
      writable: this.fromMoxxy,
      close: () => {
        if (this.closed) return;
        this.closed = true;
        this.active?.stop.abort();
        this.toMoxxy.end();
        for (const client of this.mcpClients) void client.close();
      },
    };
  }

  /** Every request Moxxy made with this method, in order. */
  sent(method: string): Array<Record<string, unknown>> {
    return this.requests.filter((r) => r.method === method).map((r) => r.params);
  }

  get thread(): FakeThread {
    const thread = [...this.threads.values()].at(-1);
    if (!thread) throw new Error('No thread was started');
    return thread;
  }

  /** Codex crashed: its stdout closes. */
  crash(): void {
    this.toMoxxy.end();
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.notifications.push(method);
    this.write({ method, params });
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.toMoxxy.writableEnded) this.toMoxxy.write(`${JSON.stringify(message)}\n`);
  }

  private async receive(line: string): Promise<void> {
    const message = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
    if (message.method === undefined) {
      const waiting = message.id === undefined ? undefined : this.pending.get(message.id);
      if (!waiting || message.id === undefined) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
      return;
    }
    const params = message.params ?? {};
    this.requests.push({ method: message.method, params });
    if (message.id === undefined) return;
    try {
      const { result, after } = await this.handle(message.method, params);
      this.write({ id: message.id, result });
      after?.();
    } catch (err) {
      this.write({ id: message.id, error: { code: -32600, message: err instanceof Error ? err.message : String(err) } });
    }
  }

  private async handle(method: string, params: Record<string, unknown>): Promise<{ result: unknown; after?: () => void }> {
    switch (method) {
      case 'initialize':
        return { result: { userAgent: 'moxxy/0.155.1', codexHome: '/home/me/.codex', platformFamily: 'unix', platformOs: 'macos' } };
      case 'thread/start':
        return this.startThread(params);
      case 'thread/resume': {
        const saved = this.codex.saved.get(String(params.threadId));
        if (!saved) throw new Error(`no rollout found for thread id ${String(params.threadId)}`);
        const thread: FakeThread = { ...saved, mcp: mcpOf(params.config) };
        this.threads.set(thread.id, thread);
        return { result: threadResponse(thread) };
      }
      case 'thread/settings/update': {
        const thread = this.threadOf(params);
        if (params.approvalPolicy !== undefined) thread.approvalPolicy = params.approvalPolicy as CodexApprovalPolicy;
        if (params.sandboxPolicy !== undefined) thread.sandbox = params.sandboxPolicy as CodexSandboxPolicy;
        if (typeof params.model === 'string') thread.model = params.model;
        if (typeof params.effort === 'string') thread.effort = params.effort;
        // `null` clears the tier back to Codex's standard one, which it calls `default`.
        if (params.serviceTier !== undefined) thread.serviceTier = (params.serviceTier as string | null) ?? 'default';
        const collaboration = params.collaborationMode as { mode?: string } | undefined;
        if (collaboration?.mode) thread.collaborationMode = collaboration.mode;
        return { result: {}, after: () => this.notify('thread/settings/updated', { threadId: thread.id }) };
      }
      case 'turn/start': {
        const thread = this.threadOf(params);
        if (this.active) throw new Error('a turn is already running');
        const id = `turn-${++this.codex.turnCount}`;
        const input = params.input as CodexUserInput[];
        return { result: { turn: { id, items: [], status: 'inProgress', error: null } }, after: () => void this.runTurn(thread, id, input) };
      }
      case 'turn/steer': {
        const active = this.active;
        if (this.codex.defaults.refuseSteer || !active || active.id !== params.expectedTurnId) throw new Error('no steerable turn');
        const text = (params.input as CodexUserInput[]).flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
        active.steers.push(text);
        return { result: { turnId: active.id } };
      }
      case 'turn/interrupt': {
        if (!this.active || this.active.id !== params.turnId) throw new Error('no active turn to interrupt');
        this.active.stop.abort();
        return { result: {} };
      }
      case 'thread/goal/set': {
        const thread = this.threadOf(params);
        const objective = typeof params.objective === 'string' ? params.objective : undefined;
        // 0.155.1: a new objective on a met goal leaves it met and starts nothing; clear it first.
        if (thread.goal?.status === 'complete' && objective !== undefined) return { result: { goal: thread.goal } };
        thread.goal = { objective: objective ?? thread.goal?.objective ?? '', status: (params.status as CodexGoalStatus | undefined) ?? 'active' };
        const goal = thread.goal;
        return {
          result: { goal },
          after: () => {
            this.notify('thread/goal/updated', { threadId: thread.id, turnId: null, goal });
            if (goal.status === 'active' && !this.active) void this.runTurn(thread, `turn-${++this.codex.turnCount}`, [], goal.objective);
          },
        };
      }
      case 'thread/goal/clear': {
        const thread = this.threadOf(params);
        const cleared = thread.goal !== undefined;
        thread.goal = undefined;
        return { result: { cleared }, after: () => this.notify('thread/goal/cleared', { threadId: thread.id }) };
      }
      case 'thread/goal/get':
        return { result: { goal: this.threadOf(params).goal ?? null } };
      default:
        throw new Error(`Method not found: ${method}`);
    }
  }

  private startThread(params: Record<string, unknown>): { result: unknown; after: () => void } {
    const { defaults } = this.codex;
    const id = `thread-${++this.codex.threadCount}`;
    const thread: FakeThread = {
      id,
      cwd: String(params.cwd ?? this.cwd),
      ephemeral: params.ephemeral === true,
      startParams: params,
      approvalPolicy: (params.approvalPolicy as CodexApprovalPolicy | undefined) ?? defaults.approvalPolicy ?? 'never',
      sandbox: sandboxFromMode(params.sandbox) ?? defaults.sandbox ?? { type: 'dangerFullAccess' },
      model: typeof params.model === 'string' ? params.model : (defaults.model ?? 'gpt-6-luna'),
      effort: defaults.effort === undefined ? 'xhigh' : defaults.effort,
      serviceTier: defaults.serviceTier ?? 'default',
      collaborationMode: 'default',
      goal: undefined,
      mcp: mcpOf(params.config),
    };
    this.threads.set(id, thread);
    if (!thread.ephemeral) this.codex.saved.set(id, thread);
    return { result: threadResponse(thread), after: () => this.notify('thread/started', { thread: { id } }) };
  }

  private threadOf(params: Record<string, unknown>): FakeThread {
    const thread = this.threads.get(String(params.threadId));
    if (!thread) throw new Error(`thread not found: ${String(params.threadId)}`);
    return thread;
  }

  private async runTurn(thread: FakeThread, id: string, input: ReadonlyArray<CodexUserInput>, objective?: string): Promise<void> {
    const stop = new AbortController();
    const steers = new Inbox<string>();
    this.active = { id, threadId: thread.id, stop, steers };
    this.notify('turn/started', { threadId: thread.id, turn: { id, items: [], status: 'inProgress', error: null } });
    const stopped = new Promise<'stopped'>((resolve) => stop.signal.addEventListener('abort', () => resolve('stopped'), { once: true }));
    let outcome: Awaited<ReturnType<CodexScene>> | 'stopped';
    try {
      outcome = await Promise.race([this.codex.scene(this.turn(thread, id, input, stop.signal, steers, objective)), stopped]);
    } catch (err) {
      outcome = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
    this.active = undefined;
    if (this.closed) return;
    const status = stop.signal.aborted ? 'interrupted' : outcome && outcome !== 'stopped' ? outcome.status : 'completed';
    const error = outcome && outcome !== 'stopped' ? { message: outcome.error } : null;
    this.notify('turn/completed', { threadId: thread.id, turn: { id, items: [], status, error } });
    // A goal still open keeps going on its own, as Codex's goal runtime does.
    if (status === 'completed' && thread.goal?.status === 'active') {
      void this.runTurn(thread, `turn-${++this.codex.turnCount}`, [], thread.goal.objective);
    }
  }

  private turn(
    thread: FakeThread,
    id: string,
    input: ReadonlyArray<CodexUserInput>,
    signal: AbortSignal,
    steers: Inbox<string>,
    objective?: string,
  ): FakeCodexTurn {
    const base = { threadId: thread.id, turnId: id };
    const text = input.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
    return {
      id,
      threadId: thread.id,
      input,
      text,
      ...(objective !== undefined ? { objective } : {}),
      thread,
      server: this,
      signal,
      steered: () => steers.next(),
      started: (item) => this.notify('item/started', { ...base, item }),
      completed: (item) => this.notify('item/completed', { ...base, item }),
      say: (said, extra = {}) => {
        const itemId = `msg-${Math.random().toString(36).slice(2)}`;
        const item = { type: 'agentMessage', id: itemId, text: said, phase: 'final_answer', delivery: null, questions: null, ...extra };
        this.notify('item/started', { ...base, item: { ...item, text: '' } });
        for (const delta of said.match(/.{1,8}/gs) ?? []) this.notify('item/agentMessage/delta', { ...base, itemId, delta });
        this.notify('item/completed', { ...base, item });
      },
      run: async (command, output, opts = {}) => {
        const itemId = `exec-${Math.random().toString(36).slice(2)}`;
        const wrapped = `/bin/zsh -lc '${command.replace(/'/g, `'\\''`)}'`;
        const item = { type: 'commandExecution', id: itemId, command: wrapped, cwd: thread.cwd, status: 'inProgress', aggregatedOutput: null, exitCode: null };
        this.notify('item/started', { ...base, item });
        let decision: unknown;
        if (opts.approval) {
          decision = await this.request('item/commandExecution/requestApproval', {
            ...base,
            itemId,
            reason: opts.reason ?? null,
            command: wrapped,
            cwd: thread.cwd,
            availableDecisions: ['accept', 'cancel'],
          });
          const answer = (decision as { decision?: unknown }).decision;
          if (answer !== 'accept' && answer !== 'acceptForSession') {
            this.notify('item/completed', { ...base, item: { ...item, status: 'declined' } });
            return decision;
          }
        }
        this.notify('item/completed', { ...base, item: { ...item, status: 'completed', aggregatedOutput: output, exitCode: 0 } });
        return decision;
      },
      request: (method, params) => this.request(method, { ...base, ...params }),
      callMoxxyTool: async (name, args) => {
        const client = await this.moxxyClient(thread);
        const result = await client.callTool({ name, arguments: args });
        return { content: result.content, ...(result.isError ? { isError: true } : {}) };
      },
      usage: (inputTokens, outputTokens, cached = 0) => {
        const last = { totalTokens: inputTokens + outputTokens, inputTokens, cachedInputTokens: cached, cacheWriteInputTokens: 0, outputTokens, reasoningOutputTokens: 0 };
        this.notify('thread/tokenUsage/updated', { ...base, tokenUsage: { total: last, last, modelContextWindow: 380_000 } });
      },
      goal: (status) => {
        if (!thread.goal) throw new Error('no goal is set');
        thread.goal = { ...thread.goal, status };
        this.notify('thread/goal/updated', { ...base, goal: thread.goal });
      },
    };
  }

  /** Connect to Moxxy's MCP server the way Codex does, from the thread config Moxxy passed. */
  private async moxxyClient(thread: FakeThread): Promise<Client> {
    if (!thread.mcp) throw new Error('Moxxy passed no MCP server in the thread config');
    const client = new Client({ name: 'codex-mcp-client', version: '0.155.1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(thread.mcp.url), { requestInit: { headers: thread.mcp.headers } }));
    this.mcpClients.push(client);
    return client;
  }
}

function threadResponse(thread: FakeThread): Record<string, unknown> {
  return {
    thread: { id: thread.id },
    model: thread.model,
    modelProvider: 'openai',
    cwd: thread.cwd,
    approvalPolicy: thread.approvalPolicy,
    sandbox: thread.sandbox,
    reasoningEffort: thread.effort,
    serviceTier: thread.serviceTier,
    instructionSources: [],
  };
}

function sandboxFromMode(mode: unknown): CodexSandboxPolicy | undefined {
  if (mode === 'read-only') return { type: 'readOnly', networkAccess: false };
  if (mode === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (mode === 'workspace-write') return { type: 'workspaceWrite' };
  return undefined;
}

function mcpOf(config: unknown): FakeThread['mcp'] {
  const servers = (config as { mcp_servers?: Record<string, { url?: string; http_headers?: Record<string, string> }> } | undefined)?.mcp_servers;
  const moxxy = servers ? servers.moxxy : undefined;
  return moxxy && typeof moxxy.url === 'string' ? { url: moxxy.url, headers: moxxy.http_headers ?? {} } : undefined;
}
