import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { encodeWsBearerProtocol, MOXXY_WS_SUBPROTOCOL } from '@moxxy/sdk';
import {
  createWebSocketTransportServer,
  SlowReaderGuard,
  type WebSocketBridgeServer,
  type WebSocketBridgeOptions,
} from './ws-transport.js';

const TOKEN = 'integration-test-token';

const servers: WebSocketBridgeServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function startServer(
  opts: Partial<WebSocketBridgeOptions> = {},
): Promise<WebSocketBridgeServer> {
  const server = await createWebSocketTransportServer({ port: 0, authToken: TOKEN, ...opts });
  servers.push(server);
  return server;
}

/** Connect a raw ws client; resolves on open, rejects on a refused handshake. */
function connect(
  url: string,
  opts: { headers?: Record<string, string>; origin?: string; protocols?: string[] } = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts.protocols, {
      headers: opts.headers,
      origin: opts.origin,
    });
    sockets.push(ws);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`handshake rejected: ${res.statusCode}`)),
    );
  });
}

const bearerHeaders = { authorization: `Bearer ${TOKEN}` };

describe('createWebSocketTransportServer', () => {
  it('reports the ACTUAL bound port when asked for an ephemeral one', async () => {
    const server = await startServer();
    expect(server.address).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    expect(server.address.endsWith(':0')).toBe(false);
    // The reported address must actually accept a connection.
    await expect(connect(server.address, { headers: bearerHeaders })).resolves.toBeDefined();
  });

  it('accepts an Authorization: Bearer handshake', async () => {
    const server = await startServer();
    await expect(connect(server.address, { headers: bearerHeaders })).resolves.toBeDefined();
  });

  it('accepts the Sec-WebSocket-Protocol bearer entry and selects moxxy.v1', async () => {
    const server = await startServer();
    const ws = await connect(server.address, {
      protocols: [MOXXY_WS_SUBPROTOCOL, encodeWsBearerProtocol(TOKEN)],
    });
    expect(ws.protocol).toBe(MOXXY_WS_SUBPROTOCOL);
  });

  it('rejects a ?t= query token by default, accepts it when enabled', async () => {
    const server = await startServer();
    await expect(connect(`${server.address}/?t=${TOKEN}`)).rejects.toThrow();

    const legacy = await startServer({ allowQueryToken: true });
    await expect(connect(`${legacy.address}/?t=${TOKEN}`)).resolves.toBeDefined();
  });

  it('rejects an authenticated upgrade that carries a browser Origin', async () => {
    const server = await startServer();
    await expect(
      connect(server.address, { headers: bearerHeaders, origin: 'http://evil.example' }),
    ).rejects.toThrow();
  });

  it('accepts an allow-listed Origin', async () => {
    const server = await startServer({ allowedOrigins: ['http://app.example'] });
    await expect(
      connect(server.address, { headers: bearerHeaders, origin: 'http://app.example' }),
    ).resolves.toBeDefined();
  });

  it('setAllowedOrigins admits an origin learned after start (a tunnel URL) without dropping clients', async () => {
    const server = await startServer();
    const existing = await connect(server.address, { headers: bearerHeaders });

    // Unknown origin (the tunnel URL isn't assigned until the tunnel opens).
    const tunnelOrigin = 'https://abcd.trycloudflare.example';
    await expect(
      connect(server.address, { headers: bearerHeaders, origin: tunnelOrigin }),
    ).rejects.toThrow();

    server.setAllowedOrigins([tunnelOrigin]);
    await expect(
      connect(server.address, { headers: bearerHeaders, origin: tunnelOrigin }),
    ).resolves.toBeDefined();
    // Nothing was revoked — the pre-existing connection survives the update.
    expect(existing.readyState).toBe(existing.OPEN);
  });

  it('caps concurrent connections', async () => {
    const server = await startServer({ maxConnections: 1 });
    await connect(server.address, { headers: bearerHeaders });
    await expect(connect(server.address, { headers: bearerHeaders })).rejects.toThrow();
  });

  it('frees a slot when a capped connection closes', async () => {
    const server = await startServer({ maxConnections: 1 });
    const first = await connect(server.address, { headers: bearerHeaders });
    first.close();
    await new Promise((r) => first.once('close', r));
    await expect(connect(server.address, { headers: bearerHeaders })).resolves.toBeDefined();
  });

  it('close() terminates connected clients promptly instead of waiting them out', async () => {
    const server = await startServer();
    const ws = await connect(server.address, { headers: bearerHeaders });
    const closed = new Promise<void>((r) => ws.once('close', () => r()));
    const started = Date.now();
    await server.close();
    await closed;
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rotateAuthToken re-keys the handshake and drops existing connections', async () => {
    const server = await startServer();
    const before = await connect(server.address, { headers: bearerHeaders });
    const dropped = new Promise<void>((r) => before.once('close', () => r()));

    server.rotateAuthToken('rotated-token');
    await dropped; // the established connection is terminated

    await expect(connect(server.address, { headers: bearerHeaders })).rejects.toThrow();
    await expect(
      connect(server.address, { headers: { authorization: 'Bearer rotated-token' } }),
    ).resolves.toBeDefined();
  });
});

describe('SlowReaderGuard', () => {
  it('allows sends while the backlog stays under the limit', () => {
    const guard = new SlowReaderGuard(100, 1000);
    expect(guard.check(0, 0)).toBe('ok');
    expect(guard.check(100, 500)).toBe('ok');
    expect(guard.check(50, 10_000)).toBe('ok');
  });

  it('grants a grace window on the first over-limit observation', () => {
    const guard = new SlowReaderGuard(100, 1000);
    expect(guard.check(5000, 0)).toBe('ok'); // stall clock starts
    expect(guard.check(5000, 999)).toBe('ok'); // still within grace
    expect(guard.check(5000, 1000)).toBe('terminate'); // grace elapsed, still stalled
  });

  it('resets the stall clock once the reader drains below the limit', () => {
    const guard = new SlowReaderGuard(100, 1000);
    expect(guard.check(5000, 0)).toBe('ok');
    expect(guard.check(10, 500)).toBe('ok'); // drained — clock resets
    expect(guard.check(5000, 1500)).toBe('ok'); // new stall, new clock
    expect(guard.check(5000, 2600)).toBe('terminate');
  });
});
