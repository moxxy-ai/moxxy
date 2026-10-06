import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PeerSupervisor, type PeerSupervisorOptions } from './peer-supervisor.js';
import type { RosterEntry } from '@moxxy/plugin-collab';
import { COLLAB_MAX_ITERATIONS_ENV } from './constants.js';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function baseOpts(overrides: Partial<PeerSupervisorOptions> = {}): PeerSupervisorOptions {
  return {
    runId: 'test-run',
    hubSocket: '/tmp/hub.sock',
    coordinatorSessionId: 'sess',
    parentTask: 'task',
    signal: new AbortController().signal,
    ...overrides,
  };
}

const entry: RosterEntry = { id: 'peer1', name: 'Peer', role: 'implementer', subtask: 'do' };

describe('PeerSupervisor', () => {
  it('throws a clear error at construction when no CLI entry can be located', () => {
    // Simulate a host that invokes the entrypoint with no script argv[1].
    const prev = process.argv[1];
    // @ts-expect-error — intentionally clearing argv[1] to drive the guard.
    process.argv[1] = undefined;
    try {
      expect(() => new PeerSupervisor(baseOpts())).toThrow(/cannot locate the moxxy CLI/i);
    } finally {
      process.argv[1] = prev;
    }
  });

  it('accepts an injected cliEntry instead of process.argv[1]', () => {
    const prev = process.argv[1];
    // @ts-expect-error — clear argv[1] so the only entry is the injected one.
    process.argv[1] = undefined;
    try {
      expect(() => new PeerSupervisor(baseOpts({ cliEntry: '/path/to/cli.js' }))).not.toThrow();
    } finally {
      process.argv[1] = prev;
    }
  });

  it('forwards peerMaxIterations to the spawned child via env', async () => {
    // Spawn a trivial node script (as the "CLI entry") that records the env var
    // the supervisor set, proving config.peerMaxIterations actually reaches a peer.
    const dir = mkdtempSync(join(tmpdir(), 'mc-sup-'));
    cleanups.push(() => removeDirSync(dir));
    const out = join(dir, 'env.txt');
    const script = join(dir, 'probe.js');
    writeFileSync(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(out)}, String(process.env[${JSON.stringify(
        COLLAB_MAX_ITERATIONS_ENV,
      )}] ?? 'unset'));`,
    );

    const sup = new PeerSupervisor(baseOpts({ cliEntry: script, peerMaxIterations: 7 }));
    cleanups.push(() => void sup.shutdownAll('test done'));
    // Wait for the probe to exit, not just for its file: Windows will not remove
    // a directory a live process has as its cwd (EBUSY in cleanup).
    const exited = new Promise<string>((resolve) => sup.onExit(resolve));
    // The child is `node <script> agent`; our probe ignores the 'agent' arg.
    sup.spawn({ entry, cwd: dir, mode: 'collab-peer' });
    await exited;

    expect(readFileSync(out, 'utf8')).toBe('7');
  });

  it('tells listeners the moment a peer process exits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-sup-'));
    cleanups.push(() => removeDirSync(dir));
    const script = join(dir, 'quit.js');
    writeFileSync(script, 'process.exit(0);');
    const sup = new PeerSupervisor(baseOpts({ cliEntry: script }));
    cleanups.push(() => void sup.shutdownAll('test done'));

    const exited = new Promise<string>((resolve) => sup.onExit(resolve));
    sup.spawn({ entry, cwd: dir, mode: 'collab-peer' });

    await expect(exited).resolves.toBe('peer1');
    expect(sup.hasExited('peer1')).toBe(true);
  });
});
