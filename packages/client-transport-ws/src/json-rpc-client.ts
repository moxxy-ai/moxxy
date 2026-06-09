/**
 * A minimal JSON-RPC client over a WebSocket — the client half of the protocol
 * the desktop host's WebSocket bridge speaks (`@moxxy/ipc-server-ws`). It only
 * does what a remote client needs: issue requests, correlate responses by id,
 * and dispatch server notifications. Deliberately self-contained (no
 * `@moxxy/runner`, no Node `ws`) so it bundles under Metro / React Native, where
 * `WebSocket` is a global.
 *
 * Wire frames (one JSON value per message):
 *   request      { id, method, params? }
 *   response     { id, result } | { id, error: { message, data? } }
 *   notification { method, params? }
 */

import { encodeIpcError, type MoxxyIpcError } from '@moxxy/desktop-ipc-contract';

/** The subset of the standard `WebSocket` this client uses (browser + RN). */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readonly readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

const WS_OPEN = 1;
const RECONNECT_DELAY_MS = 1500;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/** Reconstruct a thrown Error from a JSON-RPC error frame. When the host
 *  attached a coded {@link MoxxyIpcError} as `data`, re-encode it into the same
 *  string envelope the Electron path produces, so `@moxxy/client-core`'s
 *  `decodeError`/`toErrorMessage` recover the code + message identically. */
function errorFromFrame(error: { message: string; data?: unknown }): Error {
  const data = error.data as MoxxyIpcError | undefined;
  if (data && typeof data.code === 'string' && typeof data.message === 'string') {
    return new Error(encodeIpcError(data));
  }
  return new Error(error.message);
}

export class WsRpcClient {
  private socket: WebSocketLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  /** Frames buffered while the socket isn't open yet; flushed on connect. */
  private readonly outbox: string[] = [];
  private closedByUser = false;
  private reconnectTimer: number | undefined;

  constructor(
    private readonly url: string,
    private readonly ctor: WebSocketCtor,
  ) {}

  connect(): void {
    if (this.socket || this.closedByUser) return;
    const socket = new this.ctor(this.url);
    this.socket = socket;
    socket.onopen = () => {
      for (const frame of this.outbox.splice(0)) socket.send(frame);
    };
    socket.onmessage = (ev) => this.handleFrame(ev.data);
    socket.onclose = () => this.handleClose();
    socket.onerror = () => {
      // A socket error is followed by a close; let handleClose do the cleanup.
    };
  }

  /** Issue a request and await the reply. Rejects with the host's error (coded
   *  envelope when available), or when the link drops before the reply. */
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closedByUser) return Promise.reject(new Error('transport closed'));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const frame = JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) });
      if (this.socket && this.socket.readyState === WS_OPEN) this.socket.send(frame);
      else this.outbox.push(frame);
    });
  }

  /** Subscribe to a server notification channel. Returns an unsubscribe fn.
   *  Handlers persist across reconnects. */
  on(method: string, handler: (params: unknown) => void): () => void {
    let set = this.notificationHandlers.get(method);
    if (!set) {
      set = new Set();
      this.notificationHandlers.set(method, set);
    }
    set.add(handler);
    return () => {
      const s = this.notificationHandlers.get(method);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this.notificationHandlers.delete(method);
    };
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  private handleFrame(data: unknown): void {
    let frame: {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message: string; data?: unknown };
    };
    try {
      frame = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return; // drop a malformed frame
    }

    // Notification: a method with no id.
    if (typeof frame.method === 'string' && frame.id === undefined) {
      const handlers = this.notificationHandlers.get(frame.method);
      if (handlers) for (const h of handlers) {
        try {
          h(frame.params);
        } catch {
          /* a throwing handler must not kill the others */
        }
      }
      return;
    }

    // Response: an id with result/error.
    if (typeof frame.id === 'number') {
      const waiter = this.pending.get(frame.id);
      if (!waiter) return;
      this.pending.delete(frame.id);
      if (frame.error) waiter.reject(errorFromFrame(frame.error));
      else waiter.resolve(frame.result);
    }
  }

  private handleClose(): void {
    this.socket = null;
    // Fail every in-flight request so callers can retry on the next connection.
    const dropped = new Error('connection closed');
    for (const waiter of this.pending.values()) waiter.reject(dropped);
    this.pending.clear();
    if (this.closedByUser) return;
    // Reconnect; subscriptions persist so notifications resume.
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }
}
