import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeClient, bridgeAddressFromEnv, BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV } from './bridge-client.js';

/**
 * Client half of the desktop bridge. Driven against a real socket serving the
 * real framing — the failure modes worth pinning (a hang-up mid-call, a
 * refused handshake) only exist at that level.
 */

const servers: Server[] = [];
const clients: BridgeClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

/** A stand-in bridge: checks the token, then answers from `handler`. */
function fakeBridge(opts: { token: string; handler?: (method: string) => unknown; dropAfterHello?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), 'moxxy-bridge-test-'));
  const socketPath = join(dir, 'b.sock');
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let buf = '';
    let authed = false;
    socket.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const req = JSON.parse(line) as { id: string; method: string; params?: Record<string, unknown> };
        if (!authed) {
          const good = req.method === 'hello' && req.params?.token === opts.token;
          socket.write(
            JSON.stringify(
              good ? { id: req.id, ok: true, result: {} } : { id: req.id, ok: false, error: { message: 'unauthorized' } },
            ) + '\n',
          );
          if (!good) return socket.destroy();
          authed = true;
          if (opts.dropAfterHello) socket.destroy();
          continue;
        }
        socket.write(JSON.stringify({ id: req.id, ok: true, result: opts.handler?.(req.method) ?? {} }) + '\n');
      }
    });
  });
  servers.push(server);
  return new Promise<string>((resolve) => server.listen(socketPath, () => resolve(socketPath)));
}

function makeClient(socketPath: string, token: string): BridgeClient {
  const c = new BridgeClient({ socketPath, token });
  clients.push(c);
  return c;
}

describe('bridgeAddressFromEnv', () => {
  it('reads the pair the desktop sets', () => {
    const addr = bridgeAddressFromEnv({ [BRIDGE_SOCKET_ENV]: '/tmp/x.sock', [BRIDGE_TOKEN_ENV]: 'abc' });
    expect(addr).toEqual({ socketPath: '/tmp/x.sock', token: 'abc' });
  });

  it('is null when either half is missing — a half-configured bridge is no bridge', () => {
    expect(bridgeAddressFromEnv({ [BRIDGE_SOCKET_ENV]: '/tmp/x.sock' })).toBeNull();
    expect(bridgeAddressFromEnv({ [BRIDGE_TOKEN_ENV]: 'abc' })).toBeNull();
    expect(bridgeAddressFromEnv({})).toBeNull();
  });
});

describe('BridgeClient', () => {
  it('handshakes once, then serves calls', async () => {
    const path = await fakeBridge({ token: 'sekret', handler: (m) => ({ echoed: m }) });
    const client = makeClient(path, 'sekret');

    expect(await client.call('snapshot')).toEqual({ echoed: 'snapshot' });
    expect(await client.call('act')).toEqual({ echoed: 'act' });
  });

  it('surfaces a refused handshake instead of retrying forever', async () => {
    const path = await fakeBridge({ token: 'sekret' });
    const client = makeClient(path, 'zly-token');

    await expect(client.call('snapshot')).rejects.toThrow(/unauthorized/i);
  });

  it('fails in-flight calls when the desktop goes away', async () => {
    const path = await fakeBridge({ token: 'sekret', dropAfterHello: true });
    const client = makeClient(path, 'sekret');

    await expect(client.call('snapshot')).rejects.toThrow(/bridge/i);
  });

  it('refuses to connect at all when nothing is listening', async () => {
    const client = makeClient(join(tmpdir(), 'moxxy-nie-ma-takiego.sock'), 't');

    await expect(client.call('snapshot')).rejects.toThrow();
  });

  it('drops one call on abort without disturbing the next', async () => {
    const path = await fakeBridge({ token: 'sekret', handler: () => ({ fine: true }) });
    const client = makeClient(path, 'sekret');
    await client.call('warmup');

    const controller = new AbortController();
    const aborted = client.call('snapshot', {}, controller.signal);
    controller.abort();

    await expect(aborted).rejects.toThrow(/abort/i);
    expect(await client.call('snapshot')).toEqual({ fine: true });
  });
});
