import { describe, expect, it } from 'vitest';
import { createStuckLoopDetector, stableHash } from './mode-helpers.js';

describe('createStuckLoopDetector', () => {
  it('trips on exact-input repeats at repeatThreshold', () => {
    const d = createStuckLoopDetector(); // repeatThreshold 3
    const input = { x: 1 };
    expect(d.record('Read', input).stuck).toBe(false);
    expect(d.record('Read', input).stuck).toBe(false);
    const sig = d.record('Read', input);
    expect(sig).toMatchObject({ stuck: true, count: 3, kind: 'exact' });
  });

  it('trips on same-target near-dups even when volatile args vary', () => {
    const d = createStuckLoopDetector(); // nearThreshold 5
    const url = 'https://example.com/big';
    // Same url, different maxBytes each time — exact check never fires.
    for (let i = 0; i < 4; i++) {
      expect(d.record('web_fetch', { url, maxBytes: 1000 * (i + 1) }).stuck).toBe(false);
    }
    const sig = d.record('web_fetch', { url, maxBytes: 99_000 });
    expect(sig).toMatchObject({ stuck: true, kind: 'near' });
    expect(sig.count).toBeGreaterThanOrEqual(5);
  });

  it('does NOT trip on distinct targets (legit multi-source fetching)', () => {
    const d = createStuckLoopDetector();
    for (let i = 0; i < 7; i++) {
      const sig = d.record('web_fetch', { url: `https://example.com/page-${i}`, maxBytes: 8000 });
      expect(sig.stuck).toBe(false);
    }
  });

  it('ignores near-dups for tools with no identity arg', () => {
    const d = createStuckLoopDetector();
    // No url/path/command field — near tracking is skipped; only exact applies.
    for (let i = 0; i < 6; i++) {
      const sig = d.record('think', { note: `step ${i}` });
      expect(sig.stuck).toBe(false);
    }
  });

  // record() hashes the (model-supplied, `unknown`) tool input in the hot
  // dispatch path; a throw there crashes the whole turn. These assert it stays
  // total on hostile/partial input — the worst case the provider can hand us.
  it('does not throw recording a tool input with a circular reference', () => {
    const d = createStuckLoopDetector();
    const input: Record<string, unknown> = { a: 1 };
    input.self = input;
    expect(() => d.record('weird', input)).not.toThrow();
    // And a repeated circular input still trips exact detection (stable key).
    d.record('weird', input);
    expect(d.record('weird', input).stuck).toBe(true);
  });

  it('does not throw recording a tool input that carries a BigInt', () => {
    const d = createStuckLoopDetector();
    expect(() => d.record('weird', { n: 10n })).not.toThrow();
  });

  it('does not throw on a pathologically deep tool input', () => {
    const d = createStuckLoopDetector();
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 5000; i++) {
      const next: Record<string, unknown> = {};
      deep.child = next;
      deep = next;
    }
    expect(() => d.record('weird', root)).not.toThrow();
  });
});

describe('stableHash', () => {
  it('is key-order canonical', () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
  });

  it('returns a string (never throws) on circular, BigInt, and non-finite input', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof stableHash(circular)).toBe('string');
    expect(typeof stableHash({ n: 9007199254740993n })).toBe('string');
    expect(typeof stableHash({ x: Number.NaN, y: Infinity })).toBe('string');
  });

  it('distinguishes a BigInt from the equal-valued number', () => {
    expect(stableHash({ n: 1n })).not.toBe(stableHash({ n: 1 }));
  });

  it('does not flag a shared (non-cyclic) sub-object as circular', () => {
    const shared = { k: 'v' };
    // Same object in two sibling positions is a DAG, not a cycle.
    expect(stableHash({ a: shared, b: shared })).toBe(
      stableHash({ a: { k: 'v' }, b: { k: 'v' } }),
    );
  });

  it('never throws even when a value trap / getter throws', () => {
    const hostileProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap throws');
        },
      },
    );
    expect(() => stableHash({ x: hostileProxy })).not.toThrow();
    const throwingGetter = Object.defineProperty({}, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter throws');
      },
    });
    expect(() => stableHash(throwingGetter)).not.toThrow();
    expect(typeof stableHash(throwingGetter)).toBe('string');
  });
});
