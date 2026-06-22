import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryDedupeCache } from './dedupe.js';

describe('DeliveryDedupeCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('admits a new key once, then rejects the repeat', () => {
    const c = new DeliveryDedupeCache();
    expect(c.check('t1', 'evt_1')).toBe(true);
    expect(c.check('t1', 'evt_1')).toBe(false);
    expect(c.check('t1', 'evt_1')).toBe(false);
  });

  it('keys are scoped by triggerId', () => {
    const c = new DeliveryDedupeCache();
    expect(c.check('t1', 'evt_1')).toBe(true);
    // Same delivery key on a different trigger is still new.
    expect(c.check('t2', 'evt_1')).toBe(true);
    expect(c.check('t1', 'evt_1')).toBe(false);
  });

  it('re-admits a key after its TTL has elapsed', () => {
    const c = new DeliveryDedupeCache({ ttlMs: 1000 });
    expect(c.check('t', 'k')).toBe(true);
    expect(c.check('t', 'k')).toBe(false);
    // Just before expiry: still a duplicate.
    vi.setSystemTime(1000);
    expect(c.check('t', 'k')).toBe(false);
    // Past the TTL window: the prior entry is evicted and the key is new again.
    vi.setSystemTime(2001);
    expect(c.check('t', 'k')).toBe(true);
  });

  it('a duplicate hit refreshes recency so the key survives overflow eviction', () => {
    const c = new DeliveryDedupeCache({ maxEntries: 3 });
    expect(c.check('t', 'a')).toBe(true); // tail: a
    vi.setSystemTime(1);
    expect(c.check('t', 'b')).toBe(true); // tail: a, b
    vi.setSystemTime(2);
    // Re-hit 'a' so it is moved to the tail (most recent): order b, a
    expect(c.check('t', 'a')).toBe(false);
    vi.setSystemTime(3);
    expect(c.check('t', 'c')).toBe(true); // order: b, a, c (size 3)
    vi.setSystemTime(4);
    // Overflow: 'd' evicts the oldest, which is now 'b' (refreshing 'a' kept it).
    expect(c.check('t', 'd')).toBe(true); // order now: a, c, d (b dropped)
    // 'a' survived the overflow because the earlier re-hit moved it past 'b'.
    expect(c.check('t', 'a')).toBe(false);
  });

  it('evicts the oldest entry once maxEntries is exceeded', () => {
    const c = new DeliveryDedupeCache({ maxEntries: 2 });
    expect(c.check('t', 'a')).toBe(true);
    vi.setSystemTime(1);
    expect(c.check('t', 'b')).toBe(true);
    expect(c.size()).toBe(2);
    vi.setSystemTime(2);
    expect(c.check('t', 'c')).toBe(true); // evicts 'a'
    expect(c.size()).toBe(2);
    expect(c.check('t', 'a')).toBe(true); // 'a' was dropped -> new again
  });

  it('evictExpired stops at the first fresh entry (insertion-order invariant)', () => {
    const c = new DeliveryDedupeCache({ ttlMs: 100 });
    expect(c.check('t', 'old')).toBe(true); // ts=0
    vi.setSystemTime(50);
    expect(c.check('t', 'mid')).toBe(true); // ts=50
    vi.setSystemTime(150);
    // 'old' (ts=0) is now expired (cutoff=50); 'mid' (ts=50) is still fresh (>= cutoff).
    expect(c.check('t', 'new')).toBe(true); // triggers evictExpired
    expect(c.size()).toBe(2); // only 'old' dropped, 'mid' kept, 'new' added
    expect(c.check('t', 'old')).toBe(true); // re-admitted
    expect(c.check('t', 'mid')).toBe(false); // still present
  });

  it('re-admits an expired key even when the full TTL sweep is throttled', () => {
    // sweepEveryMs far larger than the TTL: the background sweep won't run on
    // the second check, but the per-key TTL check must still re-admit the key
    // (otherwise a throttled sweep would re-fire the same delivery forever).
    const c = new DeliveryDedupeCache({ ttlMs: 100, sweepEveryMs: 1_000_000 });
    expect(c.check('t', 'k')).toBe(true); // ts=0, runs the first sweep
    expect(c.check('t', 'k')).toBe(false); // still fresh
    vi.setSystemTime(101); // past TTL, but the sweep is throttled out
    expect(c.check('t', 'k')).toBe(true); // re-admitted via the per-key TTL check
  });

  it('clear() empties the cache', () => {
    const c = new DeliveryDedupeCache();
    c.check('t', 'a');
    c.check('t', 'b');
    expect(c.size()).toBe(2);
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.check('t', 'a')).toBe(true);
  });
});
