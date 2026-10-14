import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

vi.mock('@moxxy/runner', async (importActual) => {
  const actual = await importActual<typeof import('@moxxy/runner')>();
  return { ...actual, connectRemoteSession: vi.fn() };
});

import { connectRemoteSession, type RemoteSession } from '@moxxy/runner';
import { RunnerSupervisor } from './runner-supervisor';

/** A connected session that drops after `dropAfterMs`, or never when null. */
function fakeSession(dropAfterMs: number | null): RemoteSession {
  return {
    getInfo: () => ({ sessionId: 's1', activeProvider: null, activeMode: null }),
    onClose: (handler: () => void) => {
      if (dropAfterMs !== null) setTimeout(handler, dropAfterMs);
    },
    close: () => Promise.resolve(),
  } as unknown as RemoteSession;
}

function fakeChild(): { proc: ChildProcess; signals: string[] } {
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
    emitter.signalCode = 'SIGTERM';
    emitter.emit('exit', null, 'SIGTERM');
    return true;
  };
  return { proc: emitter as unknown as ChildProcess, signals };
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

let tmp: string;
const originalEnv = { ...process.env };
const originalCwd = process.cwd();

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'sup-reconnect-'));
  process.env = { ...originalEnv };
  process.env.PATH = tmp;
  process.env.HOME = process.env.USERPROFILE = tmp;
  const cliEntry = path.join(tmp, 'fake-bin.js');
  writeFileSync(cliEntry, '// fake moxxy cli\n');
  process.env.MOXXY_CLI_ENTRY = cliEntry;
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  vi.mocked(connectRemoteSession).mockReset();
});

/** A supervisor whose socket always answers, so no real `moxxy serve` is needed. */
function supervisor(): RunnerSupervisor {
  const sup = new RunnerSupervisor(path.join(tmp, 'serve.sock'));
  const priv = sup as unknown as { probeSocket: () => Promise<boolean> };
  priv.probeSocket = () => Promise.resolve(true);
  return sup;
}

describe('RunnerSupervisor reconnects', () => {
  it('re-attaches to the runner it already runs when only the link dropped, without killing it', async () => {
    vi.mocked(connectRemoteSession)
      .mockResolvedValueOnce(fakeSession(5))
      .mockResolvedValue(fakeSession(null));
    const sup = supervisor();
    const child = fakeChild();
    sup.__setChildForTest(child.proc);
    const phases: string[] = [];
    sup.on('change', (snap) => phases.push(snap.phase.phase));

    void sup.run();
    await waitFor(() => phases.filter((p) => p === 'connected').length === 2, 8000);

    expect(phases).toContain('reconnecting');
    expect(phases).not.toContain('spawning');
    expect(child.signals).toEqual([]);
    expect(sup.__childForTest()).toBe(child.proc);
    await sup.stop();
  });

  it('stops after repeated short-lived connections with a clear error, and Retry starts again', async () => {
    vi.mocked(connectRemoteSession).mockImplementation(() => Promise.resolve(fakeSession(1)));
    const sup = supervisor();
    // Skip the 2 s backoff between attempts so the test runs quickly.
    const nudge = setInterval(() => {
      if (sup.snapshot().phase.phase === 'reconnecting') sup.forceRetry();
    }, 5);

    const loop = sup.run();
    await waitFor(() => sup.snapshot().phase.phase === 'failed', 8000);
    clearInterval(nudge);
    await loop;

    const failed = sup.snapshot().phase;
    expect(failed.phase).toBe('failed');
    if (failed.phase === 'failed') expect(failed.error).toMatch(/runner disconnected/);
    const attempts = vi.mocked(connectRemoteSession).mock.calls.length;
    expect(attempts).toBe(5);

    vi.mocked(connectRemoteSession).mockImplementation(() => Promise.resolve(fakeSession(null)));
    sup.forceRetry();
    await waitFor(() => sup.snapshot().phase.phase === 'connected', 4000);
    await sup.stop();
  });

  it('logs a runner that cannot be started instead of crashing the app', async () => {
    // The socket answers at once, so the wait for it is over before Node
    // reports that the start failed: the workspace folder does not exist.
    vi.mocked(connectRemoteSession).mockResolvedValue(fakeSession(null));
    const sup = supervisor();
    await sup.setCwd(path.join(tmp, 'missing-folder'));

    void sup.run();
    await waitFor(() => sup.snapshot().log.some((entry) => /ENOENT/.test(entry.line)), 8000);
    await sup.stop();
  });

  it('stops the old runner when the workspace folder changes while the link is down', async () => {
    const sup = supervisor();
    const child = fakeChild();
    sup.__setChildForTest(child.proc);
    await sup.setCwd(tmp);
    expect(child.signals).toEqual(['SIGTERM']);
    expect(sup.__childForTest()).not.toBe(child.proc);
    await sup.stop();
  });
});
