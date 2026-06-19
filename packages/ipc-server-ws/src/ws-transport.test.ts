import net from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { Transport } from '@moxxy/runner';
import { encodeWsBearerProtocol, MOXXY_WS_SUBPROTOCOL } from '@moxxy/sdk/server';
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

function parseWsAddress(address: string): { host: string; port: number } {
  const u = new URL(address);
  return { host: u.hostname, port: Number(u.port) };
}

/**
 * Open a raw TCP socket, write a valid (authenticated) WebSocket upgrade
 * request, then destroy the socket immediately — provoking the post-auth
 * handshake-abort path where `ws` reserved a slot but never emits 'connection'.
 */
function sendUpgradeThenDrop(host: string, port: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const socket = net.connect(port, host, () => {
      const req =
        `GET / HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
        `Authorization: Bearer ${TOKEN}\r\n\r\n`;
      socket.write(req, () => socket.destroy());
    });
    socket.on('error', () => {});
    socket.on('close', () => resolve());
  });
}

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

  it('holds the cap hard under concurrent upgrades (no transient over-admit)', async () => {
    const N = 3;
    const server = await startServer({ maxConnections: N });
    // Fire N+2 handshakes without awaiting the first's 'connection' before
    // opening the next — the race window the soft counter could slip through.
    const attempts = Array.from({ length: N + 2 }, () =>
      connect(server.address, { headers: bearerHeaders }).then(
        () => 'open' as const,
        () => 'refused' as const,
      ),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'open').length).toBe(N);
    expect(results.filter((r) => r === 'refused').length).toBe(2);
    expect(server.clientCount()).toBe(N);
  });

  it('does not strand the connection cap when authenticated handshakes abort mid-upgrade', async () => {
    // Regression: verifyClient reserved a slot but the only release was the
    // 'connection' event. An upgrade that passed auth and then aborted before
    // completeUpgrade (peer FIN'd, server mid-close) never emitted 'connection',
    // so each aborted handshake permanently consumed a cap slot until restart.
    const maxConnections = 2;
    const server = await startServer({ maxConnections });
    const { host, port } = parseWsAddress(server.address);

    // Fire many authenticated upgrades that drop their socket the instant the
    // request is on the wire — racing completeUpgrade's readable/writable gate.
    for (let i = 0; i < maxConnections * 8; i++) {
      await sendUpgradeThenDrop(host, port);
    }
    // Let any in-flight handshakes settle.
    await new Promise((r) => setTimeout(r, 100));

    // The cap must not be bricked: a legitimate client still connects. Under the
    // old code, post-auth aborts permanently consumed slots and this rejected.
    await expect(connect(server.address, { headers: bearerHeaders })).resolves.toBeDefined();
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

  it('evicts a stalled slow reader from the periodic sweep AFTER sends stop', async () => {
    // Regression: the per-send guard only re-evaluated eviction on the next
    // send, so a peer that stalled with a large backlog and then went idle (no
    // further broadcasts to it) pinned its multi-megabyte buffer for the
    // connection's lifetime. The independent sweep must terminate it WITHOUT any
    // further send re-triggering the check.
    //
    // To isolate the sweep as the evictor (not the per-send check), keep the
    // backlog in the soft-limit→hard-ceiling band: the synchronous blast below
    // builds ~tens of MB, so a 32 MB soft limit (128 MB hard ceiling) is
    // exceeded (arming the grace clock) but never hits the immediate hard
    // ceiling. The 200 sends finish in milliseconds — far inside the 800 ms
    // grace — so NO send can trip the grace deadline. Only the later sweep can.
    let accepted: Transport | undefined;
    const server = await startServer({
      maxBufferedBytes: 32 * 1024 * 1024,
      bufferStallGraceMs: 800,
    });
    server.onConnection((t) => {
      accepted = t;
    });

    const client = await connect(server.address, { headers: bearerHeaders });
    // Stop the client from draining its socket so the server-side backlog grows
    // and stays high (the OS receive window + send buffer fill and don't move).
    // NOTE: a paused client never processes the eventual close frame, so we
    // assert eviction from the SERVER side (clientCount), not the client's
    // 'close' event — that is exactly the idle path the sweep must cover.
    (client as unknown as { _socket: net.Socket })._socket.pause();

    expect(accepted).toBeDefined();
    const big = 'x'.repeat(256 * 1024);
    for (let i = 0; i < 200; i++) accepted!.send({ big });
    // Still admitted right after the blast — the per-send check did NOT evict
    // (backlog is under the hard ceiling and grace has not elapsed).
    expect(server.clientCount()).toBe(1);

    // The sweep interval is floored at 1000 ms; by ~1000 ms the 800 ms grace has
    // elapsed and the sweep — with no further send — must terminate the socket.
    const deadline = Date.now() + 4000;
    while (server.clientCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(server.clientCount()).toBe(0);
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
    // 300 is over the soft limit (100) but under the hard ceiling (4x = 400),
    // so the grace path — not the immediate hard-ceiling eviction — applies.
    expect(guard.check(300, 0)).toBe('ok'); // stall clock starts
    expect(guard.check(300, 999)).toBe('ok'); // still within grace
    expect(guard.check(300, 1000)).toBe('terminate'); // grace elapsed, still stalled
  });

  it('resets the stall clock once the reader drains below the limit', () => {
    const guard = new SlowReaderGuard(100, 1000);
    // Over the soft limit (100) but within the hard ceiling (400) — exercises
    // the grace/stall path rather than the immediate hard-ceiling eviction.
    expect(guard.check(300, 0)).toBe('ok');
    expect(guard.check(10, 500)).toBe('ok'); // drained — clock resets
    expect(guard.check(300, 1500)).toBe('ok'); // new stall, new clock
    expect(guard.check(300, 2600)).toBe('terminate');
  });

  it('evicts immediately past the hard ceiling, ignoring the grace window', () => {
    // hard ceiling = limit * 4 = 400. A backlog above it must terminate on the
    // FIRST observation so a peer that perpetually rides ~limit (resetting the
    // grace clock each transient drain) cannot pin memory indefinitely.
    const guard = new SlowReaderGuard(100, 1_000_000);
    expect(guard.check(401, 0)).toBe('terminate');
  });

  it('a peer riding just over the soft limit is still bounded by the hard ceiling', () => {
    const guard = new SlowReaderGuard(100, 1000);
    // Alternate over/under the SOFT limit forever — the grace clock keeps
    // resetting, so the soft path never fires. The hard ceiling still does.
    for (let t = 0; t < 100_000; t += 100) {
      expect(guard.check(150, t)).toBe('ok'); // over soft, resets grace next drain
      expect(guard.check(10, t + 50)).toBe('ok'); // drained — soft clock reset
    }
    expect(guard.check(500, 100_000)).toBe('terminate'); // > 4x limit
  });
});
