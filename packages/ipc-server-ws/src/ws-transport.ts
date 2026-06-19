/**
 * WebSocket implementation of the runner's {@link Transport} / {@link
 * TransportServer} — the network mirror of `createUnixSocketServer`. `ws`
 * already frames each message as one complete payload, so a frame is just one
 * JSON value: parse on the way in, stringify on the way out. Auth + Origin +
 * connection-cap checks are enforced at the HTTP upgrade handshake
 * (`verifyClient`) so a rejected client never even opens a socket.
 *
 * Backpressure policy (slow-reader eviction): `ws.send` buffers unboundedly
 * for a peer that stops reading, so every outbound frame first consults a
 * {@link SlowReaderGuard} — a connection whose send backlog stays above
 * `maxBufferedBytes` for longer than a short grace window is terminated (the
 * client reconnects and resyncs; an evicted reader has missed frames anyway).
 * The grace window exists so one legitimately large frame (payloads may reach
 * the 64 MB cap) in flight to a healthy reader doesn't trip the guard.
 */

import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';

import { MOXXY_WS_SUBPROTOCOL } from '@moxxy/sdk/server';
import type { Transport, TransportServer } from '@moxxy/runner';
import { checkWsAuth, checkWsOrigin } from './auth.js';

const DEFAULT_MAX_CONNECTIONS = 8;
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_BUFFER_STALL_GRACE_MS = 10_000;
/** How long a `verifyClient` slot reservation may sit unclaimed before it is
 *  reconciled (released). `ws.completeUpgrade` can bail AFTER `verifyClient`
 *  passes — a peer that FIN'd mid-handshake, or a server mid-close — without
 *  ever emitting `'connection'`; without this fallback those reservations would
 *  leak monotonically and permanently brick the connection cap. */
const RESERVATION_RECONCILE_MS = 10_000;
/** Hard ceiling above which a slow reader is evicted immediately, regardless of
 *  the grace window — bounds a peer that perpetually rides just over the soft
 *  limit (resetting the grace clock each drain) from pinning memory forever. */
const SLOW_READER_HARD_MULTIPLIER = 4;
/** Cap on the length of an attacker-controlled value written to the host log. */
const MAX_LOGGED_ORIGIN_LEN = 128;

/**
 * Make an untrusted header value safe to log: bound its length and drop control
 * characters (newlines/escapes) so a flood of crafted-Origin upgrades can't
 * inject into or balloon the host's logs.
 */
function sanitizeForLog(value: unknown): string {
  let out = '';
  for (const ch of String(value ?? '')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
    if (out.length >= MAX_LOGGED_ORIGIN_LEN) break;
  }
  return out;
}

/**
 * The eviction policy, kept pure so it's unit-testable: report the socket's
 * pre-send backlog on every send; once the backlog has stayed above the limit
 * for the full grace window, the verdict flips to `terminate`. Draining below
 * the limit resets the clock.
 */
export class SlowReaderGuard {
  private stalledSinceMs: number | null = null;
  private readonly hardLimitBytes: number;

  constructor(
    private readonly limitBytes: number = DEFAULT_MAX_BUFFERED_BYTES,
    private readonly graceMs: number = DEFAULT_BUFFER_STALL_GRACE_MS,
  ) {
    this.hardLimitBytes = limitBytes * SLOW_READER_HARD_MULTIPLIER;
  }

  check(bufferedAmount: number, nowMs: number): 'ok' | 'terminate' {
    // A peer that perpetually hovers just over the soft limit resets the grace
    // clock on every transient drain and could otherwise sustain ~limit bytes of
    // backlog indefinitely. A hard ceiling well above the limit evicts it at
    // once, regardless of grace, so the memory bound actually holds.
    if (bufferedAmount > this.hardLimitBytes) return 'terminate';
    if (bufferedAmount <= this.limitBytes) {
      this.stalledSinceMs = null;
      return 'ok';
    }
    if (this.stalledSinceMs === null) {
      this.stalledSinceMs = nowMs;
      return 'ok';
    }
    return nowMs - this.stalledSinceMs >= this.graceMs ? 'terminate' : 'ok';
  }
}

/** Adapts a single `ws` socket to the runner's frame-oriented `Transport`. */
class WsTransport implements Transport {
  private frameHandler: ((frame: unknown) => void) | null = null;
  private closeHandler: ((err?: Error) => void) | null = null;
  private closeEmitted = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly guard: SlowReaderGuard,
  ) {
    ws.on('message', (data: RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof data === 'string' ? data : data.toString());
      } catch {
        return; // drop a malformed frame rather than killing the peer
      }
      this.frameHandler?.(parsed);
    });
    ws.on('close', () => this.emitClose());
    ws.on('error', (err: Error) => this.emitClose(err));
  }

  send(frame: unknown): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    if (this.evictIfStalled()) return;
    // NOTE: `JSON.stringify` throws synchronously on a BigInt/circular frame. We
    // deliberately let that throw propagate to the caller rather than swallow it
    // here: on the request/response path `JsonRpcPeer.dispatchRequest` catches it
    // and converts it into an error reply (so the requester is answered, not left
    // hanging), and on the broadcast/notify fan-out `WebSocketCommandBus.broadcast`
    // already wraps each `notify` so one bad payload can't abort delivery to the
    // rest. Swallowing here would break the response path (silent no-reply).
    this.ws.send(JSON.stringify(frame));
  }

  /**
   * Re-consult the slow-reader guard out of band (a periodic sweep), so a peer
   * that stalls with a large backlog and then goes idle — no further sends to
   * re-trigger the per-send check — is still evicted instead of pinning its
   * multi-megabyte buffer for the connection's lifetime.
   */
  checkBackpressure(): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.evictIfStalled();
  }

  /** Returns true and terminates the socket if the guard's verdict is to evict. */
  private evictIfStalled(): boolean {
    if (this.guard.check(this.ws.bufferedAmount, Date.now()) !== 'terminate') return false;
    console.warn(
      `[moxxy] ws bridge: evicting slow reader (${this.ws.bufferedAmount} bytes unread past grace)`,
    );
    // Eviction is intentionally lossy for the dropped frame — including a
    // JSON-RPC RESPONSE frame. `send` returns no failure signal, but
    // `terminate()` fires the socket's `'close'`, which flows through
    // `emitClose` → `onClose`; the peer (JsonRpcPeer) rejects every pending
    // request on close, so a caller awaiting the dropped response is recovered
    // via that close + reconnect rather than left dangling. Do not assume
    // `send` reliably delivers responses.
    this.ws.terminate();
    return true;
  }

  onFrame(handler: (frame: unknown) => void): void {
    this.frameHandler = handler;
  }

  onClose(handler: (err?: Error) => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.ws.close();
  }

  private emitClose(err?: Error): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.closeHandler?.(err);
  }
}

export interface WebSocketBridgeOptions {
  /** TCP port to listen on (`0` binds an ephemeral port — `address` reports
   *  the actual bound one). */
  readonly port: number;
  /** Bind address. Defaults to loopback (`127.0.0.1`); set `0.0.0.0` to expose
   *  on the LAN (still token-gated; prefer a tunnel for off-network access). */
  readonly host?: string;
  /** Shared secret required at the handshake. REQUIRED — an empty token throws,
   *  because this surface is reachable off-process. */
  readonly authToken: string;
  /** Accept the legacy `?t=<token>` query credential. Default false — the token
   *  belongs in the `Authorization` header or the `Sec-WebSocket-Protocol`
   *  bearer entry, never the URL. */
  readonly allowQueryToken?: boolean;
  /** Origins allowed to connect. Default `[]`: every upgrade carrying an
   *  `Origin` header is rejected. Browsers always send one — but so does iOS
   *  React Native (SocketRocket derives it from the WS URL: ws→http,
   *  wss→https), so a bridge that real devices pair with must allow-list the
   *  origins of every URL it advertises. Origins learned only after start
   *  (a tunnel URL) go in via {@link WebSocketBridgeServer.setAllowedOrigins}. */
  readonly allowedOrigins?: readonly string[];
  /** Max concurrent connections (default 8); excess upgrades are rejected. */
  readonly maxConnections?: number;
  /** Slow-reader eviction threshold for the per-socket send backlog
   *  (default 4 MB — see {@link SlowReaderGuard}). */
  readonly maxBufferedBytes?: number;
  /** How long the backlog may stay above the threshold before eviction
   *  (default 10s). */
  readonly bufferStallGraceMs?: number;
  /** Max bytes per frame. Defaults to 64 MB to cover the base64 audio cap. */
  readonly maxPayloadBytes?: number;
}

export interface WebSocketBridgeServer extends TransportServer {
  /**
   * Rotate the pairing credential on the LIVE server: new handshakes must
   * present `next`, and every currently-connected client is terminated so a
   * leaked old token can't keep an established session alive. Callers should
   * persist `next` first (e.g. `rotateChannelToken` in `@moxxy/sdk`).
   */
  rotateAuthToken(next: string): void;
  /**
   * Replace the Origin allow-list on the LIVE server. Needed because some
   * allowed origins are only known after the listener is up — a tunnel
   * (cloudflared/ngrok) URL is assigned once the tunnel opens, and iOS React
   * Native clients present that URL's https origin at the upgrade. Affects
   * future handshakes only; established connections stay up (unlike
   * `rotateAuthToken`, nothing is being revoked on the additive path).
   */
  setAllowedOrigins(origins: readonly string[]): void;
  /** Number of clients currently connected — surfaced so a pairing UI (the
   *  desktop's Settings → Mobile tab) can show "1 device connected". */
  clientCount(): number;
}

export async function createWebSocketTransportServer(
  opts: WebSocketBridgeOptions,
): Promise<WebSocketBridgeServer> {
  if (!opts.authToken) {
    throw new Error(
      'createWebSocketTransportServer: authToken is required — this surface is network-reachable',
    );
  }
  const host = opts.host ?? '127.0.0.1';
  const maxConnections = opts.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  let currentToken = opts.authToken;
  let currentAllowedOrigins: readonly string[] = opts.allowedOrigins ?? [];
  // `connections` counts ESTABLISHED sockets; `reservations` holds one entry per
  // upgrade that passed `verifyClient` (the authoritative admission gate) but
  // hasn't yet reached the `'connection'` event, keyed by the underlying TCP
  // socket so the right slot is released. The cap is checked against the SUM so
  // two near-simultaneous handshakes can't both slip through reading the same
  // pre-increment count — otherwise the live total transiently exceeds the cap.
  //
  // The reservation MUST self-heal: `ws.completeUpgrade` can bail AFTER
  // `verifyClient` passes (peer FIN'd mid-handshake, or the server is mid-close)
  // WITHOUT ever emitting `'connection'`. We release immediately on the socket's
  // own `'close'` (so an aborted handshake frees its slot at once), and arm a
  // bounded timer as a backstop in case that event is somehow missed — without
  // this a leaked reservation would monotonically brick the connection cap.
  let connections = 0;
  const reservations = new Map<Socket, { timer: ReturnType<typeof setTimeout> }>();
  const releaseReservation = (socket: Socket): void => {
    const entry = reservations.get(socket);
    if (!entry) return;
    clearTimeout(entry.timer);
    reservations.delete(socket);
  };
  const liveTransports = new Set<WsTransport>();

  const wss = new WebSocketServer({
    host,
    port: opts.port,
    maxPayload: opts.maxPayloadBytes ?? 64 * 1024 * 1024,
    verifyClient: (info: { req: IncomingMessage }) => {
      if (!checkWsOrigin(info.req, currentAllowedOrigins)) {
        // The Origin header is unbounded and fully attacker-controlled; truncate
        // and strip control chars so a crafted-Origin upgrade flood can't write
        // huge/injected strings into the host's logs (log injection/amplification).
        console.warn(
          `[moxxy] ws bridge: rejected browser-origin upgrade (Origin: ${sanitizeForLog(info.req.headers.origin)})`,
        );
        return false;
      }
      if (connections + reservations.size >= maxConnections) {
        console.warn(`[moxxy] ws bridge: rejected upgrade — connection cap (${maxConnections}) reached`);
        return false;
      }
      const ok = checkWsAuth(info.req, currentToken, { allowQueryToken: opts.allowQueryToken });
      // Reserve the slot at the moment of admission so a concurrent upgrade sees
      // it taken. The reservation is converted to an established connection in
      // the `'connection'` handler (which releases it); a reservation whose
      // handshake aborts is released on the socket's `'close'`, with a timer as
      // a backstop. Key by the TCP socket so each path releases the right slot.
      if (ok) {
        const socket = info.req.socket;
        releaseReservation(socket); // defensive: never double-reserve one socket
        const timer = setTimeout(() => releaseReservation(socket), RESERVATION_RECONCILE_MS);
        if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
        reservations.set(socket, { timer });
        socket.once('close', () => releaseReservation(socket));
      }
      return ok;
    },
    // When the client offers subprotocols (the moxxy.bearer.* convention),
    // select the moxxy protocol WITHOUT echoing the token-bearing entry back.
    handleProtocols: (protocols: Set<string>) =>
      protocols.has(MOXXY_WS_SUBPROTOCOL) ? MOXXY_WS_SUBPROTOCOL : false,
  });

  const connectionHandlers: Array<(t: Transport) => void> = [];
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Convert this socket's verifyClient reservation into an established
    // connection (releasing it so its backstop timer can't fire).
    releaseReservation(req.socket);
    connections += 1;
    const transport = new WsTransport(
      ws,
      new SlowReaderGuard(opts.maxBufferedBytes, opts.bufferStallGraceMs),
    );
    liveTransports.add(transport);
    ws.once('close', () => {
      connections -= 1;
      liveTransports.delete(transport);
    });
    for (const handler of connectionHandlers) handler(transport);
  });

  await new Promise<void>((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', resolve);
  });

  // Report the ACTUAL bound port — `opts.port` may be 0 (ephemeral). A
  // non-object address after a successful `'listening'` is unreachable in
  // practice, but falling back to `opts.port` (possibly 0) would silently
  // advertise an unusable `ws://host:0` connect target — fail loudly instead.
  const bound = wss.address();
  if (typeof bound !== 'object' || bound === null || typeof bound.port !== 'number') {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    throw new Error('createWebSocketTransportServer: could not determine bound port');
  }
  const boundPort = bound.port;

  // After startup, a server-level error (EMFILE/ENFILE on accept under fd
  // exhaustion, an underlying socket error surfaced to the WSS) must NOT become
  // an uncaught exception — Node throws on an `'error'` event with no listener,
  // which would take down the whole host for an optional surface.
  wss.on('error', (err: Error) => {
    console.error('[moxxy] ws bridge: server error', err);
  });

  // Drive slow-reader eviction independently of send cadence: a peer that stalls
  // with a large backlog and then goes idle would never re-trigger the per-send
  // check and would pin its buffer for the connection's lifetime.
  const graceMs = opts.bufferStallGraceMs ?? DEFAULT_BUFFER_STALL_GRACE_MS;
  const sweep = setInterval(
    () => {
      for (const transport of liveTransports) transport.checkBackpressure();
    },
    Math.max(1000, Math.floor(graceMs / 2)),
  );
  if (typeof sweep === 'object' && typeof sweep.unref === 'function') sweep.unref();

  return {
    address: `ws://${host}:${boundPort}`,
    onConnection(handler: (t: Transport) => void): void {
      connectionHandlers.push(handler);
    },
    rotateAuthToken(next: string): void {
      currentToken = next;
      for (const client of wss.clients) client.terminate();
    },
    setAllowedOrigins(origins: readonly string[]): void {
      currentAllowedOrigins = [...origins];
    },
    clientCount(): number {
      return connections;
    },
    close(): Promise<void> {
      // `wss.close` only stops the listener; it waits for clients to leave on
      // their own. Quit is quit — terminate them so close resolves promptly
      // instead of burning the host's shutdown timeout.
      clearInterval(sweep);
      for (const { timer } of reservations.values()) clearTimeout(timer);
      reservations.clear();
      return new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      });
    },
  };
}
