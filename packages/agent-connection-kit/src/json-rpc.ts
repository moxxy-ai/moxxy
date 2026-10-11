import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

/**
 * JSON-RPC over newline-delimited JSON, the way vendor agents serve their own
 * protocol on stdio: Codex app-server leaves out the `"jsonrpc"` field, ACP
 * agents (OpenCode) send it. Both directions can make requests.
 */

export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

export interface JsonRpcLineClientOptions {
  /** What the agent writes (its stdout). */
  readonly readable: Readable;
  /** Where Moxxy writes to the agent (its stdin). */
  readonly writable: Writable;
  /** Write `"jsonrpc": "2.0"` on every message (ACP); Codex expects none. */
  readonly jsonrpc?: boolean;
}

type Id = string | number;
export type NotificationHandler = (method: string, params: unknown) => void;
export type RequestHandler = (method: string, params: unknown) => unknown;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface Incoming {
  readonly id?: Id | null;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown; readonly data?: unknown };
}

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export class JsonRpcLineClient {
  private nextId = 1;
  private readonly pending = new Map<Id, Pending>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private requestHandler: RequestHandler | undefined;
  private closedWith: Error | undefined;

  constructor(private readonly opts: JsonRpcLineClientOptions) {
    const lines = createInterface({ input: opts.readable, crlfDelay: Infinity });
    lines.on('line', (line) => this.receive(line));
    lines.on('close', () => this.close(new Error('The agent stopped.')));
    opts.writable.on('error', (err: Error) => this.close(err));
  }

  request<T = unknown>(method: string, params?: unknown, signal?: AbortSignal): Promise<T> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    if (signal?.aborted) return Promise.reject(abortError());
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value as T);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
      this.write({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closedWith) return;
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  /** Answer the agent's own requests (approvals, questions). One handler at a time. */
  onRequest(handler: RequestHandler | undefined): void {
    this.requestHandler = handler;
  }

  /** Fail everything still waiting; later requests fail at once. */
  close(reason: Error = new Error('The agent connection was closed.')): void {
    if (this.closedWith) return;
    this.closedWith = reason;
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    let message: Incoming;
    try {
      message = JSON.parse(line) as Incoming;
    } catch {
      return; // Agents print the odd non-protocol line (warnings); it is not ours to read.
    }
    if (typeof message !== 'object' || message === null) return;
    const hasId = message.id !== undefined && message.id !== null;
    if (typeof message.method === 'string') {
      if (hasId) void this.answer(message.id as Id, message.method, message.params);
      else for (const handler of this.notificationHandlers) handler(message.method, message.params);
      return;
    }
    if (!hasId) return;
    const pending = this.pending.get(message.id as Id);
    if (!pending) return;
    this.pending.delete(message.id as Id);
    if (message.error) {
      const { code, message: text, data } = message.error;
      pending.reject(new JsonRpcError(typeof code === 'number' ? code : INTERNAL_ERROR, String(text ?? 'Unknown error'), data));
    } else {
      pending.resolve(message.result);
    }
  }

  private async answer(id: Id, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandler;
    if (!handler) {
      this.write({ id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } });
      return;
    }
    try {
      this.write({ id, result: (await handler(method, params)) ?? null });
    } catch (err) {
      const code = err instanceof JsonRpcError ? err.code : INTERNAL_ERROR;
      this.write({ id, error: { code, message: err instanceof Error ? err.message : String(err) } });
    }
  }

  private write(message: Record<string, unknown>): void {
    if (this.closedWith) return;
    const framed = this.opts.jsonrpc ? { jsonrpc: '2.0', ...message } : message;
    this.opts.writable.write(`${JSON.stringify(framed)}\n`);
  }
}

function abortError(): Error {
  const error = new Error('The request was aborted.');
  error.name = 'AbortError';
  return error;
}
