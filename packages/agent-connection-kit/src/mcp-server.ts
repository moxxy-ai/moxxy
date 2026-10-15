import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { waitFor, type WakeSource } from '@moxxy/sdk';

/**
 * The MCP server through which a vendor agent calls Moxxy's own tools.
 * Streamable HTTP, stateless, answering every request with one JSON object:
 * only `initialize`, `ping`, `tools/list` and `tools/call` are needed, plus the
 * event stream that carries `notifications/tools/list_changed` to an agent that
 * reads the list once (OpenCode). Written by hand because the MCP SDK is kept
 * out of the CLI bundle.
 */

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  /** Vendor hints read by one agent and ignored by the others (MCP `_meta`). */
  readonly _meta?: Readonly<Record<string, unknown>>;
}

export type McpContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string };

export interface McpCallResult {
  readonly content: ReadonlyArray<McpContent>;
  readonly isError?: boolean;
}

/** The tools of the turn that is running now. */
export interface McpToolHandler {
  list(): ReadonlyArray<McpTool>;
  call(name: string, args: unknown, signal: AbortSignal): Promise<McpCallResult>;
}

export interface MoxxyMcpServer {
  readonly url: string;
  /** The value of the `Authorization` header the agent must send. */
  readonly authorization: string;
  /** Point the server at the tools of another turn, or at none between turns. */
  setHandler(handler: McpToolHandler | undefined): void;
  /**
   * Make sure the agent has this turn's tools. An agent that already read
   * another list is told it changed, and this resolves once it read the list
   * again: `false` when it did not within `timeoutMs`.
   */
  announceTools(opts?: AnnounceOptions): Promise<boolean>;
  close(): Promise<void>;
}

export interface AnnounceOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface MoxxyMcpServerOptions {
  readonly handler?: McpToolHandler;
  readonly name?: string;
  readonly version?: string;
}

export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const ANNOUNCE_TIMEOUT_MS = 5_000;
const LIST_CHANGED = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n\n`;

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INVALID_REQUEST = -32600;
const PARSE_ERROR = -32700;

type JsonRpcId = string | number;

interface JsonRpcMessage {
  readonly jsonrpc?: unknown;
  readonly id?: JsonRpcId | null;
  readonly method?: unknown;
  readonly params?: unknown;
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export async function startMoxxyMcpServer(opts: MoxxyMcpServerOptions = {}): Promise<MoxxyMcpServer> {
  let handler = opts.handler;
  const token = randomBytes(32).toString('base64url');
  const authorization = `Bearer ${token}`;
  const serverInfo = { name: opts.name ?? 'moxxy', version: opts.version ?? '0.0.0' };
  /** Open event streams, where notices reach the agent. */
  const streams = new Set<ServerResponse>();
  /** The tools as the agent last read them; `undefined` until it reads them. */
  let listed: string | undefined;
  const wakers = new Set<() => void>();
  const changed = () => wakers.forEach((wake) => wake());
  const onChange: WakeSource = (wake) => {
    wakers.add(wake);
    return () => wakers.delete(wake);
  };

  const dispatch = async (method: string, params: unknown, signal: AbortSignal): Promise<unknown> => {
    switch (method) {
      case 'initialize': {
        const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
        const protocolVersion = isSupportedVersion(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
        return { protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: handler ? handler.list() : [] };
      case 'tools/call':
        return callTool(params, signal);
      default:
        throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };

  const callTool = async (params: unknown, signal: AbortSignal): Promise<McpCallResult> => {
    const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof name !== 'string') throw new RpcError(INVALID_PARAMS, 'tools/call needs a tool name');
    const current = handler;
    if (!current) return failure('No Moxxy turn is running, so the tool cannot run now.');
    if (!current.list().some((tool) => tool.name === name)) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
    try {
      return await current.call(name, args ?? {}, signal);
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500);
      else res.destroy();
    });
  });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // A browser always names the page a request comes from; an agent never does.
    if (req.headers.origin !== undefined) return send(res, 403);
    if (!authorized(req.headers.authorization, authorization)) return send(res, 401);
    const version = req.headers['mcp-protocol-version'];
    if (typeof version === 'string' && !isSupportedVersion(version)) {
      return send(res, 400, rpcError(null, INVALID_REQUEST, `Unsupported MCP protocol version: ${version}`));
    }
    if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) return openStream(res);
    if (req.method !== 'POST') return send(res, 405, undefined, { allow: 'POST' });

    const body = await readBody(req);
    if (body === undefined) return send(res, 413);
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(body) as JsonRpcMessage;
    } catch {
      return send(res, 400, rpcError(null, PARSE_ERROR, 'The body is not JSON'));
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return send(res, 400, rpcError(null, INVALID_REQUEST, 'Expected one JSON-RPC message'));
    }
    // Notifications and responses need no answer.
    if (message.id === undefined || message.id === null || typeof message.method !== 'string') return send(res, 202);

    const id = message.id;
    const hungUp = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) hungUp.abort();
    });
    try {
      const result = await dispatch(message.method, message.params, hungUp.signal);
      if (hungUp.signal.aborted) return;
      send(res, 200, { jsonrpc: '2.0', id, result });
      if (message.method === 'tools/list') {
        listed = signatureOf((result as { tools: ReadonlyArray<McpTool> }).tools);
        changed();
      }
    } catch (err) {
      const code = err instanceof RpcError ? err.code : -32603;
      if (!hungUp.signal.aborted) send(res, 200, rpcError(id, code, err instanceof Error ? err.message : String(err)));
    }
  };

  const openStream = (res: ServerResponse): void => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    streams.add(res);
    res.on('close', () => streams.delete(res));
    changed();
  };

  const current = () => signatureOf(handler ? handler.list() : []);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    authorization,
    setHandler(next) {
      handler = next;
    },
    async announceTools({ timeoutMs = ANNOUNCE_TIMEOUT_MS, signal } = {}) {
      // An agent that never read the list reads this one when it does.
      if (listed === undefined || listed === current()) return true;
      let told = false;
      const outcome = await waitFor(
        () => {
          if (listed === current()) return true;
          if (!told && streams.size > 0) {
            told = true;
            for (const stream of streams) stream.write(LIST_CHANGED);
          }
          return undefined;
        },
        { wakeOn: [onChange], timeoutMs, ...(signal ? { signal } : {}) },
      );
      return outcome.status === 'ready';
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const stream of streams) stream.end();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

function isSupportedVersion(value: unknown): value is (typeof MCP_PROTOCOL_VERSIONS)[number] {
  return typeof value === 'string' && (MCP_PROTOCOL_VERSIONS as ReadonlyArray<string>).includes(value);
}

function signatureOf(tools: ReadonlyArray<McpTool>): string {
  return JSON.stringify(tools.map(({ name, description, inputSchema }) => [name, description, inputSchema]));
}

function authorized(given: string | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function failure(text: string): McpCallResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function rpcError(id: JsonRpcId | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  res.writeHead(status, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** The request body, or `undefined` when it is larger than an agent ever sends. */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
