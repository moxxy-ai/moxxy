import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readActiveCollab, releaseCollabLock, tryAcquireCollabLock } from './collab-lock.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-lock-'));
  process.env.MOXXY_COLLAB_LOCK = join(dir, 'active.lock');
});
afterEach(() => {
  delete process.env.MOXXY_COLLAB_LOCK;
  rmSync(dir, { recursive: true, force: true });
});

describe('collab single-flight lock', () => {
  it('grants the lock when free and reports the holder to others', () => {
    expect(readActiveCollab()).toBeNull();
    expect(tryAcquireCollabLock({ sessionId: 'A', task: 'build X', startedAtMs: 1 }).ok).toBe(true);

    const second = tryAcquireCollabLock({ sessionId: 'B', task: 'build Y', startedAtMs: 2 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.holder.task).toBe('build X');

    // the same session re-acquiring is idempotent
    expect(tryAcquireCollabLock({ sessionId: 'A', task: 'build X', startedAtMs: 3 }).ok).toBe(true);
  });

  it('releases only when the holding session releases', () => {
    tryAcquireCollabLock({ sessionId: 'A', task: 't', startedAtMs: 1 });
    releaseCollabLock('B'); // not the holder — no-op
    expect(readActiveCollab()?.sessionId).toBe('A');
    releaseCollabLock('A');
    expect(readActiveCollab()).toBeNull();
    // now free for another session
    expect(tryAcquireCollabLock({ sessionId: 'B', task: 't2', startedAtMs: 2 }).ok).toBe(true);
  });

  it('reclaims a stale lock whose process is dead', () => {
    // A lock owned by a definitely-dead pid is reclaimed on read.
    writeFileSync(
      process.env.MOXXY_COLLAB_LOCK!,
      JSON.stringify({ pid: 2147483646, sessionId: 'ghost', task: 'old', startedAtMs: 1 }),
    );
    expect(readActiveCollab()).toBeNull();
    expect(tryAcquireCollabLock({ sessionId: 'A', task: 'fresh', startedAtMs: 2 }).ok).toBe(true);
  });
});
