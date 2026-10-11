/**
 * A stand-in for `opencode acp`, the external boundary of the OpenCode agent
 * connection. It speaks JSON-RPC 2.0 lines over the same two streams, shaped
 * after recorded 1.18.35 sessions: `session/new` answers with the session's
 * settings, `session/prompt` streams `session/update` notifications and then
 * answers with the stop reason and usage, permission asks are requests to
 * Moxxy, `session/load` replays the saved history before it answers, and
 * Moxxy's tools are called over Moxxy's MCP server with the real MCP client.
 * What OpenCode does in a turn is a scene the test writes.
 */
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AcpConnection } from './acp-session.js';
import type { AcpContentBlock, AcpPermissionOutcome, AcpToolKind, AcpUsage } from './protocol.js';
import type { OpenCodeRule } from './rules.js';

export interface FakeModel {
  readonly id: string;
  readonly efforts?: ReadonlyArray<string>;
}

export interface FakeOpenCodeDefaults {
  readonly model?: string;
  readonly mode?: string;
  readonly models?: ReadonlyArray<FakeModel>;
  /**
   * The rules `opencode debug agent <name>` reports, per agent; `null` when
   * OpenCode cannot say. By default the person set OpenCode to ask before
   * edits and commands.
   */
  readonly rules?: Readonly<Record<string, ReadonlyArray<OpenCodeRule>>> | null;
}

/** OpenCode 1.18's answer to `session/load` that fails, whether or not the session exists. */
const SERVICE_FAILURE = { code: -32603, message: 'Internal error: OpenCode service failure', data: { service: 'session' } };
/** How many sessions one `session/list` page holds here, so Moxxy has to page. */
const LIST_PAGE = 2;

/** OpenCode 1.18's own rules for the build agent, abridged: everything allowed. */
export const OPENCODE_DEFAULT_RULES: ReadonlyArray<OpenCodeRule> = [
  { permission: '*', pattern: '*', action: 'allow' },
  { permission: 'doom_loop', pattern: '*', action: 'ask' },
  { permission: 'external_directory', pattern: '*', action: 'ask' },
];

const ASKING_RULES: ReadonlyArray<OpenCodeRule> = [
  ...OPENCODE_DEFAULT_RULES,
  { permission: 'edit', pattern: '*', action: 'ask' },
  { permission: 'bash', pattern: '*', action: 'ask' },
];

export interface FakeSession {
  readonly id: string;
  readonly cwd: string;
  model: string;
  mode: string;
  effort: string | undefined;
  mcp: { readonly url: string; readonly headers: Record<string, string> } | undefined;
  /**
   * The Moxxy tools as OpenCode read them: once when the session opens, again
   * only when Moxxy says the list changed. The model can call nothing else.
   */
  moxxyTools: ReadonlyArray<string>;
  /** The read of the Moxxy tools in flight, if any. */
  reading?: Promise<void>;
  /** What a later `session/load` replays: the updates this session sent. */
  readonly history: Array<Record<string, unknown>>;
}

export interface ToolOptions {
  /** The title OpenCode shows once the input is known (the command, the file). */
  readonly title?: string;
  /** Ask Moxxy first, as OpenCode does for an `ask` rule. */
  readonly ask?: boolean;
  /**
   * A path outside the project the call works in. OpenCode's own rules ask
   * about it first (`external_directory`), even on its defaults.
   */
  readonly outside?: string;
  readonly fails?: string;
}

export interface FakeTurn {
  readonly session: FakeSession;
  readonly server: FakeOpenCodeServer;
  readonly prompt: ReadonlyArray<AcpContentBlock>;
  /** The text of the prompt. */
  readonly text: string;
  /** Aborted when Moxxy cancels the prompt. */
  readonly signal: AbortSignal;
  say(text: string): void;
  think(text: string): void;
  /**
   * One of OpenCode's own tools. With `ask` OpenCode asks Moxxy first and,
   * when refused, reports the call failed; the scene should then end the turn,
   * as OpenCode does.
   */
  tool(name: string, kind: AcpToolKind, input: Record<string, unknown>, output: string, opts?: ToolOptions): Promise<{ readonly allowed: boolean; readonly answer?: AcpPermissionOutcome }>;
  callMoxxyTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown; isError?: boolean }>;
  usage(usage: AcpUsage): void;
}

export type OpenCodeScene = (turn: FakeTurn) => Promise<void | { readonly error: { readonly code: number; readonly message: string } }>;

const DEFAULT_MODELS: ReadonlyArray<FakeModel> = [
  { id: 'opencode/big-pickle' },
  { id: 'opencode/space-bunny-free', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'default'] },
  { id: 'openai/gpt-6-luna', efforts: ['none', 'low', 'medium', 'high', 'xhigh'] },
];

/** The person's OpenCode install: every `opencode acp` Moxxy starts, and the sessions it saved. */
export class FakeOpenCode {
  readonly servers: FakeOpenCodeServer[] = [];
  readonly saved = new Map<string, FakeSession>();
  sessionCount = 0;
  promptCount = 0;
  /** How many of the next `session/load` calls fail, as an OpenCode briefly unable to read its sessions. */
  loadFailures = 0;

  constructor(
    readonly scene: OpenCodeScene,
    readonly defaults: FakeOpenCodeDefaults = {},
  ) {}

  get models(): ReadonlyArray<FakeModel> {
    return this.defaults.models ?? DEFAULT_MODELS;
  }

  /** What Moxxy calls to start `opencode acp`. */
  readonly start = async (opts: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> }): Promise<AcpConnection> => {
    const server = new FakeOpenCodeServer(this, opts.cwd, opts.env ?? {});
    this.servers.push(server);
    return server.connection;
  };

  /** What Moxxy reads to learn how OpenCode runs. */
  readonly readRules = async (opts: { readonly cwd: string; readonly agent: string }): Promise<ReadonlyArray<OpenCodeRule> | undefined> => {
    this.rulesRead.push(opts.agent);
    const { rules } = this.defaults;
    if (rules === null) return undefined;
    return rules ? rules[opts.agent] : ASKING_RULES;
  };

  readonly rulesRead: string[] = [];

  get last(): FakeOpenCodeServer {
    const server = this.servers.at(-1);
    if (!server) throw new Error('OpenCode was never started');
    return server;
  }
}

export class FakeOpenCodeServer {
  readonly requests: Array<{ readonly method: string; readonly params: Record<string, unknown> }> = [];
  readonly sessions = new Map<string, FakeSession>();
  readonly connection: AcpConnection;
  /** How Moxxy answered each permission ask, in order. */
  readonly permissionAnswers: AcpPermissionOutcome[] = [];
  closed = false;
  private readonly toMoxxy = new PassThrough();
  private readonly fromMoxxy = new PassThrough();
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private nextRequestId = 0;
  private active: { readonly sessionId: string; readonly stop: AbortController } | undefined;
  private readonly mcpClients: Client[] = [];
  private readonly moxxyClients = new Map<string, Client>();

  constructor(
    private readonly opencode: FakeOpenCode,
    readonly cwd: string,
    readonly env: Readonly<Record<string, string>>,
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

  /** Every request or notification Moxxy sent with this method, in order. */
  sent(method: string): Array<Record<string, unknown>> {
    return this.requests.filter((r) => r.method === method).map((r) => r.params);
  }

  get session(): FakeSession {
    const session = [...this.sessions.values()].at(-1);
    if (!session) throw new Error('No session was started');
    return session;
  }

  /** OpenCode crashed: its stdout closes. */
  crash(): void {
    this.toMoxxy.end();
  }

  update(session: FakeSession, update: Record<string, unknown>, record = true): void {
    if (record) session.history.push(update);
    this.write({ method: 'session/update', params: { sessionId: session.id, update } });
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.toMoxxy.writableEnded) this.toMoxxy.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  private async receive(line: string): Promise<void> {
    const message = JSON.parse(line) as {
      jsonrpc?: string;
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { message: string };
    };
    if (message.jsonrpc !== '2.0') throw new Error('ACP messages carry "jsonrpc": "2.0"');
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
    if (message.id === undefined) {
      if (message.method === 'session/cancel' && this.active && this.active.sessionId === params.sessionId) this.active.stop.abort();
      return;
    }
    try {
      this.write({ id: message.id, result: await this.handle(message.method, params) });
    } catch (err) {
      const rpc = err as { code?: number; message?: string };
      this.write({ id: message.id, error: { code: typeof rpc.code === 'number' ? rpc.code : -32603, message: rpc.message ?? String(err) } });
    }
  }

  private async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            mcpCapabilities: { http: true, sse: true },
            promptCapabilities: { image: true, embeddedContext: true },
            sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
          },
          authMethods: [{ id: 'opencode-login', name: 'Login with opencode', description: 'Run `opencode auth login` in the terminal' }],
          agentInfo: { name: 'OpenCode', version: '1.18.35' },
        };
      case 'session/new': {
        const { defaults } = this.opencode;
        const session: FakeSession = {
          id: `ses_${++this.opencode.sessionCount}`,
          cwd: String(params.cwd),
          model: defaults.model ?? 'opencode/big-pickle',
          mode: defaults.mode ?? 'build',
          effort: undefined,
          mcp: mcpOf(params.mcpServers),
          moxxyTools: [],
          history: [],
        };
        await this.connectMoxxy(session);
        this.sessions.set(session.id, session);
        this.opencode.saved.set(session.id, session);
        return { sessionId: session.id, configOptions: this.configOptions(session) };
      }
      case 'session/load': {
        const saved = this.opencode.saved.get(String(params.sessionId));
        if (this.opencode.loadFailures > 0 || !saved) {
          this.opencode.loadFailures = Math.max(0, this.opencode.loadFailures - 1);
          throw Object.assign(new Error(SERVICE_FAILURE.message), SERVICE_FAILURE);
        }
        const session: FakeSession = { ...saved, mcp: mcpOf(params.mcpServers), moxxyTools: [], history: saved.history };
        await this.connectMoxxy(session);
        this.sessions.set(session.id, session);
        // OpenCode replays the whole conversation before it answers.
        for (const update of saved.history) this.update(session, update, false);
        return { configOptions: this.configOptions(session) };
      }
      case 'session/list': {
        const all = [...this.opencode.saved.values()].filter((session) => session.cwd === params.cwd);
        const from = Number(params.cursor ?? 0);
        const page = all.slice(from, from + LIST_PAGE).map((session) => ({ sessionId: session.id, cwd: session.cwd, title: 'New session', updatedAt: '2026-10-11T12:00:00.000Z' }));
        return { sessions: page, ...(from + LIST_PAGE < all.length ? { nextCursor: String(from + LIST_PAGE) } : {}) };
      }
      case 'session/set_config_option': {
        const session = this.sessionOf(params);
        const value = String(params.value);
        const option = this.configOptions(session).find((o) => o.id === params.configId);
        if (!option) throw Object.assign(new Error(`Unknown config option: ${String(params.configId)}`), { code: -32602 });
        if (!option.options.some((o) => o.value === value)) throw Object.assign(new Error(`Invalid value for ${option.id}: ${value}`), { code: -32602 });
        if (option.id === 'model') {
          session.model = value;
          session.effort = this.efforts(session) ? 'low' : undefined;
        } else if (option.id === 'mode') session.mode = value;
        else if (option.id === 'effort') session.effort = value;
        return { configOptions: this.configOptions(session) };
      }
      case 'session/prompt':
        return this.prompt(this.sessionOf(params), (params.prompt ?? []) as AcpContentBlock[]);
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
  }

  private efforts(session: FakeSession): ReadonlyArray<string> | undefined {
    return this.opencode.models.find((m) => m.id === session.model)?.efforts;
  }

  private configOptions(session: FakeSession): Array<{ id: string; category: string; type: 'select'; currentValue: string; options: Array<{ value: string; name: string }> }> {
    const efforts = this.efforts(session);
    return [
      { id: 'model', category: 'model', type: 'select', currentValue: session.model, options: this.opencode.models.map((m) => ({ value: m.id, name: m.id })) },
      ...(efforts && session.effort
        ? [{ id: 'effort', category: 'thought_level', type: 'select' as const, currentValue: session.effort, options: efforts.map((e) => ({ value: e, name: e })) }]
        : []),
      { id: 'mode', category: 'mode', type: 'select', currentValue: session.mode, options: [{ value: 'build', name: 'build' }, { value: 'plan', name: 'plan' }] },
    ];
  }

  private sessionOf(params: Record<string, unknown>): FakeSession {
    const session = this.sessions.get(String(params.sessionId));
    if (!session) throw Object.assign(new Error(`Session not found: ${String(params.sessionId)}`), { code: -32602 });
    return session;
  }

  private async prompt(session: FakeSession, prompt: ReadonlyArray<AcpContentBlock>): Promise<unknown> {
    if (this.active) throw new Error('a prompt is already running');
    this.opencode.promptCount += 1;
    const stop = new AbortController();
    this.active = { sessionId: session.id, stop };
    const text = prompt.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
    for (const block of prompt) if (block.type === 'text') session.history.push({ sessionUpdate: 'user_message_chunk', content: block });
    let usage: AcpUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const stopped = new Promise<'stopped'>((resolve) => stop.signal.addEventListener('abort', () => resolve('stopped'), { once: true }));
    // OpenCode settles its tools long after a prompt arrives (it saves the
    // message and builds the system prompt first); a re-read in flight lands.
    await session.reading;
    try {
      const outcome = await Promise.race([this.opencode.scene(this.turn(session, prompt, text, stop.signal, (u) => (usage = u))), stopped]);
      if (outcome && outcome !== 'stopped' && 'error' in outcome) throw Object.assign(new Error(outcome.error.message), { code: outcome.error.code });
    } finally {
      this.active = undefined;
    }
    if (stop.signal.aborted) return { stopReason: 'cancelled', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, _meta: {} };
    return { stopReason: 'end_turn', usage, _meta: {} };
  }

  private turn(session: FakeSession, prompt: ReadonlyArray<AcpContentBlock>, text: string, signal: AbortSignal, setUsage: (usage: AcpUsage) => void): FakeTurn {
    let messages = 0;
    let calls = 0;
    return {
      session,
      server: this,
      prompt,
      text,
      signal,
      say: (said) => {
        const messageId = `msg_${++messages}`;
        for (const chunk of said.match(/.{1,8}/gs) ?? []) this.update(session, { sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: chunk } });
      },
      think: (thought) => {
        const messageId = `thought_${++messages}`;
        for (const chunk of thought.match(/.{1,8}/gs) ?? []) this.update(session, { sessionUpdate: 'agent_thought_chunk', messageId, content: { type: 'text', text: chunk } });
      },
      tool: async (name, kind, input, output, opts = {}) => {
        const toolCallId = `call_${session.id}_${++calls}`;
        const title = opts.title ?? name;
        // OpenCode 1.18 announces a command with its folder only; the command follows.
        const announced = kind === 'execute' ? { cwd: session.cwd } : {};
        this.update(session, { sessionUpdate: 'tool_call', toolCallId, title: name, kind, status: 'pending', locations: [], rawInput: announced });
        let answer: AcpPermissionOutcome | undefined;
        const ruled = this.ruleFor(session, name, input);
        const asks = opts.ask === true || ruled === 'ask';
        // OpenCode 1.18 asks about a change while the call is pending, and about anything else once it runs.
        const running = () => this.update(session, { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress', kind, title, locations: [], rawInput: input });
        const changeAsk = asks && kind === 'edit';
        if (!changeAsk) running();
        if (opts.outside !== undefined && !(await this.askOutside(session, toolCallId, kind, input, opts.outside))) {
          const rejected = 'The user rejected permission to use this specific tool call.';
          this.update(session, { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', kind, title, rawInput: input, content: [{ type: 'content', content: { type: 'text', text: rejected } }], rawOutput: { error: rejected } });
          return { allowed: false };
        }
        if (ruled === 'deny') {
          const denied = 'The user has specified a rule which prevents you from using this specific tool call.';
          this.update(session, { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', kind, title, rawInput: input, content: [{ type: 'content', content: { type: 'text', text: denied } }], rawOutput: { error: denied } });
          return { allowed: false };
        }
        if (asks) {
          answer = (await this.request('session/request_permission', {
            sessionId: session.id,
            // OpenCode 1.18 asks about a change with the file and its diff, not the tool's own input.
            toolCall: { toolCallId, title, kind, status: 'pending', locations: [], rawInput: kind === 'edit' ? changeAsked(input) : input },
            options: [
              { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
              { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
              { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
            ],
          })) as AcpPermissionOutcome;
          this.permissionAnswers.push(answer);
          const chosen = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'reject';
          if (chosen === 'reject') {
            const rejected = 'The user rejected permission to use this specific tool call.';
            this.update(session, { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', kind, title, rawInput: input, content: [{ type: 'content', content: { type: 'text', text: rejected } }], rawOutput: { error: rejected } });
            return { allowed: false, answer };
          }
          if (changeAsk) running();
        }
        if (opts.fails) {
          this.update(session, { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', kind, title, rawInput: input, content: [{ type: 'content', content: { type: 'text', text: opts.fails } }], rawOutput: { error: opts.fails } });
          return { allowed: true, ...(answer ? { answer } : {}) };
        }
        this.update(session, { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', title, content: [{ type: 'content', content: { type: 'text', text: output } }], rawOutput: { output, metadata: { truncated: false } } });
        return { allowed: true, ...(answer ? { answer } : {}) };
      },
      callMoxxyTool: async (name, args) => {
        const toolCallId = `call_${session.id}_${++calls}`;
        this.update(session, { sessionUpdate: 'tool_call', toolCallId, title: `moxxy_${name}`, kind: 'other', status: 'pending', locations: [], rawInput: {} });
        this.update(session, { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress', kind: 'other', title: `moxxy_${name}`, locations: [], rawInput: args });
        const client = this.moxxyClients.get(session.id);
        if (!client || !session.moxxyTools.includes(name)) throw new Error(`OpenCode has no tool moxxy_${name}; it read ${JSON.stringify(session.moxxyTools)}`);
        const result = await client.callTool({ name, arguments: args });
        const text = (result.content as Array<{ type: string; text?: string }>).flatMap((c) => (c.type === 'text' && c.text ? [c.text] : [])).join('\n');
        this.update(session, { sessionUpdate: 'tool_call_update', toolCallId, status: result.isError ? 'failed' : 'completed', content: [{ type: 'content', content: { type: 'text', text } }] });
        return { content: result.content, ...(result.isError ? { isError: true } : {}) };
      },
      usage: (usage) => setUsage(usage),
    };
  }

  /**
   * What the rules Moxxy handed this OpenCode (`OPENCODE_CONFIG_CONTENT`, the
   * agent's own permissions, last matching pattern wins) say about a call.
   */
  /** OpenCode 1.18's `external_directory` ask, as its ACP agent sends it: a command names its folders, a file its parent. */
  private async askOutside(session: FakeSession, toolCallId: string, kind: AcpToolKind, input: Record<string, unknown>, outside: string): Promise<boolean> {
    const parentDir = kind === 'execute' ? outside : outside.slice(0, outside.lastIndexOf('/'));
    const rawInput =
      kind === 'execute'
        ? { command: input.command, directories: [outside], patterns: [`${outside}/*`] }
        : { filepath: outside, parentDir };
    const answer = (await this.request('session/request_permission', {
      sessionId: session.id,
      toolCall: { toolCallId, title: kind === 'execute' ? input.command : parentDir, kind: 'other', status: 'pending', locations: [{ path: outside }], rawInput },
      options: [
        { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ],
    })) as AcpPermissionOutcome;
    this.permissionAnswers.push(answer);
    return answer.outcome.outcome === 'selected' && answer.outcome.optionId !== 'reject';
  }

  private ruleFor(session: FakeSession, tool: string, input: Record<string, unknown>): string | undefined {
    const content = this.env.OPENCODE_CONFIG_CONTENT;
    if (!content) return undefined;
    const permissions = (JSON.parse(content) as { agent?: Record<string, { permission?: Record<string, unknown> }> }).agent?.[session.mode]?.permission;
    if (!permissions) return undefined;
    const key = tool === 'write' || tool === 'edit' || tool === 'patch' ? 'edit' : tool;
    const rule = permissions[key];
    if (typeof rule === 'string' || rule === undefined) return rule;
    const subject = String(input.command ?? input.filePath ?? '');
    return Object.entries(rule as Record<string, string>).findLast(([pattern]) => wildcard(pattern).test(subject))?.[1];
  }

  /**
   * Connect to the MCP server Moxxy listed on the session and read its tools,
   * as OpenCode does while it opens the session; re-read them on a notice.
   */
  private async connectMoxxy(session: FakeSession): Promise<void> {
    if (!session.mcp) return;
    const client = new Client({ name: 'opencode', version: '1.18.35' });
    await client.connect(new StreamableHTTPClientTransport(new URL(session.mcp.url), { requestInit: { headers: session.mcp.headers } }));
    this.mcpClients.push(client);
    this.moxxyClients.set(session.id, client);
    const read = () =>
      (session.reading = client.listTools().then(({ tools }) => {
        session.moxxyTools = tools.map((tool) => tool.name);
      }));
    client.setNotificationHandler(ToolListChangedNotificationSchema, read);
    await read();
  }
}

function changeAsked(input: Record<string, unknown>): Record<string, unknown> {
  const file = String(input.filePath);
  const after = String(input.content ?? input.newString ?? '');
  return { filepath: file, diff: `Index: ${file}\n--- ${file}\n+++ ${file}\n@@ -0,0 +1 @@\n+${after}\n` };
}

function wildcard(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

function mcpOf(servers: unknown): FakeSession['mcp'] {
  if (!Array.isArray(servers)) return undefined;
  const moxxy = (servers as Array<{ type?: string; name?: string; url?: string; headers?: Array<{ name: string; value: string }> }>).find(
    (server) => server.name === 'moxxy',
  );
  if (!moxxy || moxxy.type !== 'http' || typeof moxxy.url !== 'string') return undefined;
  return { url: moxxy.url, headers: Object.fromEntries((moxxy.headers ?? []).map((h) => [h.name, h.value])) };
}
