import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Mock the runner client so we can drive a PERSISTENT protocol mismatch through
// the supervisor's loop without a real `moxxy serve`. Everything else
// (isProtocolMismatchError, RUNNER_PROTOCOL_VERSION, the socket helpers the
// supervisor imports) keeps its real behavior.
vi.mock('@moxxy/runner', async (importActual) => {
  const actual = await importActual<typeof import('@moxxy/runner')>();
  return {
    ...actual,
    connectRemoteSession: vi.fn(() => {
      // The hard mismatch the runner throws for a genuinely-incompatible client
      // — and the same version on every attempt (the pinned-CLI case).
      return Promise.reject(new Error('runner protocol mismatch: server v99, client v4'));
    }),
  };
});

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
    // Use the supervisor's test seam — the supervisor only ever assigns the
    // child from its own spawn path, and spawning a real `moxxy serve` in a
    // unit test is exactly what we're avoiding.
    sup.__setChildForTest(child.proc);

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
    expect(sup.__childForTest()).toBeNull();
  });

  it('restart() resolves immediately when the child has already exited', async () => {
    const sup = new RunnerSupervisor(path.join(tmp, 'serve.sock'));
    const child = makeFakeChild();
    child.exit(0);
    sup.__setChildForTest(child.proc);
    await sup.restart();
    expect(sup.__childForTest()).toBeNull();
  });

  it('surfaces a TERMINAL protocol-incompatible phase instead of looping forever on a persistent mismatch', async () => {
    // The desktop hot-update case: the (pinned) CLI's runner can never satisfy
    // the JS bundle's newer client, so EVERY attach mismatches the SAME way.
    // The supervisor must attempt recovery ONCE, see the same mismatch again,
    // then STOP with a terminal phase — not reconnect endlessly.
    const socketPath = path.join(tmp, 'serve.sock');

    // A resolvable (no-op) CLI so we get past resolving-cli.
    const cliEntry = path.join(tmp, 'fake-bin.js');
    writeFileSync(cliEntry, '// fake moxxy cli\n');
    process.env.MOXXY_CLI_ENTRY = cliEntry;

    const sup = new RunnerSupervisor(socketPath);
    // ADOPT path on every attempt (no real serve to spawn) + don't actually
    // hunt/unlink processes. The mocked connectRemoteSession is what throws.
    const priv = sup as unknown as {
      probeSocket: () => Promise<boolean>;
      killForeignRunner: () => Promise<void>;
    };
    priv.probeSocket = () => Promise.resolve(true);
    priv.killForeignRunner = () => Promise.resolve();

    const phases: string[] = [];
    sup.on('change', (snap) => phases.push(snap.phase.phase));

    const loop = sup.run();
    await waitFor(() => sup.snapshot().phase.phase === 'protocol-incompatible', 8000);
    // run() must have RETURNED (terminal phase breaks the loop) — not still spinning.
    await loop;

    const final = sup.snapshot().phase;
    expect(final.phase).toBe('protocol-incompatible');
    if (final.phase === 'protocol-incompatible') {
      expect(final.serverVersion).toBe(99);
      expect(final.clientVersion).toBe(4);
      expect(final.hint).toMatch(/update the cli/i);
    }
    // Bounded: one "stale runner replaced" recovery reconnect at most, then
    // terminal — never an unbounded reconnect storm.
    const reconnects = phases.filter((p) => p === 'reconnecting').length;
    expect(reconnects).toBeLessThanOrEqual(2);

    await sup.stop();
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
