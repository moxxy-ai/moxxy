/**
 * Minimal newline-delimited JSON-RPC 2.0 client for the signal-cli daemon
 * socket (`signal-cli -a <account> daemon --socket <path>`).
 *
 * The daemon speaks one JSON object per line over the UNIX socket:
 *   → {"jsonrpc":"2.0","id":"…","method":"send","params":{…}}
 *   ← {"jsonrpc":"2.0","id":"…","result":{…}} | {"…","error":{code,message}}
 *   ← {"jsonrpc":"2.0","method":"receive","params":{"envelope":{…}}}   (notification)
 *
 * The transport is injected as a plain duplex-ish stream so tests never open a
 * real socket (mirrors the browser sidecar's injectable spawn).
 */

/** The stream slice this client needs — `net.Socket` satisfies it. */
export interface RpcStream {
  write(data: string): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  end?(): unknown;
  destroy?(): unknown;
}

export interface RpcLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface SignalRpcClientOptions {
  readonly stream: RpcStream;
  /** Per-request timeout. signal-cli sends synchronously to the Signal server,
   *  so allow generous headroom. Default 30s. */
  readonly requestTimeoutMs?: number;
  readonly logger?: RpcLogger;
}

/**
 * Cap on a single buffered line. Receive envelopes are small (attachments are
 * written to signal-cli's data dir, not inlined), so anything beyond this is a
 * malformed/hostile peer; we drop the buffer instead of growing unbounded.
 */
const MAX_LINE_BUFFER = 8 * 1024 * 1024;

interface PendingCall {
  resolve(value: unknown): void;
  reject(err: Error): void;
}

export class SignalRpcClient {
  private readonly stream: RpcStream;
  private readonly requestTimeoutMs: number;
  private readonly logger: RpcLogger | undefined;
  private readonly pending = new Map<string, PendingCall>();
  private readonly notificationListeners = new Map<string, Set<(params: unknown) => void>>();
  private readonly closeListeners = new Set<(reason: string) => void>();
  private buffer = '';
  private nextId = 1;
  private closed = false;

  constructor(opts: SignalRpcClientOptions) {
    this.stream = opts.stream;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
    this.logger = opts.logger;
    this.stream.on('data', (chunk) => this.onData(chunk));
    this.stream.on('close', () => this.teardown('socket closed'));
    this.stream.on('error', (err) => this.teardown(`socket error: ${err.message}`));
  }

  /** Subscribe to a JSON-RPC notification method (e.g. 'receive'). */
  onNotification(method: string, listener: (params: unknown) => void): () => void {
    let set = this.notificationListeners.get(method);
    if (!set) {
      set = new Set();
      this.notificationListeners.set(method, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Fires once when the underlying stream closes/errors (daemon died). */
  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error(`signal-cli rpc closed (cannot call ${method})`));
    }
    const id = String(this.nextId++);
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<unknown>((resolve, reject) => {
      // Per-call timeout so a wedged daemon never strands the caller.
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`signal-cli rpc "${method}" timed out after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.stream.write(payload + '\n');
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  close(): void {
    this.teardown('client closed');
    try {
      this.stream.end?.();
      this.stream.destroy?.();
    } catch {
      /* best-effort */
    }
  }

  private teardown(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) p.reject(new Error(`signal-cli rpc: ${reason}`));
    this.pending.clear();
    for (const listener of this.closeListeners) {
      try {
        listener(reason);
      } catch {
        /* listener errors must not break teardown */
      }
    }
    this.closeListeners.clear();
  }

  private onData(chunk: Buffer | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.trim()) this.handleLine(line);
    }
    if (this.buffer.length > MAX_LINE_BUFFER) {
      this.logger?.warn?.('signal rpc: dropped oversized un-delimited line', {
        bytes: this.buffer.length,
      });
      this.buffer = '';
    }
  }

  private handleLine(line: string): void {
    let msg: {
      id?: string | number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      this.logger?.warn?.('signal rpc: ignoring unparseable line');
      return;
    }
    // Notification: has a method, no id.
    if (msg.method !== undefined && msg.id === undefined) {
      const listeners = this.notificationListeners.get(msg.method);
      if (!listeners) return;
      for (const listener of listeners) {
        try {
          listener(msg.params);
        } catch (err) {
          this.logger?.warn?.('signal rpc: notification listener threw', { err: String(err) });
        }
      }
      return;
    }
    // Response: match by id.
    const id = msg.id !== undefined ? String(msg.id) : null;
    const p = id ? this.pending.get(id) : undefined;
    if (!p || !id) return; // late/unknown reply — ignore
    this.pending.delete(id);
    if (msg.error) {
      p.reject(new Error(`signal-cli rpc error ${msg.error.code ?? ''}: ${msg.error.message ?? 'unknown'}`));
    } else {
      p.resolve(msg.result);
    }
  }
}
