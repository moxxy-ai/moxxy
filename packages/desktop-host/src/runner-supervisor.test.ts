import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { RunnerSupervisor } from './runner-supervisor';

let tmp: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'sup-'));
  process.env = { ...originalEnv };
  process.env.PATH = tmp;
  process.env.HOME = tmp; // suppress augmentedPaths' nvm walk
  delete process.env.MOXXY_CLI_ENTRY;
  // Move cwd into the tmp tree so monorepo walk-up doesn't find our
  // own packages/cli/dist/bin.js.
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(originalCwd);
});

const originalCwd = process.cwd();

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
}, 0);

describe('RunnerSupervisor', () => {
  it('starts in the idle phase', () => {
    const sup = new RunnerSupervisor(path.join(tmp, 'serve.sock'));
    expect(sup.snapshot().phase.phase).toBe('idle');
    expect(sup.remote()).toBeNull();
  });

  it('transitions to cli-missing when no moxxy can be found', async () => {
    const sup = new RunnerSupervisor(path.join(tmp, 'serve.sock'));
    const phases: string[] = [];
    sup.on('change', (snap) => phases.push(snap.phase.phase));

    // Run the loop just long enough to observe the cli-missing phase
    // then stop it so the test exits.
    const loop = sup.run();
    await waitFor(() => phases.includes('cli-missing'), 2000);
    await sup.stop();
    await loop;

    expect(phases[0]).toBe('resolving-cli');
    expect(phases).toContain('cli-missing');
    const final = sup.snapshot().phase;
    expect(final.phase).toBe('cli-missing');
    if (final.phase === 'cli-missing') {
      expect(final.hint).toMatch(/npm install/);
    }
  });

  it('emits a `change` event for every phase transition', async () => {
    const sup = new RunnerSupervisor(path.join(tmp, 'serve.sock'));
    const phases: string[] = [];
    sup.on('change', (snap) => phases.push(snap.phase.phase));

    const loop = sup.run();
    await waitFor(() => phases.length >= 2, 2000);
    await sup.stop();
    await loop;

    // We should see at least: resolving-cli → cli-missing.
    expect(phases.length).toBeGreaterThanOrEqual(2);
    expect(new Set(phases)).toContain('resolving-cli');
  });

  it('snapshot.cliPath stays null while CLI is unresolved', async () => {
    const sup = new RunnerSupervisor(path.join(tmp, 'serve.sock'));
    const loop = sup.run();
    await waitFor(() => sup.snapshot().phase.phase === 'cli-missing', 2000);
    expect(sup.snapshot().cliPath).toBeNull();
    await sup.stop();
    await loop;
  });

  it('stop() short-circuits the retry wait', async () => {
    const sup = new RunnerSupervisor(path.join(tmp, 'serve.sock'));
    const start = Date.now();
    const loop = sup.run();
    await waitFor(() => sup.snapshot().phase.phase === 'cli-missing', 2000);
    await sup.stop();
    await loop;
    // The reconnect backoff is 2000ms; stop should bail well before.
    expect(Date.now() - start).toBeLessThan(2500);
  });

  it('restart() waits for the child to exit before letting the loop respawn', async () => {
    const sup = new RunnerSupervisor(path.join(tmp, 'serve.sock'));
    const child = makeFakeChild();
    // Reach into the private field — the supervisor only ever assigns the
    // child from its own spawn path, and spawning a real `moxxy serve` in a
    // unit test is exactly what we're avoiding.
    (sup as unknown as { child: ChildProcess | null }).child = child.proc;

    let settled = false;
    const done = sup.restart().then(() => {
      settled = true;
    });

    // restart() must NOT resolve while the child is still alive: a bare
    // kill() + immediate respawn races the old process for the socket
    // (EADDRINUSE) — the bug this test pins down.
    await new Promise((r) => setTimeout(r, 50));
    expect(child.signals).toContain('SIGTERM');
    expect(settled).toBe(false);

    child.exit(0);
    await done;
    expect(
      (sup as unknown as { child: ChildProcess | null }).child,
    ).toBeNull();
  });

  it('restart() resolves immediately when the child has already exited', async () => {
    const sup = new RunnerSupervisor(path.join(tmp, 'serve.sock'));
    const child = makeFakeChild();
    child.exit(0);
    (sup as unknown as { child: ChildProcess | null }).child = child.proc;
    await sup.restart();
    expect(
      (sup as unknown as { child: ChildProcess | null }).child,
    ).toBeNull();
  });
});

/** A minimal ChildProcess stand-in: records kill() signals and exposes a
 *  deterministic exit() the test triggers explicitly. */
function makeFakeChild(): {
  proc: ChildProcess;
  signals: string[];
  exit: (code: number) => void;
} {
  const signals: string[] = [];
  const emitter = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.kill = (signal: NodeJS.Signals | number = 'SIGTERM') => {
    signals.push(String(signal));
    return true;
  };
  return {
    proc: emitter as unknown as ChildProcess,
    signals,
    exit: (code: number) => {
      emitter.exitCode = code;
      emitter.emit('exit', code, null);
    },
  };
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
