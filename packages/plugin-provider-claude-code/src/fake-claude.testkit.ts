/**
 * A stand-in for the Claude Agent SDK, the external boundary of the Claude
 * agent connection. It behaves like `query()`: it reads the person's messages
 * from the input stream, starts each turn with `system/init`, ends it with
 * `result`, asks `canUseTool` and the `PreToolUse` hook, and calls Moxxy's
 * tools over Moxxy's MCP server with the real MCP client. What Claude does in
 * a turn is a scene the test writes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  ClaudeAgentSdk,
  ClaudeMessage,
  ClaudePermissionMode,
  ClaudePermissionResult,
  ClaudePreToolUseOutput,
  ClaudeQuery,
  ClaudeQueryOptions,
  ClaudeUserContent,
  ClaudeUserMessage,
} from './sdk-types.js';

export interface FakeTurn {
  readonly text: string;
  readonly content: ClaudeUserContent;
  readonly query: FakeQuery;
  canUseTool(name: string, input: Record<string, unknown>, toolUseID: string, extra?: { mcpServer?: { name: string; source: string } }): Promise<ClaudePermissionResult>;
  preToolUse(name: string, input: unknown, toolUseID: string): Promise<ClaudePreToolUseOutput>;
  callMoxxyTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown; isError?: boolean }>;
}

export type ClaudeScene = (turn: FakeTurn) => AsyncIterable<ClaudeMessage>;

export const assistantText = (text: string, model = 'claude-opus-5-5'): ClaudeMessage =>
  ({ type: 'assistant', message: { model, content: [{ type: 'text', text }] }, parent_tool_use_id: null }) as ClaudeMessage;
export const assistantToolUse = (id: string, name: string, input: unknown): ClaudeMessage =>
  ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] }, parent_tool_use_id: null }) as ClaudeMessage;
export const toolResult = (id: string, content: string, isError = false): ClaudeMessage =>
  ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] }, parent_tool_use_id: null }) as ClaudeMessage;

export class FakeClaude implements ClaudeAgentSdk {
  readonly queries: FakeQuery[] = [];
  /** The sessions Claude keeps on disk, as `getSessionInfo` finds them. */
  readonly saved = new Set<string>();
  private sessions = 0;
  /** `ownMode`: the mode the person's own Claude settings start in when Moxxy names none. */
  constructor(
    private readonly scene: ClaudeScene,
    private readonly ownMode: ClaudePermissionMode = 'default',
  ) {}

  async getSessionInfo(sessionId: string): Promise<{ sessionId: string } | undefined> {
    return this.saved.has(sessionId) ? { sessionId } : undefined;
  }

  query(params: { prompt: string | AsyncIterable<ClaudeUserMessage>; options: ClaudeQueryOptions }): ClaudeQuery {
    this.sessions += 1;
    const sessionId = params.options.resume ?? `claude-session-${this.sessions}`;
    this.saved.add(sessionId);
    const query = new FakeQuery(params.prompt, params.options, sessionId, this.scene, this.ownMode);
    this.queries.push(query);
    return query;
  }

  get last(): FakeQuery {
    const query = this.queries.at(-1);
    if (!query) throw new Error('Claude was never started');
    return query;
  }
}

export class FakeQuery implements ClaudeQuery {
  readonly received: ClaudeUserMessage[] = [];
  readonly modeChanges: ClaudePermissionMode[] = [];
  readonly modelChanges: string[] = [];
  interrupts = 0;
  closed = false;
  permissionMode: ClaudePermissionMode;
  /** Moxxy's tools as Claude read them: once as it starts, and again on a list-changed notice. */
  moxxyTools: ReadonlyArray<string> = [];
  private reading: Promise<void> | undefined;
  private stop = new AbortController();
  private mcp: Client | undefined;
  /** Status messages waiting to be read, as Claude sends them whether or not a turn runs. */
  private readonly statuses: ClaudeMessage[] = [];

  constructor(
    private readonly prompt: string | AsyncIterable<ClaudeUserMessage>,
    readonly options: ClaudeQueryOptions,
    readonly sessionId: string,
    private readonly scene: ClaudeScene,
    ownMode: ClaudePermissionMode = 'default',
  ) {
    this.permissionMode = options.permissionMode ?? ownMode;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ClaudeMessage> {
    try {
      if (this.options.mcpServers?.moxxy) await this.readMoxxyTools();
      const messages = typeof this.prompt === 'string' ? [this.userMessage(this.prompt)] : this.prompt;
      for await (const message of messages) {
        if (this.closed) return;
        this.received.push(message);
        this.stop = new AbortController();
        yield* this.statuses.splice(0);
        yield { type: 'system', subtype: 'init', session_id: this.sessionId, permissionMode: this.permissionMode, model: this.options.model } as ClaudeMessage;
        let ended = false;
        const stop = this.stop.signal;
        const stopped = new Promise<'stopped'>((resolve) => stop.addEventListener('abort', () => resolve('stopped'), { once: true }));
        const scene = this.scene(this.turn(message))[Symbol.asyncIterator]();
        for (;;) {
          const next = await Promise.race([scene.next(), stopped]);
          if (next === 'stopped') {
            void scene.return?.();
            break;
          }
          yield* this.statuses.splice(0);
          if (next.done) break;
          if (next.value.type === 'result') ended = true;
          yield next.value;
        }
        if (this.stop.signal.aborted) {
          yield this.result('error_during_execution', true);
        } else if (!ended) {
          yield this.result('success', false);
        }
      }
    } finally {
      await this.mcp?.close();
    }
  }

  async interrupt(): Promise<unknown> {
    this.interrupts += 1;
    this.stop.abort();
    return undefined;
  }

  async setPermissionMode(mode: ClaudePermissionMode): Promise<void> {
    this.modeChanges.push(mode);
    this.toMode(mode);
  }

  /** The mode changes without Moxxy asking (another client, Claude itself); Claude reports it as it does any change. */
  changeModeElsewhere(mode: ClaudePermissionMode): void {
    this.toMode(mode);
  }

  private toMode(mode: ClaudePermissionMode): void {
    this.permissionMode = mode;
    // Claude Code 2.1 reports every change of mode with a status message, also one Moxxy asked for.
    this.statuses.push({ type: 'system', subtype: 'status', status: null, permissionMode: mode, session_id: this.sessionId } as ClaudeMessage);
  }

  async setModel(model?: string): Promise<void> {
    if (model) this.modelChanges.push(model);
  }

  close(): void {
    this.closed = true;
    this.stop.abort();
  }

  result(subtype: string, isError: boolean, extra: Record<string, unknown> = {}): ClaudeMessage {
    return {
      type: 'result',
      subtype,
      is_error: isError,
      session_id: this.sessionId,
      usage: { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 100 },
      origin: { kind: 'human' },
      ...extra,
    } as ClaudeMessage;
  }

  private turn(message: ClaudeUserMessage): FakeTurn {
    const content = message.message.content;
    const text = typeof content === 'string' ? content : content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    return {
      text,
      content,
      query: this,
      canUseTool: (name, input, toolUseID, extra) => {
        const ask = this.options.canUseTool;
        if (!ask) throw new Error('Claude was started without canUseTool');
        return ask(name, input, { signal: this.stop.signal, toolUseID, ...(extra ?? {}) });
      },
      preToolUse: async (name, input, toolUseID) => {
        let out: ClaudePreToolUseOutput = {};
        for (const matcher of this.options.hooks?.PreToolUse ?? []) {
          for (const hook of matcher.hooks) {
            const verdict = await hook({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, tool_use_id: toolUseID }, toolUseID, {
              signal: this.stop.signal,
            });
            if (verdict.hookSpecificOutput) out = verdict;
          }
        }
        return out;
      },
      callMoxxyTool: async (name, args) => {
        await this.reading;
        if (!this.moxxyTools.includes(name)) throw new Error(`Claude has no tool mcp__moxxy__${name}; it read ${JSON.stringify(this.moxxyTools)}`);
        const client = await this.moxxyClient();
        const result = await client.callTool({ name, arguments: args });
        return { content: result.content, ...(result.isError ? { isError: true } : {}) };
      },
    };
  }

  private async readMoxxyTools(): Promise<void> {
    const client = await this.moxxyClient();
    const read = () =>
      (this.reading = client.listTools().then(({ tools }) => {
        this.moxxyTools = tools.map((tool) => tool.name);
      }));
    client.setNotificationHandler(ToolListChangedNotificationSchema, read);
    await read();
  }

  /** Connect to Moxxy's MCP server the way Claude does, from the options Moxxy passed. */
  async moxxyClient(): Promise<Client> {
    if (this.mcp) return this.mcp;
    const server = this.options.mcpServers?.moxxy;
    if (!server) throw new Error('Moxxy passed no MCP server');
    const client = new Client({ name: 'claude-code', version: '2.1.296' });
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
    this.mcp = client;
    return client;
  }

  private userMessage(text: string): ClaudeUserMessage {
    return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, origin: { kind: 'human' } };
  }
}
