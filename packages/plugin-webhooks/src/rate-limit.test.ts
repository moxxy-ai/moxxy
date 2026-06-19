import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.js';

/** A controllable clock so refill is deterministic (no real sleeps). */
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('RateLimiter', () => {
  it('admits up to the burst capacity, then rejects', () => {
    const rl = new RateLimiter({ ratePerSec: 5, burst: 3, now: () => 1000 });
    expect(rl.tryAcquire('a')).toBe(true);
    expect(rl.tryAcquire('a')).toBe(true);
    expect(rl.tryAcquire('a')).toBe(true);
    // Bucket empty, clock frozen → no refill.
    expect(rl.tryAcquire('a')).toBe(false);
    expect(rl.tryAcquire('a')).toBe(false);
  });

  it('refills lazily from elapsed time, clamped to capacity', () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ ratePerSec: 10, burst: 2, now: clock.now });
    expect(rl.tryAcquire('a')).toBe(true);
    expect(rl.tryAcquire('a')).toBe(true);
    expect(rl.tryAcquire('a')).toBe(false);
    // 100ms at 10/s → +1 token.
    clock.advance(100);
    expect(rl.tryAcquire('a')).toBe(true);
    expect(rl.tryAcquire('a')).toBe(false);
    // Idle a long time → refills only to capacity (2), not unbounded burst.
    clock.advance(10_000);
    expect(rl.tryAcquire('a')).toBe(true);
    expect(rl.tryAcquire('a')).toBe(true);
    expect(rl.tryAcquire('a')).toBe(false);
  });

  it('isolates buckets per key', () => {
    const rl = new RateLimiter({ ratePerSec: 1, burst: 1, now: () => 0 });
    expect(rl.tryAcquire('a')).toBe(true);
    expect(rl.tryAcquire('a')).toBe(false);
    // A different key is unaffected.
    expect(rl.tryAcquire('b')).toBe(true);
    expect(rl.tryAcquire('b')).toBe(false);
  });

  it('caps the number of tracked buckets (no unbounded growth on distinct keys)', () => {
    const rl = new RateLimiter({ ratePerSec: 1, burst: 1, maxBuckets: 4, now: () => 0 });
    for (let i = 0; i < 1000; i++) rl.tryAcquire(`key-${i}`);
    expect(rl.size()).toBeLessThanOrEqual(4);
  });

  it('evicts the least-recently-used bucket on overflow', () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ ratePerSec: 1, burst: 1, maxBuckets: 2, now: clock.now });
    rl.tryAcquire('a'); // a consumed
    clock.advance(1);
    rl.tryAcquire('b'); // b consumed; map = {a, b}
    clock.advance(1);
    rl.tryAcquire('a'); // touch a → a now MRU; map order = {b, a}
    clock.advance(1);
    rl.tryAcquire('c'); // overflow → evicts LRU (b); map = {a, c}
    expect(rl.size()).toBe(2);
    // a survived → still rate-limited (token already spent, clock barely moved).
    // b was evicted → fresh full bucket → admitted.
    clock.advance(1);
    expect(rl.tryAcquire('b')).toBe(true);
  });

  it('degrades gracefully on hostile/degenerate config (NaN/negative → safe defaults)', () => {
    const rl = new RateLimiter({
      ratePerSec: Number.NaN,
      burst: -5,
      maxBuckets: 0,
      now: () => 0,
    });
    // Must not NaN-poison or disable limiting: a token is still acquirable, and
    // the bucket eventually empties rather than admitting forever.
    let admitted = 0;
    for (let i = 0; i < 1000; i++) if (rl.tryAcquire('a')) admitted++;
    expect(admitted).toBeGreaterThan(0);
    expect(admitted).toBeLessThan(1000);
    expect(rl.size()).toBeGreaterThanOrEqual(1);
  });

  it('clear() empties all buckets', () => {
    const rl = new RateLimiter({ ratePerSec: 1, burst: 1, now: () => 0 });
    rl.tryAcquire('a');
    rl.tryAcquire('b');
    expect(rl.size()).toBe(2);
    rl.clear();
    expect(rl.size()).toBe(0);
  });
});
