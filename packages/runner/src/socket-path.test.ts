import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runnerSocketPath, isRunnerUp, platformSocket, isNamedPipe } from './socket-path.js';
import { createUnixSocketServer } from './unix-socket.js';
import type { TransportServer } from './transport.js';

const servers: TransportServer[] = [];
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env.MOXXY_RUNNER_SOCKET;
  delete process.env.MOXXY_RUNNER_SOCKET;
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.MOXXY_RUNNER_SOCKET;
  else process.env.MOXXY_RUNNER_SOCKET = savedEnv;
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('runnerSocketPath', () => {
  it('honors the MOXXY_RUNNER_SOCKET override', () => {
    process.env.MOXXY_RUNNER_SOCKET = '/tmp/custom-runner.sock';
    expect(runnerSocketPath()).toBe('/tmp/custom-runner.sock');
  });

  it('defaults to ~/.moxxy/serve.sock on non-Windows', () => {
    if (process.platform === 'win32') {
      expect(runnerSocketPath()).toContain('pipe');
    } else {
      expect(runnerSocketPath()).toBe(path.join(os.homedir(), '.moxxy', 'serve.sock'));
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
    const missing = path.join(os.tmpdir(), `moxxy-absent-${Math.random().toString(36).slice(2)}.sock`);
    expect(await isRunnerUp(missing)).toBe(false);
  });

  it('is true once a server is listening, false after it closes', async () => {
    const socketPath = path.join(
      os.tmpdir(),
      `moxxy-up-${Math.random().toString(36).slice(2)}.sock`,
    );
    const server = await createUnixSocketServer(socketPath);
    servers.push(server);
    expect(await isRunnerUp(socketPath)).toBe(true);
    await server.close();
    servers.length = 0;
    expect(await isRunnerUp(socketPath)).toBe(false);
  });
});
