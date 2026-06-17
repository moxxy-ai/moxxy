import { once } from 'node:events';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  base64urlDecode,
  base64urlEncode,
  deriveUuid,
  publicKeyFromFingerprint,
  verify,
} from '@moxxy/e2e';
import { WebSocketServer, type WebSocket } from 'ws';
import { createProxyTunnel } from './provider.js';
import { encodeJson, PROXY_PROTOCOL_VERSION } from './protocol.js';

/**
 * A minimal in-process stand-in for the relay: a `ws` server that runs the
 * challenge/register handshake on `/control` and matches `/data` attaches by
 * connId. `uuidOverride` lets a test play a hostile/buggy relay.
 */
class MockRelay {
  private wss!: WebSocketServer;
  private control: WebSocket | null = null;
  private readonly pendingData = new Map<string, (ws: WebSocket) => void>();
  lastPubkey: Uint8Array | null = null;
  port = 0;

  constructor(private readonly opts: { uuidOverride?: string } = {}) {}

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(this.wss, 'listening');
    this.port = (this.wss.address() as AddressInfo).port;
    this.wss.on('connection', (ws, req) => {
      if (req.url?.startsWith('/control')) this.onControl(ws);
      else if (req.url?.startsWith('/data')) this.onData(ws);
      else ws.close();
    });
  }

  get url(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  private onControl(ws: WebSocket): void {
    this.control = ws;
    const nonce = new Uint8Array(16).map((_, i) => (i * 31 + 7) & 0xff);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as {
        t: string;
        pubkey?: string;
        sig?: string;
      };
      if (msg.t === 'register' && msg.pubkey && msg.sig) {
        const pubkey = base64urlDecode(msg.pubkey);
        const sig = base64urlDecode(msg.sig);
        this.lastPubkey = pubkey;
        if (!verify(sig, nonce, pubkey)) {
          ws.send(encodeJson({ t: 'error', message: 'bad signature' }));
          ws.close();
          return;
        }
        const uuid = this.opts.uuidOverride ?? deriveUuid(pubkey);
        ws.send(encodeJson({ t: 'registered', uuid, host: 'proxy.test' }));
      }
    });
    ws.send(encodeJson({ t: 'challenge', v: PROXY_PROTOCOL_VERSION, nonce: base64urlEncode(nonce) }));
  }

  private onData(ws: WebSocket): void {
    ws.once('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { t: string; connId?: string };
      if (msg.t === 'attach' && msg.connId) {
        const waiter = this.pendingData.get(msg.connId);
        this.pendingData.delete(msg.connId);
        waiter?.(ws);
      }
    });
  }

  /** Signal a new inbound connection and resolve with its attached data WS. */
  openConn(connId: string, target = ''): Promise<WebSocket> {
    const attached = new Promise<WebSocket>((resolve) => this.pendingData.set(connId, resolve));
    this.control?.send(encodeJson({ t: 'open', connId, target }));
    return attached;
  }

  async stop(): Promise<void> {
    this.wss.close();
    await once(this.wss, 'close').catch(() => undefined);
  }
}

/** A loopback TCP echo server standing in for the local bridge/shim. */
function startEchoServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const sockets = new Set<Socket>();
    const server: Server = createServer((socket) => {
      sockets.add(socket);
      socket.on('data', (b) => socket.write(b));
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((res) => {
            for (const s of sockets) s.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

describe('proxy provider', () => {
  let relay: MockRelay;
  let echo: { port: number; close: () => Promise<void> };
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'proxy-prov-'));
    echo = await startEchoServer();
  });
  afterEach(async () => {
    await relay?.stop();
    await echo.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('registers via key proof-of-possession and returns the derived url', async () => {
    relay = new MockRelay();
    await relay.start();
    const provider = createProxyTunnel({
      baseHost: 'proxy.test',
      controlUrl: relay.url,
      identityPath: join(dir, 'id.key'),
    });

    const handle = await provider.open({ port: echo.port, host: '127.0.0.1' });
    expect(relay.lastPubkey).not.toBeNull();
    const expectedUuid = deriveUuid(relay.lastPubkey as Uint8Array);
    expect(handle.url).toBe(`https://${expectedUuid}.proxy.test`);
    await handle.close();
  });

  it('pipes inbound bytes to the local port and back', async () => {
    relay = new MockRelay();
    await relay.start();
    const provider = createProxyTunnel({
      baseHost: 'proxy.test',
      controlUrl: relay.url,
      identityPath: join(dir, 'id.key'),
    });
    const handle = await provider.open({ port: echo.port, host: '127.0.0.1' });

    const dataWs = await relay.openConn('conn-1');
    const echoed = once(dataWs, 'message');
    dataWs.send(Buffer.from('ping-through-tunnel'), { binary: true });

    const [data] = (await echoed) as [Buffer];
    expect(data.toString()).toBe('ping-through-tunnel');
    await handle.close();
  });

  it('rejects when the relay returns the wrong uuid (hostile/buggy relay)', async () => {
    relay = new MockRelay({ uuidOverride: 'aaaaaaaaaaaaaaaa' });
    await relay.start();
    const provider = createProxyTunnel({
      baseHost: 'proxy.test',
      controlUrl: relay.url,
      identityPath: join(dir, 'id.key'),
    });
    await expect(provider.open({ port: echo.port, host: '127.0.0.1' })).rejects.toThrow(
      /expected/,
    );
  });

  it('signs the real challenge so a tampered key would fail verification', async () => {
    relay = new MockRelay();
    await relay.start();
    const provider = createProxyTunnel({
      baseHost: 'proxy.test',
      controlUrl: relay.url,
      identityPath: join(dir, 'id.key'),
    });
    const handle = await provider.open({ port: echo.port, host: '127.0.0.1' });
    // The fingerprint embedded in the url derives from the same key the relay verified.
    const uuid = deriveUuid(relay.lastPubkey as Uint8Array);
    expect(handle.url).toContain(uuid);
    // Sanity: the relay-verified pubkey round-trips through the fingerprint codec.
    expect([...publicKeyFromFingerprint(base64urlEncode(relay.lastPubkey as Uint8Array))]).toEqual([
      ...(relay.lastPubkey as Uint8Array),
    ]);
    await handle.close();
  });
});
