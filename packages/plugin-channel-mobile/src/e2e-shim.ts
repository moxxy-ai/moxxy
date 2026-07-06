/**
 * The mobile-only E2E shim — the agent end of the encrypted channel.
 *
 * The proxy tunnel points at this shim (loopback) instead of the bridge. For
 * each inbound phone connection it:
 *   1. runs the `@moxxy/e2e` handshake as the responder (its static key is the
 *      one the phone pinned from the QR fingerprint);
 *   2. reads the bearer token from the first ENCRYPTED frame and checks it
 *      (constant-time) — so the token never appears on the wire to the relay;
 *   3. opens a plaintext WebSocket to the local bridge (Authorization: Bearer,
 *      over loopback) and proxies decrypted frames in both directions.
 *
 * The generic proxy provider stays a dumb byte pipe and `@moxxy/ipc-server-ws`
 * is untouched — E2E lives entirely here and in the phone client.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { bearerTokenMatches } from '@moxxy/sdk/server';
import {
  base64urlDecode,
  base64urlEncode,
  connectResponder,
  type Identity,
  type MessageTransport,
  type SecureChannel,
} from '@moxxy/e2e';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

export interface E2EShimOptions {
  /** Agent identity (responder). Its public key is what the phone pins. */
  readonly identity: Identity;
  /** Expected bearer token (the phone proves knowledge of it, encrypted). */
  readonly token: string;
  /** Local plaintext bridge to proxy authenticated traffic to. */
  readonly bridgePort: number;
  readonly bridgeHost?: string;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface E2EShimHandle {
  /** Loopback port the tunnel should forward to. */
  readonly port: number;
  close(): Promise<void>;
}

const decoder = new TextDecoder();

function rawToBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(0);
}

/** A `@moxxy/e2e` MessageTransport over a server-side `ws` WebSocket. */
function wsTransport(ws: WebSocket): MessageTransport {
  let onMsg: ((b: Uint8Array) => void) | null = null;
  let onClose: (() => void) | null = null;
  const backlog: Uint8Array[] = [];
  ws.on('message', (data, isBinary) => {
    // Frames ride as base64url TEXT so iOS React Native can deliver them (its
    // WebSocket silently drops binary frames). A binary-capable peer that still
    // sends binary (a Node `ws` client) is accepted unchanged.
    let bytes: Uint8Array;
    try {
      bytes = isBinary ? rawToBytes(data) : base64urlDecode(rawTextOf(data));
    } catch {
      return; // undecodable frame — drop it (the handshake/opener handles silence)
    }
    if (onMsg) onMsg(bytes);
    else backlog.push(bytes);
  });
  ws.on('close', () => onClose?.());
  ws.on('error', () => onClose?.());
  return {
    send: (bytes) => {
      // Text frame (base64url) — see the inbound note above.
      if (ws.readyState === ws.OPEN) ws.send(base64urlEncode(bytes));
    },
    onMessage: (handler) => {
      onMsg = handler;
      while (backlog.length > 0) handler(backlog.shift() as Uint8Array);
    },
    onClose: (handler) => {
      onClose = handler;
    },
    close: () => ws.close(),
  };
}

export async function startE2EShim(opts: E2EShimOptions): Promise<E2EShimHandle> {
  const bridgeHost = opts.bridgeHost ?? '127.0.0.1';
  const http = createServer();
  const wss = new WebSocketServer({ server: http });

  wss.on('connection', (phone) => {
    void handlePhone(phone, opts, bridgeHost).catch((err) => {
      const logger = opts.logger;
      if (logger?.warn) logger.warn('e2e shim: connection failed', { err: String(err) });
      try {
        phone.close();
      } catch {
        /* ignore */
      }
    });
  });

  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  const logger = opts.logger;
  if (logger?.info) logger.info('e2e shim listening', { port });

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        http.close(() => resolve());
      }),
  };
}

async function handlePhone(
  phone: WebSocket,
  opts: E2EShimOptions,
  bridgeHost: string,
): Promise<void> {
  const channel: SecureChannel = await connectResponder(wsTransport(phone), opts.identity);

  let authed = false;
  let bridge: WebSocket | null = null;
  let bridgeOpen = false;
  const toBridge: string[] = [];

  const teardown = (): void => {
    try {
      channel.close();
    } catch {
      /* ignore */
    }
    try {
      bridge?.close();
    } catch {
      /* ignore */
    }
  };

  channel.onClose(teardown);
  channel.onMessage((pt) => {
    const text = decoder.decode(pt);
    if (!authed) {
      authed = true;
      if (!bearerTokenMatches(text, opts.token)) {
        const logger = opts.logger;
        if (logger?.warn) logger.warn('e2e shim: bad token, closing');
        teardown();
        return;
      }
      bridge = openBridge(opts, bridgeHost, channel, () => {
        bridgeOpen = true;
        for (const f of toBridge.splice(0)) bridge?.send(f);
      }, teardown);
      return;
    }
    // Subsequent frames are JSON-RPC for the bridge.
    if (bridgeOpen && bridge) bridge.send(text);
    else toBridge.push(text);
  });
}

function openBridge(
  opts: E2EShimOptions,
  bridgeHost: string,
  channel: SecureChannel,
  onOpen: () => void,
  onClose: () => void,
): WebSocket {
  const encoder = new TextEncoder();
  // Node `ws` client → present the token via the Authorization header (loopback).
  const bridge = new WebSocket(`ws://${bridgeHost}:${opts.bridgePort}`, {
    headers: { authorization: `Bearer ${opts.token}` },
  });
  bridge.on('open', onOpen);
  bridge.on('message', (data) => {
    // The bridge speaks JSON text frames; forward them sealed to the phone.
    channel.send(encoder.encode(rawTextOf(data)));
  });
  bridge.on('close', onClose);
  bridge.on('error', onClose);
  return bridge;
}

function rawTextOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data);
}
