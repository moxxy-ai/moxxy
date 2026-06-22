import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  base64urlDecode,
  base64urlEncode,
  connectInitiator,
  fingerprint,
  generateIdentity,
  publicKeyFromFingerprint,
  utf8,
  utf8Decode,
  type MessageTransport,
  type SecureChannel,
} from '@moxxy/e2e';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { startE2EShim, type E2EShimHandle } from './e2e-shim.js';

/**
 * The agent shim terminates the phone's encrypted channel before forwarding to
 * the loopback bridge. The wire frames ride as base64url TEXT because iOS React
 * Native's WebSocket silently drops binary frames — a binary ClientHello never
 * reaches the shim and the handshake hangs ("transport closed during
 * handshake"). These tests drive the shim from the phone side over a real `ws`
 * connection to prove the text path works (and that a binary peer still
 * interoperates).
 */
const TOKEN = 'shim-test-token';

/** A dummy mobile bridge: checks the bearer header and echoes each text frame. */
async function startBridge(): Promise<{
  port: number;
  lastAuth: () => string | undefined;
  close: () => Promise<void>;
}> {
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  let lastAuth: string | undefined;
  wss.on('connection', (ws, req) => {
    lastAuth = req.headers['authorization'];
    ws.on('message', (d: RawData) => ws.send(`echo:${d.toString()}`));
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  return {
    port: (http.address() as AddressInfo).port,
    lastAuth: () => lastAuth,
    close: () =>
      new Promise<void>((r) => {
        for (const c of wss.clients) c.terminate();
        http.close(() => r());
      }),
  };
}

/**
 * Drive the shim from the phone side over a real `ws` connection. `mode` selects
 * the outbound framing: `text` mirrors iOS RN (base64url text), `binary` proves
 * the shim still accepts a binary-capable peer (e.g. a Node `ws` client). The
 * shim always replies with TEXT, so inbound decoding handles both.
 */
function phoneTransport(ws: WebSocket, mode: 'text' | 'binary'): MessageTransport {
  let onMsg: ((b: Uint8Array) => void) | null = null;
  let onClose: (() => void) | null = null;
  const backlog: Uint8Array[] = [];
  ws.on('message', (data: RawData, isBinary: boolean) => {
    const buf = data as Buffer;
    const bytes = isBinary ? new Uint8Array(buf) : base64urlDecode(buf.toString('utf8'));
    if (onMsg) onMsg(bytes);
    else backlog.push(bytes);
  });
  ws.on('close', () => onClose?.());
  ws.on('error', () => onClose?.());
  return {
    send: (bytes) => {
      if (ws.readyState !== ws.OPEN) return;
      if (mode === 'text') ws.send(base64urlEncode(bytes));
      else ws.send(Buffer.from(bytes), { binary: true });
    },
    onMessage: (h) => {
      onMsg = h;
      while (backlog.length > 0) h(backlog.shift() as Uint8Array);
    },
    onClose: (h) => {
      onClose = h;
    },
    close: () => ws.close(),
  };
}

async function dialPhone(
  shim: E2EShimHandle,
  fp: string,
  mode: 'text' | 'binary',
): Promise<SecureChannel> {
  const ws = new WebSocket(`ws://127.0.0.1:${shim.port}`);
  await once(ws, 'open');
  return connectInitiator(phoneTransport(ws, mode), publicKeyFromFingerprint(fp));
}

describe('E2E shim wire framing', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c().catch(() => undefined);
  });

  async function setup(): Promise<{
    bridge: Awaited<ReturnType<typeof startBridge>>;
    shim: E2EShimHandle;
    fp: string;
  }> {
    const bridge = await startBridge();
    const identity = generateIdentity();
    const shim = await startE2EShim({
      identity,
      token: TOKEN,
      bridgePort: bridge.port,
      bridgeHost: '127.0.0.1',
    });
    cleanups.push(() => shim.close(), bridge.close);
    return { bridge, shim, fp: fingerprint(identity.publicKey) };
  }

  it('handshakes and round-trips when the phone can only send TEXT frames (iOS RN)', async () => {
    const { bridge, shim, fp } = await setup();
    const channel = await dialPhone(shim, fp, 'text');
    const echoed = new Promise<string>((resolve) => channel.onMessage((pt) => resolve(utf8Decode(pt))));
    channel.send(utf8(TOKEN)); // first ENCRYPTED frame is the bearer
    channel.send(utf8('{"id":1,"method":"ping"}'));
    expect(await echoed).toBe('echo:{"id":1,"method":"ping"}');
    expect(bridge.lastAuth()).toBe(`Bearer ${TOKEN}`); // bearer reached the bridge, never the wire
  });

  it('also accepts a binary-sending peer (a Node ws client interoperates)', async () => {
    const { shim, fp } = await setup();
    const channel = await dialPhone(shim, fp, 'binary');
    const echoed = new Promise<string>((resolve) => channel.onMessage((pt) => resolve(utf8Decode(pt))));
    channel.send(utf8(TOKEN));
    channel.send(utf8('{"ok":true}'));
    expect(await echoed).toBe('echo:{"ok":true}');
  });

  it('closes the channel on a bad bearer without crashing', async () => {
    const { shim, fp } = await setup();
    const channel = await dialPhone(shim, fp, 'text');
    const closed = new Promise<void>((resolve) => channel.onClose(() => resolve()));
    channel.send(utf8('wrong-token'));
    await closed; // the shim tears the channel down after a bad bearer
  });
});
