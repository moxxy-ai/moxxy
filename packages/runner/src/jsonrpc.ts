import type { Transport } from './transport.js';

/**
 * Bidirectional JSON-RPC peer over a {@link Transport}. Both ends are
 * symmetric: either side can issue requests, answer requests, and fire
 * notifications. That symmetry is the whole point - the runner needs to make
 * *server->client* requests (`permission.check`, `approval.confirm`) while the
 * client makes *client->server* requests (`runTurn`, `attach`). A request/reply
 * protocol that only flowed one way (e.g. SSE) couldn't model that.
 *
 * Wire shapes (a single JSON object per frame):
 *   request      { id, method, params? }
 *   response     { id, result }  |  { id, error: { message, data? } }
 *   notification { method, params? }            // no id
 */

interface RpcRequestFrame {
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}
interface RpcResponseFrame {
  readonly id: number;
  readonly result?: unknown;
  readonly error?: { readonly message: string; readonly data?: unknown };
}
interface RpcNotificationFrame {
  readonly method: string;
  readonly params?: unknown;
}

/** Handler for an incoming request. Return value (or throw) becomes the reply. */
export type RequestHandler = (params: unknown, peer: JsonRpcPeer) => Promise<unknown> | unknown;
/** Handler for an incoming notification. No reply. */
export type NotificationHandler = (params: unknown, peer: JsonRpcPeer) => void;

/** Error carrying the remote peer's message across a failed request. */
export class RpcError extends Error {
  readonly data?: unknown;
  constructor(message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.data = data;
  }
}

/** Options for an outbound {@link JsonRpcPeer.request}. */
export interface RequestOptions {
  /**
   * Reject the request after this many ms if no response frame arrives. Guards
   * against a peer that stays SOCKET-CONNECTED but never replies (a hung
   * renderer that doesn't drop the link): without it the pending waiter is only
   * ever settled by a matching response or a real close, so the caller — and
   * any turn awaiting it (permission.check / approval.confirm) — hangs forever.
   */
  readonly timeoutMs?: number;
  /** Reject the request (with an AbortError) if this signal fires first — wires
   *  a turn's abort into the in-flight server->client request. */
  readonly signal?: AbortSignal;
}

export class JsonRpcPeer {
  private idCounter = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly notificationHandlers = new Map<string, NotificationHandler>();
  private readonly closeHandlers: Array<(err?: Error) => void> = [];
  private closed = false;

  constructor(private readonly transport: Transport) {
    transport.onFrame((frame) => void this.handleFrame(frame));
    transport.onClose((err) => this.handleClose(err));
  }

  /** Register a request handler. Last registration for a method wins. */
  handle(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  /** Register a notification handler. */
  on(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  /** Run a callback when the link closes (or has already closed). */
  onClose(handler: (err?: Error) => void): void {
    if (this.closed) {
      handler();
      return;
    }
    this.closeHandlers.push(handler);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Issue a request and await the typed reply. Rejects with {@link RpcError}. */
  request<T = unknown>(method: string, params?: unknown, opts: RequestOptions = {}): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError('rpc peer is closed'));
    if (opts.signal?.aborted) return Promise.reject(new RpcError('request aborted'));
    const id = this.nextId();
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      // Settle once: drop the pending entry and tear down the timer/abort wiring
      // so a late response (or a second trigger) can't double-settle or leak.
      const settle = (fn: () => void): void => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort && opts.signal) opts.signal.removeEventListener('abort', onAbort);
        fn();
      };
      this.pending.set(id, {
        resolve: (v) => settle(() => resolve(v as T)),
        reject: (err) => settle(() => reject(err)),
      });
      if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
        timer = setTimeout(() => {
          const waiter = this.pending.get(id);
          waiter?.reject(new RpcError(`request timed out after ${opts.timeoutMs}ms: ${method}`));
        }, opts.timeoutMs);
        if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
      }
      if (opts.signal) {
        onAbort = (): void => {
          const waiter = this.pending.get(id);
          waiter?.reject(new RpcError('request aborted'));
        };
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      const frame: RpcRequestFrame = { id, method, ...(params !== undefined ? { params } : {}) };
      this.transport.send(frame);
    });
  }

  /**
   * Monotonic request id. Wraps before {@link Number.MAX_SAFE_INTEGER} (past
   * which `++` produces imprecise/duplicate ids) and skips any id still pending,
   * so a collision with an in-flight waiter is impossible regardless of uptime.
   */
  private nextId(): number {
    do {
      if (this.idCounter >= Number.MAX_SAFE_INTEGER) this.idCounter = 1;
      else this.idCounter += 1;
    } while (this.pending.has(this.idCounter));
    return this.idCounter;
  }

  /** Fire a notification (no reply expected). No-op once closed. */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const frame: RpcNotificationFrame = {
      method,
      ...(params !== undefined ? { params } : {}),
    };
    this.transport.send(frame);
  }

  close(): void {
    this.transport.close();
  }

  private async handleFrame(frame: unknown): Promise<void> {
    if (!frame || typeof frame !== 'object') return;
    const f = frame as Partial<RpcRequestFrame & RpcResponseFrame & RpcNotificationFrame>;

    // Request: has both a method and an id.
    if (typeof f.method === 'string' && typeof f.id === 'number') {
      await this.dispatchRequest(f.id, f.method, f.params);
      return;
    }
    // Notification: a method with no id.
    if (typeof f.method === 'string') {
      const handler = this.notificationHandlers.get(f.method);
      if (handler) {
        try {
          handler(f.params, this);
        } catch {
          // Notifications are best-effort; a throwing handler must not kill the peer.
        }
      }
      return;
    }
    // Response: an id with result/error and no method. `resolve`/`reject` route
    // through `settle`, which drops the pending entry and clears its timer/abort
    // wiring — so a response that beats the timeout doesn't leak the timer.
    if (typeof f.id === 'number') {
      const waiter = this.pending.get(f.id);
      if (!waiter) return;
      if (f.error) waiter.reject(new RpcError(f.error.message, f.error.data));
      else waiter.resolve(f.result);
    }
  }

  private async dispatchRequest(id: number, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.transport.send({ id, error: { message: `unknown method: ${method}` } });
      return;
    }
    try {
      const result = await handler(params, this);
      this.transport.send({ id, result: result === undefined ? null : result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Carry structured error data (e.g. a coded MoxxyIpcError envelope) when an
      // RpcError supplies it, so the requester reconstructs the classified error
      // rather than string-matching the message. The response-parse side already
      // reads `f.error.data` (see handleFrame); this completes the symmetry.
      const data = err instanceof RpcError ? err.data : undefined;
      this.transport.send({ id, error: { message, ...(data !== undefined ? { data } : {}) } });
    }
  }

  private handleClose(err?: Error): void {
    if (this.closed) return;
    this.closed = true;
    const failure = err ?? new RpcError('connection closed');
    // `reject` routes through each waiter's `settle`, which deletes its own entry
    // and clears its timer/abort listener — so closing the link can't leak a
    // pending timer. Snapshot the values first (the loop body mutates the Map).
    for (const waiter of [...this.pending.values()]) waiter.reject(failure);
    this.pending.clear();
    for (const handler of this.closeHandlers) {
      try {
        handler(err);
      } catch {
        // ignore
      }
    }
    this.closeHandlers.length = 0;
  }
}
