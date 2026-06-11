import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng.js';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    expect(mulberry32(1).next()).not.toBe(mulberry32(2).next());
  });

  it('next() stays in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) stays in [0, n)', () => {
    const r = mulberry32(9);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('pick() returns elements of the array and eventually all of them', () => {
    const r = mulberry32(11);
    const arr = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const v = r.pick(arr);
      expect(arr).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
  });
});
