/**
 * WebSocket implementation of the runner's {@link Transport} / {@link
 * TransportServer} — the network mirror of `createUnixSocketServer`. `ws`
 * already frames each message as one complete payload, so a frame is just one
 * JSON value: parse on the way in, stringify on the way out. Auth is enforced at
 * the HTTP upgrade handshake (`verifyClient`) so an unauthenticated client never
 * even opens a socket.
 */

import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';

import type { Transport, TransportServer } from '@moxxy/runner';
import { checkWsAuth } from './auth.js';

/** Adapts a single `ws` socket to the runner's frame-oriented `Transport`. */
class WsTransport implements Transport {
  private frameHandler: ((frame: unknown) => void) | null = null;
  private closeHandler: ((err?: Error) => void) | null = null;
  private closeEmitted = false;

  constructor(private readonly ws: WebSocket) {
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
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(frame));
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
  /** TCP port to listen on. */
  readonly port: number;
  /** Bind address. Defaults to loopback (`127.0.0.1`); set `0.0.0.0` to expose
   *  on the LAN (still token-gated; prefer a tunnel for off-network access). */
  readonly host?: string;
  /** Shared secret required at the handshake. REQUIRED — an empty token throws,
   *  because this surface is reachable off-process. */
  readonly authToken: string;
  /** Max bytes per frame. Defaults to 64 MB to cover the base64 audio cap. */
  readonly maxPayloadBytes?: number;
}

export async function createWebSocketTransportServer(
  opts: WebSocketBridgeOptions,
): Promise<TransportServer> {
  if (!opts.authToken) {
    throw new Error(
      'createWebSocketTransportServer: authToken is required — this surface is network-reachable',
    );
  }
  const host = opts.host ?? '127.0.0.1';
  const wss = new WebSocketServer({
    host,
    port: opts.port,
    maxPayload: opts.maxPayloadBytes ?? 64 * 1024 * 1024,
    verifyClient: (info: { req: IncomingMessage }) => checkWsAuth(info.req, opts.authToken),
  });

  const connectionHandlers: Array<(t: Transport) => void> = [];
  wss.on('connection', (ws: WebSocket) => {
    const transport = new WsTransport(ws);
    for (const handler of connectionHandlers) handler(transport);
  });

  await new Promise<void>((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', resolve);
  });

  return {
    address: `ws://${host}:${opts.port}`,
    onConnection(handler: (t: Transport) => void): void {
      connectionHandlers.push(handler);
    },
    close(): Promise<void> {
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
