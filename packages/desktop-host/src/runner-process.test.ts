import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RUNNER_SOCKET_ENV, stopRunnerProcess } from './runner-process';

/**
 * Real processes: a stand-in runner that starts a dev server the way an agent
 * does with `(nohup npx vite &)` — detached, so it leaves the runner's tree
 * at once and only the inherited runner socket in its environment links it.
 */
const started: number[] = [];

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
}

async function runnerWithDetachedServer(socket: string): Promise<{ runner: ChildProcess; server: number }> {
  const script = `
    const { spawn } = require('node:child_process');
    const s = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { detached: true, stdio: 'ignore' });
    s.unref();
    process.on('SIGTERM', () => process.exit(0));
    process.stdout.write(String(s.pid) + '\\n');
    setInterval(() => {}, 1e6);
  `;
  const runner = spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, [RUNNER_SOCKET_ENV]: socket },
  });
  const server = await new Promise<number>((resolve) => {
    runner.stdout!.once('data', (chunk: Buffer) => resolve(Number(String(chunk).trim())));
  });
  started.push(runner.pid!, server);
  return { runner, server };
}

afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
});

describe.skipIf(process.platform === 'win32')('stopRunnerProcess', () => {
  it('on quitting the app, stops a server the runner left detached', async () => {
    const socket = `/tmp/moxxy-test-${randomUUID()}.sock`;
    const { runner, server } = await runnerWithDetachedServer(socket);

    await stopRunnerProcess(runner, socket, { detachedWork: true });
    await until(() => !alive(server));

    expect(alive(runner.pid!)).toBe(false);
    expect(alive(server)).toBe(false);
  });

  it('on a runner restart (new chat), keeps a server the runner left detached', async () => {
    const socket = `/tmp/moxxy-test-${randomUUID()}.sock`;
    const { runner, server } = await runnerWithDetachedServer(socket);

    await stopRunnerProcess(runner, socket, { detachedWork: false });

    expect(alive(runner.pid!)).toBe(false);
    expect(alive(server)).toBe(true);
  });
});
