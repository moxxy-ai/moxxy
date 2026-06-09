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
import { WebSocketServer, type WebSocket, type RawData } from 'ws';

import { MOXXY_WS_SUBPROTOCOL } from '@moxxy/sdk';
import type { Transport, TransportServer } from '@moxxy/runner';
import { checkWsAuth, checkWsOrigin } from './auth.js';

const DEFAULT_MAX_CONNECTIONS = 8;
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_BUFFER_STALL_GRACE_MS = 10_000;

/**
 * The eviction policy, kept pure so it's unit-testable: report the socket's
 * pre-send backlog on every send; once the backlog has stayed above the limit
 * for the full grace window, the verdict flips to `terminate`. Draining below
 * the limit resets the clock.
 */
export class SlowReaderGuard {
  private stalledSinceMs: number | null = null;

  constructor(
    private readonly limitBytes: number = DEFAULT_MAX_BUFFERED_BYTES,
    private readonly graceMs: number = DEFAULT_BUFFER_STALL_GRACE_MS,
  ) {}

  check(bufferedAmount: number, nowMs: number): 'ok' | 'terminate' {
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
    if (this.guard.check(this.ws.bufferedAmount, Date.now()) === 'terminate') {
      console.warn(
        `[moxxy] ws bridge: evicting slow reader (${this.ws.bufferedAmount} bytes unread past grace)`,
      );
      this.ws.terminate();
      return;
    }
    this.ws.send(JSON.stringify(frame));
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
  /** Browser origins allowed to connect. Default `[]`: every upgrade carrying
   *  an `Origin` header (i.e. browser-initiated) is rejected; native clients
   *  send no Origin and are unaffected. */
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
  let connections = 0;

  const wss = new WebSocketServer({
    host,
    port: opts.port,
    maxPayload: opts.maxPayloadBytes ?? 64 * 1024 * 1024,
    verifyClient: (info: { req: IncomingMessage }) => {
      if (!checkWsOrigin(info.req, opts.allowedOrigins)) {
        console.warn(
          `[moxxy] ws bridge: rejected browser-origin upgrade (Origin: ${String(info.req.headers.origin)})`,
        );
        return false;
      }
      if (connections >= maxConnections) {
        console.warn(`[moxxy] ws bridge: rejected upgrade — connection cap (${maxConnections}) reached`);
        return false;
      }
      return checkWsAuth(info.req, currentToken, { allowQueryToken: opts.allowQueryToken });
    },
    // When the client offers subprotocols (the moxxy.bearer.* convention),
    // select the moxxy protocol WITHOUT echoing the token-bearing entry back.
    handleProtocols: (protocols: Set<string>) =>
      protocols.has(MOXXY_WS_SUBPROTOCOL) ? MOXXY_WS_SUBPROTOCOL : false,
  });

  const connectionHandlers: Array<(t: Transport) => void> = [];
  wss.on('connection', (ws: WebSocket) => {
    connections += 1;
    ws.once('close', () => {
      connections -= 1;
    });
    const transport = new WsTransport(
      ws,
      new SlowReaderGuard(opts.maxBufferedBytes, opts.bufferStallGraceMs),
    );
    for (const handler of connectionHandlers) handler(transport);
  });

  await new Promise<void>((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', resolve);
  });

  // Report the ACTUAL bound port — `opts.port` may be 0 (ephemeral).
  const bound = wss.address();
  const boundPort = typeof bound === 'object' && bound !== null ? bound.port : opts.port;

  return {
    address: `ws://${host}:${boundPort}`,
    onConnection(handler: (t: Transport) => void): void {
      connectionHandlers.push(handler);
    },
    rotateAuthToken(next: string): void {
      currentToken = next;
      for (const client of wss.clients) client.terminate();
    },
    close(): Promise<void> {
      // `wss.close` only stops the listener; it waits for clients to leave on
      // their own. Quit is quit — terminate them so close resolves promptly
      // instead of burning the host's shutdown timeout.
      return new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      });
    },
  };
}
