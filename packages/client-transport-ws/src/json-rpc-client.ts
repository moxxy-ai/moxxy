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
 *
 * Disconnect semantics: when the link drops, every in-flight AND queued request
 * is rejected and the outbox is cleared — a request issued against a dead link
 * surfaces a transport error to its caller rather than silently re-executing
 * after a reconnect (re-running a non-idempotent command like `runTurn` is the
 * hazard). Reconnects back off exponentially and give up after a cap, surfacing
 * a terminal `disconnected` status via {@link WsRpcClientOptions.onStatus}.
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

export type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike;

/** Connection lifecycle as seen by the owner of the client. `disconnected` is
 *  terminal: the reconnect budget is exhausted and every further request
 *  rejects immediately (re-pair / rebuild the client to recover). */
export type WsClientStatus = 'connecting' | 'open' | 'reconnecting' | 'disconnected' | 'closed';

export interface WsRpcClientOptions {
  /** Subprotocols to request (e.g. the `moxxy.bearer.<token>` auth entry). */
  readonly protocols?: readonly string[];
  /** Reconnect attempts before giving up terminally. Default 10. */
  readonly maxReconnectAttempts?: number;
  /** Observe connection lifecycle transitions (incl. terminal `disconnected`). */
  readonly onStatus?: (status: WsClientStatus) => void;
}

const WS_OPEN = 1;
const RECONNECT_BASE_DELAY_MS = 1500;
const RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

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
  /** Frames buffered while the socket isn't open yet; flushed on connect,
   *  CLEARED on disconnect (their pendings are rejected — never replayed). */
  private readonly outbox: string[] = [];
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempts = 0;
  private currentStatus: WsClientStatus = 'connecting';
  private readonly maxReconnectAttempts: number;
  private readonly protocols: readonly string[] | undefined;
  private readonly onStatus: ((status: WsClientStatus) => void) | undefined;

  constructor(
    private readonly url: string,
    private readonly ctor: WebSocketCtor,
    opts: WsRpcClientOptions = {},
  ) {
    this.protocols = opts.protocols;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.onStatus = opts.onStatus;
  }

  /** The current lifecycle status (also pushed to `onStatus` on transitions). */
  get status(): WsClientStatus {
    return this.currentStatus;
  }

  connect(): void {
    if (this.socket || this.closedByUser || this.currentStatus === 'disconnected') return;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    const socket = this.protocols?.length
      ? new this.ctor(this.url, [...this.protocols])
      : new this.ctor(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('open');
      for (const frame of this.outbox.splice(0)) socket.send(frame);
    };
    socket.onmessage = (ev) => this.handleFrame(ev.data);
    socket.onclose = () => this.handleClose();
    socket.onerror = () => {
      // A socket error is followed by a close; let handleClose do the cleanup.
    };
  }

  /** Issue a request and await the reply. Rejects with the host's error (coded
   *  envelope when available), when the link drops before the reply, or
   *  immediately once the transport is terminally disconnected/closed. */
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closedByUser) return Promise.reject(new Error('transport closed'));
    if (this.currentStatus === 'disconnected') {
      return Promise.reject(new Error('transport disconnected'));
    }
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
    this.setStatus('closed');
  }

  private setStatus(status: WsClientStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.onStatus?.(status);
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
    // Fail every in-flight AND queued request, and drop the queued frames:
    // callers must see a transport error — replaying a queued non-idempotent
    // command (runTurn…) after reconnect would re-execute it behind their back.
    const dropped = new Error('connection closed');
    for (const waiter of this.pending.values()) waiter.reject(dropped);
    this.pending.clear();
    this.outbox.length = 0;
    if (this.closedByUser) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('disconnected');
      return;
    }
    // Surface the degraded state for the whole backoff window, not just once
    // the next attempt fires. Without this the socket is already dead yet
    // `status` (and any onStatus observer driving a connection indicator) would
    // keep reporting `open` for up to RECONNECT_MAX_DELAY_MS. The per-attempt
    // setStatus('reconnecting') in connect() is idempotent via the equality
    // guard in setStatus, so this doesn't double-fire.
    this.setStatus('reconnecting');
    // Reconnect with exponential backoff; subscriptions persist so
    // notifications resume on the next successful connection.
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }
}
