import { mkdtemp, rm, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CrossProcessFireLock } from './cross-process-lock.js';

describe('CrossProcessFireLock', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-xproc-lock-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('claims a key exactly once — the first caller wins, the rest lose', async () => {
    const lock = new CrossProcessFireLock({ dir });
    // Fire many concurrent claims for the SAME key — exactly one must win, which
    // is the whole point: N runners racing the same due fire → one runs it.
    const results = await Promise.all(Array.from({ length: 8 }, () => lock.claim('sched@1000')));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('distinct keys never block each other', async () => {
    const lock = new CrossProcessFireLock({ dir });
    expect(await lock.claim('a@1')).toBe(true);
    expect(await lock.claim('b@1')).toBe(true);
    // ...but re-claiming either is denied.
    expect(await lock.claim('a@1')).toBe(false);
    expect(await lock.claim('b@1')).toBe(false);
  });

  it('two lock instances over the same dir still arbitrate (separate processes)', async () => {
    const a = new CrossProcessFireLock({ dir });
    const b = new CrossProcessFireLock({ dir });
    expect(await a.claim('k@1')).toBe(true);
    expect(await b.claim('k@1')).toBe(false);
  });

  it('reclaims a stale marker once its TTL elapses (crashed holder)', async () => {
    const ttlMs = 1_000;
    const lock = new CrossProcessFireLock({ dir, ttlMs });
    expect(await lock.claim('k@1')).toBe(true);
    expect(await lock.claim('k@1')).toBe(false);
    // The previous holder "crashed": advance the CLOCK past the TTL rather than
    // sleeping, so the test asserts the staleness rule and not the accuracy of
    // a timer on a loaded machine.
    expect(await lock.claim('k@1', Date.now() + ttlMs * 5)).toBe(true);
  });

  // Age is set on the FILES and the clock is passed in, rather than produced by
  // sleeping. Expiry is `now - mtime > ttlMs`, so a sleep-based version races
  // the scheduler: any pause between claiming the fresh marker and sweeping
  // that exceeds the TTL expires it too, and a short TTL makes that pause
  // trivial to hit on a loaded machine.
  it('sweep removes expired markers and leaves fresh ones', async () => {
    const ttlMs = 1_000;
    const lock = new CrossProcessFireLock({ dir, ttlMs });
    await lock.claim('old@1');
    await lock.claim('fresh@1');

    const now = Date.now();
    const stale = new Date(now - ttlMs * 5);
    await utimes(join(dir, 'old@1.lock'), stale, stale);
    await utimes(join(dir, 'fresh@1.lock'), new Date(now), new Date(now));

    expect(await lock.sweep(now)).toBe(1);
    expect(await readdir(dir)).toEqual(['fresh@1.lock']);
  });

  it('sanitizes unsafe key characters into a single marker file', async () => {
    const lock = new CrossProcessFireLock({ dir });
    expect(await lock.claim('wf-file:my-flow::src/**/*.ts')).toBe(true);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]!.endsWith('.lock')).toBe(true);
    // No path separators leak into the dir (no traversal).
    expect(files[0]).not.toContain('/');
  });
});
