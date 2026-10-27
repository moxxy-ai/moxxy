import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { killProcessesWithEnv, stopProcessTree } from './process-tree.js';

/**
 * Real processes: a parent that starts a grandchild in its OWN process group
 * (how an agent CLI starts `npm run dev` in the background), so neither a
 * signal to the parent nor one to the parent's group reaches it.
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

/** Starts a parent that prints its grandchild's pid; `onTerm` decides how the parent answers SIGTERM. */
async function parentWithDetachedGrandchild(onTerm: 'exit' | 'ignore'): Promise<{ parent: ChildProcess; grandchild: number }> {
  const script = `
    const { spawn } = require('node:child_process');
    const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { detached: true, stdio: 'ignore' });
    process.on('SIGTERM', () => { ${onTerm === 'exit' ? 'process.exit(0)' : ''} });
    process.stdout.write(String(g.pid) + '\\n');
    setInterval(() => {}, 1e6);
  `;
  const parent = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const grandchild = await new Promise<number>((resolve) => {
    parent.stdout!.once('data', (chunk: Buffer) => resolve(Number(String(chunk).trim())));
  });
  started.push(parent.pid!, grandchild);
  return { parent, grandchild };
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

describe.skipIf(process.platform === 'win32')('stopProcessTree', () => {
  it('stops what the process started even when the process exits on SIGTERM without stopping it', async () => {
    const { parent, grandchild } = await parentWithDetachedGrandchild('exit');

    await stopProcessTree(parent, 2_000);
    await until(() => !alive(grandchild));

    expect(alive(parent.pid!)).toBe(false);
    expect(alive(grandchild)).toBe(false);
  });

  it('kills a process that ignores SIGTERM after the grace, and what it started with it', async () => {
    const { parent, grandchild } = await parentWithDetachedGrandchild('ignore');

    const t0 = Date.now();
    await stopProcessTree(parent, 300);
    await until(() => !alive(grandchild));

    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
    expect(alive(parent.pid!)).toBe(false);
    expect(alive(grandchild)).toBe(false);
  });

  it('leaves processes it did not start alone', async () => {
    const { parent } = await parentWithDetachedGrandchild('exit');
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
    started.push(bystander.pid!);

    await stopProcessTree(parent, 2_000);

    expect(alive(bystander.pid!)).toBe(true);
  });

  it('resolves at once for a process that already ended', async () => {
    const done = spawn(process.execPath, ['-e', '']);
    await new Promise((r) => done.once('exit', r));

    await expect(stopProcessTree(done, 2_000)).resolves.toBeUndefined();
  });
});

/** A process cut loose from its parent, as `(nohup npx vite &)` leaves it: only its environment still says where it came from. */
function detachedWithEnv(env: Record<string, string>): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env },
  });
  child.unref();
  started.push(child.pid!);
  return child.pid!;
}

describe.skipIf(process.platform === 'win32')('killProcessesWithEnv', () => {
  it('kills a detached process that carries the variable with this value, and only it', async () => {
    const mark = `/tmp/moxxy-test-${randomUUID()}.sock`;
    const ours = detachedWithEnv({ MOXXY_TEST_RUNNER: mark });
    const otherRunner = detachedWithEnv({ MOXXY_TEST_RUNNER: `${mark}.other` });
    const unmarked = detachedWithEnv({});
    await until(() => alive(ours) && alive(otherRunner) && alive(unmarked));

    const killed = await killProcessesWithEnv('MOXXY_TEST_RUNNER', mark);
    await until(() => !alive(ours));

    expect(killed).toEqual([ours]);
    expect(alive(ours)).toBe(false);
    expect(alive(otherRunner)).toBe(true);
    expect(alive(unmarked)).toBe(true);
  });

  it('finds nothing when no process carries the value', async () => {
    await expect(killProcessesWithEnv('MOXXY_TEST_RUNNER', `/tmp/none-${randomUUID()}`)).resolves.toEqual([]);
  });
});
