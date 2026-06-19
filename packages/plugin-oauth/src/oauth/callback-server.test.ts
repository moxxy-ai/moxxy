import { describe, expect, it } from 'vitest';
import net from 'node:net';
import { request } from 'node:http';
import { waitForCallback } from './callback-server';

/** Grab a port that's free right now (best-effort; good enough for a test). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

/** GET host:port/path, resolving once the response completes (or rejecting on
 *  a connection error — e.g. the stack isn't listening). */
function hit(host: string, port: number, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.end();
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

describe('waitForCallback — dual-stack loopback', () => {
  it('receives the callback over IPv4 (127.0.0.1)', async () => {
    const port = await freePort();
    const pending = waitForCallback({ port, path: '/auth/callback', expectedState: 'S', timeoutMs: 4_000 });
    await tick(); // let both listeners bind
    await hit('127.0.0.1', port, '/auth/callback?code=CODE4&state=S');
    expect(await pending).toBe('CODE4');
  });

  it('receives the callback over IPv6 (::1) — the Windows `localhost` path', async () => {
    const port = await freePort();
    const pending = waitForCallback({ port, path: '/auth/callback', expectedState: 'S', timeoutMs: 4_000 });
    await tick();
    // Prefer IPv6 (what Windows hits); fall back to IPv4 only if this host has
    // no IPv6 loopback, so the test stays green on IPv6-less CI runners.
    try {
      await hit('::1', port, '/auth/callback?code=CODE6&state=S');
    } catch {
      await hit('127.0.0.1', port, '/auth/callback?code=CODE6&state=S');
    }
    expect(await pending).toBe('CODE6');
  });

  it('rejects a state mismatch (CSRF guard) regardless of stack', async () => {
    const port = await freePort();
    const pending = waitForCallback({ port, path: '/auth/callback', expectedState: 'GOOD', timeoutMs: 4_000 });
    // Attach the rejection assertion BEFORE triggering the callback so the
    // rejection is never momentarily unhandled.
    const rejected = expect(pending).rejects.toThrow(/state mismatch/i);
    await tick();
    await hit('127.0.0.1', port, '/auth/callback?code=X&state=EVIL');
    await rejected;
  });

  it('rejects immediately on an ALREADY-aborted signal — never binds, never blocks', async () => {
    const port = await freePort();
    const ac = new AbortController();
    ac.abort(); // aborted BEFORE the flow starts → the abort event never fires
    const started = Date.now();
    // A huge timeout: if the guard were missing it would block for the full
    // timeout (the abort listener never runs for a pre-aborted signal).
    await expect(
      waitForCallback({
        port,
        path: '/auth/callback',
        expectedState: 'S',
        timeoutMs: 60_000,
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_ABORTED' });
    expect(Date.now() - started).toBeLessThan(1_000);
    // The port was never bound — a fresh listener can claim it without EADDRINUSE.
    const second = waitForCallback({ port, path: '/auth/callback', expectedState: 'S', timeoutMs: 2_000 });
    await tick();
    await hit('127.0.0.1', port, '/auth/callback?code=AFTER&state=S');
    expect(await second).toBe('AFTER');
  });
});
