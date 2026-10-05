import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fitSocketPath, isNamedPipe, isRunnerUp, maxSocketPathBytes, platformSocket, runnerSocketPath } from './socket-path.js';
import { createUnixSocketServer } from './unix-socket.js';
import type { TransportServer } from './transport.js';

const servers: TransportServer[] = [];
let savedEnv: string | undefined;
let savedMoxxyHome: string | undefined;

beforeEach(() => {
  savedEnv = process.env.MOXXY_RUNNER_SOCKET;
  delete process.env.MOXXY_RUNNER_SOCKET;
  // The default-home test asserts the `~/.moxxy` fallback, so MOXXY_HOME must be
  // unset by default; the dedicated test below sets it back.
  savedMoxxyHome = process.env.MOXXY_HOME;
  delete process.env.MOXXY_HOME;
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.MOXXY_RUNNER_SOCKET;
  else process.env.MOXXY_RUNNER_SOCKET = savedEnv;
  if (savedMoxxyHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = savedMoxxyHome;
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function tmpSocket(prefix: string): string {
  const name = `${prefix}-${Math.random().toString(36).slice(2)}`;
  return platformSocket(name, path.join(os.tmpdir(), `${name}.sock`));
}

describe('runnerSocketPath', () => {
  it('honors the MOXXY_RUNNER_SOCKET override', () => {
    process.env.MOXXY_RUNNER_SOCKET = '/tmp/custom-runner.sock';
    expect(runnerSocketPath()).toBe('/tmp/custom-runner.sock');
  });

  it('defaults to ~/.moxxy/serve.sock on non-Windows when MOXXY_HOME is unset', () => {
    if (process.platform === 'win32') {
      expect(runnerSocketPath()).toContain('pipe');
    } else {
      expect(runnerSocketPath()).toBe(path.join(os.homedir(), '.moxxy', 'serve.sock'));
    }
  });

  it('honors $MOXXY_HOME so the runner socket follows the relocated data dir', () => {
    const altHome = path.join(os.tmpdir(), `moxxy-home-${Math.random().toString(36).slice(2)}`);
    process.env.MOXXY_HOME = altHome;
    if (process.platform === 'win32') {
      // The Windows pipe namespace is flat — the socket is a named pipe, not a
      // filesystem path, so MOXXY_HOME can't move it.
      expect(runnerSocketPath()).toContain('pipe');
    } else {
      // Lives directly under MOXXY_HOME, NOT under ~/.moxxy.
      expect(runnerSocketPath()).toBe(path.join(altHome, 'serve.sock'));
    }
  });
});

describe('platformSocket — the OS socket-address split', () => {
  it('returns a Windows named pipe (NOT the .sock path) on win32', () => {
    expect(platformSocket('serve', '/home/u/.moxxy/serve.sock', 'win32')).toBe(
      '\\\\.\\pipe\\moxxy-serve',
    );
  });

  it('returns the supplied filesystem path on unix/macOS', () => {
    expect(platformSocket('serve', '/home/u/.moxxy/serve.sock', 'linux')).toBe(
      '/home/u/.moxxy/serve.sock',
    );
    expect(platformSocket('serve', '/Users/u/.moxxy/serve.sock', 'darwin')).toBe(
      '/Users/u/.moxxy/serve.sock',
    );
  });

  it('sanitizes the name into a single legal pipe segment on Windows', () => {
    expect(platformSocket('serve-a/b\\c:d', '/x', 'win32')).toBe('\\\\.\\pipe\\moxxy-serve-a_b_c_d');
  });
});

/**
 * A unix socket path past `sun_path` (104 bytes on macOS, 108 on Linux) is cut
 * short by libuv without a word. Two runners under a deep MOXXY_HOME then bind
 * one socket: the second dies with EADDRINUSE ("moxxy serve exited before
 * binding") and a client of one session can reach another's runner.
 */
describe.skipIf(process.platform === 'win32')('a socket path too long to bind whole', () => {
  const deep = path.join(os.tmpdir(), 'd'.repeat(120), 'desktop', 'sockets');
  const bytes = (p: string): number => Buffer.byteLength(p);
  // Linux CI has a shared /tmp and maybe no runtime folder: give it one, private
  // as systemd makes it (mkdtemp creates 0700).
  let runtime: string;
  let savedRuntime: string | undefined;
  beforeEach(() => {
    savedRuntime = process.env.XDG_RUNTIME_DIR;
    runtime = mkdtempSync(path.join(os.tmpdir(), 'rt-'));
    process.env.XDG_RUNTIME_DIR = runtime;
  });
  afterEach(() => {
    if (savedRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedRuntime;
    rmSync(runtime, { recursive: true, force: true });
  });

  it('moves to a short private folder, a different socket for each long path', () => {
    const a = platformSocket('a', path.join(deep, 'serve-aaaaaaaa-1234-1234-1234-123456789012.sock'));
    const b = platformSocket('b', path.join(deep, 'serve-bbbbbbbb-1234-1234-1234-123456789012.sock'));

    expect(bytes(a)).toBeLessThanOrEqual(maxSocketPathBytes());
    expect(bytes(b)).toBeLessThanOrEqual(maxSocketPathBytes());
    expect(a).not.toBe(b);
  });

  it('moves the same long path to the same place, so the runner and its clients agree', () => {
    const long = path.join(deep, 'serve.sock');
    expect(platformSocket('serve', long)).toBe(platformSocket('serve', long));
  });

  it('keeps a path that fits exactly as it is', () => {
    const fits = '/' + 'a'.repeat(maxSocketPathBytes('darwin') - 1);
    expect(platformSocket('x', fits, 'darwin')).toBe(fits);
    expect(platformSocket('x', '/Users/u/.moxxy/desktop/sockets/serve-1.sock', 'darwin')).toBe('/Users/u/.moxxy/desktop/sockets/serve-1.sock');
  });

  it('follows a deep MOXXY_HOME and a too-long MOXXY_RUNNER_SOCKET alike', () => {
    process.env.MOXXY_HOME = path.join(os.tmpdir(), 'h'.repeat(120));
    expect(bytes(runnerSocketPath())).toBeLessThanOrEqual(maxSocketPathBytes());
    process.env.MOXXY_RUNNER_SOCKET = path.join(deep, 'custom.sock');
    expect(bytes(runnerSocketPath())).toBeLessThanOrEqual(maxSocketPathBytes());
  });

  it('refuses, saying why, rather than share a folder other users can write to', () => {
    const shared = mkdtempSync(path.join(os.tmpdir(), 'shared-'));
    chmodSync(shared, 0o777);
    expect(() => fitSocketPath(path.join(deep, 'serve.sock'), process.platform, [shared])).toThrow(/MOXXY_HOME/);
    rmSync(shared, { recursive: true, force: true });
  });

  it('lets two runners listen side by side and reach each its own', async () => {
    const a = platformSocket('a', path.join(deep, `serve-${'a'.repeat(36)}.sock`));
    const b = platformSocket('b', path.join(deep, `serve-${'b'.repeat(36)}.sock`));
    const first = await createUnixSocketServer(a);
    servers.push(first);
    const second = await createUnixSocketServer(b);
    servers.push(second);

    expect(await isRunnerUp(a)).toBe(true);
    expect(await isRunnerUp(b)).toBe(true);
  });
});

describe('isNamedPipe', () => {
  it('recognizes Windows pipe addresses', () => {
    expect(isNamedPipe('\\\\.\\pipe\\moxxy-serve')).toBe(true);
    expect(isNamedPipe('//./pipe/moxxy-serve')).toBe(true);
  });

  it('rejects filesystem socket paths', () => {
    expect(isNamedPipe('/home/u/.moxxy/serve.sock')).toBe(false);
    expect(isNamedPipe('C:\\Users\\u\\.moxxy\\serve.sock')).toBe(false);
  });
});

describe('isRunnerUp', () => {
  it('is false when nothing is listening', async () => {
    const missing = tmpSocket('moxxy-absent');
    expect(await isRunnerUp(missing)).toBe(false);
  });

  it('is true once a server is listening, false after it closes', async () => {
    const socketPath = tmpSocket('moxxy-up');
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);
    expect(await isRunnerUp(socketPath)).toBe(true);
    await server.close();
    servers.length = 0;
    expect(await isRunnerUp(socketPath)).toBe(false);
  });
});
