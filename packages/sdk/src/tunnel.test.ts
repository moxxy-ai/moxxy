import { describe, expect, it } from 'vitest';
import { isCliTunnelAvailable, spawnCliTunnel } from './tunnel.js';

const URL_RE = /https:\/\/[a-z0-9-]+\.example\.test/i;

describe('spawnCliTunnel', () => {
  it('resolves the parsed URL + pid when the child prints a matching line', async () => {
    const handle = await spawnCliTunnel({
      cmd: process.execPath,
      // Print a noise line, then the URL, then stay alive so close() can kill it.
      args: ['-e', 'console.log("starting up"); console.log("url=https://abc-123.example.test ready"); setInterval(()=>{}, 1000);'],
      urlRegex: URL_RE,
      name: 'faketunnel',
      timeoutMs: 5_000,
    });
    expect(handle.url).toBe('https://abc-123.example.test');
    expect(handle.pid).toBeGreaterThan(0);
    await handle.close();
  });

  it('parses URLs printed on stderr too', async () => {
    const handle = await spawnCliTunnel({
      cmd: process.execPath,
      args: ['-e', 'console.error("https://err-host.example.test"); setInterval(()=>{}, 1000);'],
      urlRegex: URL_RE,
      timeoutMs: 5_000,
    });
    expect(handle.url).toBe('https://err-host.example.test');
    await handle.close();
  });

  it('u125-1: resolves a URL split across two stdout chunks', async () => {
    // Write the URL in two separate process.stdout.write calls, split
    // mid-host, with a tick gap so they surface as distinct 'data' events.
    // Matching each chunk in isolation would miss it; the rolling buffer must
    // stitch them.
    const handle = await spawnCliTunnel({
      cmd: process.execPath,
      args: [
        '-e',
        'process.stdout.write("ready https://abc-1");' +
          'setTimeout(()=>{process.stdout.write("23.example.test\\n");},50);' +
          'setInterval(()=>{}, 1000);',
      ],
      urlRegex: URL_RE,
      name: 'splittunnel',
      timeoutMs: 5_000,
    });
    expect(handle.url).toBe('https://abc-123.example.test');
    await handle.close();
  });

  it('rejects when the child exits before emitting a URL', async () => {
    await expect(
      spawnCliTunnel({
        cmd: process.execPath,
        args: ['-e', 'process.exit(3)'],
        urlRegex: URL_RE,
        name: 'faketunnel',
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/faketunnel exited \(code 3\) before emitting a URL/);
  });

  it('rejects when the executable cannot be spawned', async () => {
    await expect(
      spawnCliTunnel({
        cmd: 'definitely-not-a-real-binary-xyz',
        args: [],
        urlRegex: URL_RE,
        name: 'nope',
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow();
  });

  it('rejects on timeout when no URL is ever printed (and kills the child)', async () => {
    await expect(
      spawnCliTunnel({
        cmd: process.execPath,
        args: ['-e', 'setInterval(()=>{}, 1000);'],
        urlRegex: URL_RE,
        name: 'slowtunnel',
        timeoutMs: 150,
      }),
    ).rejects.toThrow(/slowtunnel: timed out after 150ms/);
  });
});

describe('isCliTunnelAvailable', () => {
  it('resolves true for an installed runnable binary', async () => {
    // node is always present in the test runtime and supports --version.
    expect(await isCliTunnelAvailable(process.execPath)).toBe(true);
  });

  it('resolves false for a missing binary', async () => {
    expect(await isCliTunnelAvailable('definitely-not-a-real-binary-xyz')).toBe(false);
  });
});
