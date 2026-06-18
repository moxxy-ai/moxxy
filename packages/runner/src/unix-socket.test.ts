import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUnixSocketServer, connectUnixSocket, type SocketLogger } from './unix-socket.js';
import type { Transport, TransportServer } from './transport.js';

function tmpSocket(): string {
  return path.join(os.tmpdir(), `moxxy-sock-${Math.random().toString(36).slice(2, 10)}.sock`);
}

const servers: TransportServer[] = [];
const transports: Transport[] = [];

afterEach(async () => {
  for (const t of transports.splice(0)) t.close();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** Collect the next frame a transport receives. */
function nextFrame(t: Transport): Promise<unknown> {
  return new Promise((resolve) => t.onFrame((f) => resolve(f)));
}

describe('unix-socket transport (NDJSON framing)', () => {
  it('round-trips a JSON frame client->server and server->client', async () => {
    const socketPath = tmpSocket();
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);

    const serverSide = new Promise<Transport>((resolve) => server.onConnection(resolve));
    const client = await connectUnixSocket(socketPath);
    transports.push(client);
    const srv = await serverSide;

    const gotOnServer = nextFrame(srv);
    client.send({ hello: 'world', n: 42 });
    expect(await gotOnServer).toEqual({ hello: 'world', n: 42 });

    const gotOnClient = nextFrame(client);
    srv.send({ reply: true });
    expect(await gotOnClient).toEqual({ reply: true });
  });

  it('onConnection is single-handler, last-write-wins (u121-3)', async () => {
    const socketPath = tmpSocket();
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);

    let firstCalls = 0;
    server.onConnection(() => {
      firstCalls += 1;
    });
    // A second register replaces the first — no fan-out.
    const secondSaw = new Promise<Transport>((resolve) => server.onConnection(resolve));

    const client = await connectUnixSocket(socketPath);
    transports.push(client);
    await secondSaw;

    expect(firstCalls).toBe(0); // the replaced handler never fired
  });

  it('preserves order and boundaries for several frames sent back-to-back', async () => {
    const socketPath = tmpSocket();
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);
    const serverSide = new Promise<Transport>((resolve) => server.onConnection(resolve));
    const client = await connectUnixSocket(socketPath);
    transports.push(client);
    const srv = await serverSide;

    const received: unknown[] = [];
    // Wait until all five frames land rather than racing a fixed delay: the
    // frames arrive in a single 'data' event, so a too-short timeout flakes to
    // an empty array under CI load. The test's own timeout catches a genuine loss.
    const got5 = new Promise<void>((resolve) => {
      srv.onFrame((f) => {
        received.push(f);
        if (received.length === 5) resolve();
      });
    });
    for (let i = 0; i < 5; i++) client.send({ i });
    await got5;
    expect(received).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }]);
  });

  it('reassembles a frame split across two writes', async () => {
    const socketPath = tmpSocket();
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);
    const serverSide = new Promise<Transport>((resolve) => server.onConnection(resolve));
    // Raw client so we can write a partial line then the rest.
    const raw = net.connect(socketPath);
    await new Promise<void>((resolve) => raw.once('connect', () => resolve()));
    const srv = await serverSide;
    const got = nextFrame(srv);
    const payload = JSON.stringify({ big: 'x'.repeat(1000) });
    raw.write(payload.slice(0, 100));
    await new Promise((r) => setTimeout(r, 10));
    raw.write(payload.slice(100) + '\n');
    expect(await got).toEqual({ big: 'x'.repeat(1000) });
    raw.destroy();
  });

  it('drops a malformed frame and keeps the link alive for the next good frame', async () => {
    const socketPath = tmpSocket();
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);
    const serverSide = new Promise<Transport>((resolve) => server.onConnection(resolve));
    // Raw client so we can write an invalid JSON line followed by a valid one.
    const raw = net.connect(socketPath);
    await new Promise<void>((resolve) => raw.once('connect', () => resolve()));
    const srv = await serverSide;

    const received: unknown[] = [];
    const gotGood = new Promise<void>((resolve) => {
      srv.onFrame((f) => {
        received.push(f);
        resolve();
      });
    });
    raw.write('garbage{not json\n{"ok":1}\n');
    await gotGood;
    // Exactly the valid frame is delivered; the malformed line was dropped and
    // the transport survived (it didn't tear down on the bad line).
    expect(received).toEqual([{ ok: 1 }]);

    // The link is still usable after the malformed line.
    const gotNext = nextFrame(srv);
    raw.write('{"after":2}\n');
    expect(await gotNext).toEqual({ after: 2 });
    raw.destroy();
  });

  it('parses many small frames arriving in a single chunk (linear, in order)', async () => {
    const socketPath = tmpSocket();
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);
    const serverSide = new Promise<Transport>((resolve) => server.onConnection(resolve));
    const raw = net.connect(socketPath);
    await new Promise<void>((resolve) => raw.once('connect', () => resolve()));
    const srv = await serverSide;

    const N = 5000;
    const received: number[] = [];
    const done = new Promise<void>((resolve) => {
      srv.onFrame((f) => {
        received.push((f as { i: number }).i);
        if (received.length === N) resolve();
      });
    });
    // One big chunk carrying N newline-delimited frames.
    let blob = '';
    for (let i = 0; i < N; i++) blob += `${JSON.stringify({ i })}\n`;
    raw.write(blob);
    await done;
    expect(received.length).toBe(N);
    expect(received[0]).toBe(0);
    expect(received[N - 1]).toBe(N - 1);
    raw.destroy();
  });

  it('reclaims a stale socket file left by a crashed runner', async () => {
    const socketPath = tmpSocket();
    // Simulate a leftover file with nothing listening.
    fs.writeFileSync(socketPath, '');
    expect(fs.existsSync(socketPath)).toBe(true);
    // Should unlink the stale file and bind cleanly.
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);
    // Register the connection handler BEFORE connecting so we don't miss it.
    const serverSide = new Promise<Transport>((resolve) => server.onConnection(resolve));
    const client = await connectUnixSocket(socketPath);
    transports.push(client);
    const srv = await serverSide;
    const got = nextFrame(srv);
    client.send({ ok: 1 });
    expect(await got).toEqual({ ok: 1 });
  });

  it.skipIf(process.platform === 'win32')(
    'creates the socket parent directory with mode 0700 before listening',
    async () => {
      const dir = path.join(os.tmpdir(), `moxxy-sockdir-${Math.random().toString(36).slice(2, 10)}`);
      const socketPath = path.join(dir, 'serve.sock');
      try {
        const server = await createUnixSocketServer(socketPath);
        servers.push(server);
        // The freshly created parent dir is born private - other users can
        // never reach the socket, even before any post-listen chmod.
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
        // Belt-and-braces: the socket node itself is tightened too.
        expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'tightens a pre-existing socket directory it owns to 0700',
    async () => {
      const dir = path.join(os.tmpdir(), `moxxy-sockdir-${Math.random().toString(36).slice(2, 10)}`);
      fs.mkdirSync(dir, { mode: 0o755 });
      const socketPath = path.join(dir, 'serve.sock');
      try {
        const server = await createUnixSocketServer(socketPath);
        servers.push(server);
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'logs loudly when chmod of the socket fails instead of swallowing it',
    async () => {
      const errors: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
      const logger: SocketLogger = {
        warn: () => {},
        error: (msg, meta) => errors.push({ msg, ...(meta ? { meta } : {}) }),
      };
      const socketPath = tmpSocket();
      const spy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
        throw new Error('EPERM: injected chmod failure');
      });
      try {
        const server = await createUnixSocketServer(socketPath, logger);
        servers.push(server);
      } finally {
        spy.mockRestore();
      }
      const loud = errors.find((e) => e.msg.includes('failed to chmod runner socket'));
      expect(loud).toBeDefined();
      expect(loud?.meta).toMatchObject({
        socketPath,
        error: expect.stringContaining('injected chmod failure') as unknown,
      });
    },
  );

  it('rejects on a hung connect (neither connect nor error fires) instead of hanging forever', async () => {
    // A half-open pipe / a server bound-but-not-accepting can leave net.connect
    // emitting neither 'connect' nor 'error'. Stub it with a socket that never
    // does either; the bounded timeout must settle the Promise.
    const fakeSocket = new EventEmitter() as unknown as net.Socket & { destroyed: boolean };
    let destroyedWith: Error | undefined;
    (fakeSocket as unknown as { destroy: (e?: Error) => void }).destroy = (e?: Error) => {
      destroyedWith = e;
    };
    const spy = vi.spyOn(net, 'connect').mockReturnValue(fakeSocket);
    try {
      await expect(connectUnixSocket('/tmp/never.sock', { timeoutMs: 30 })).rejects.toThrow(
        /connect timeout/i,
      );
      // The hung socket was torn down with the timeout error so it can't leak.
      expect(destroyedWith?.message).toMatch(/connect timeout/i);
    } finally {
      spy.mockRestore();
    }
  });

  it('fires onClose when the peer disconnects', async () => {
    const socketPath = tmpSocket();
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);
    const serverSide = new Promise<Transport>((resolve) => server.onConnection(resolve));
    const client = await connectUnixSocket(socketPath);
    const srv = await serverSide;
    const closed = new Promise<void>((resolve) => srv.onClose(() => resolve()));
    client.close();
    await expect(closed).resolves.toBeUndefined();
  });
});
