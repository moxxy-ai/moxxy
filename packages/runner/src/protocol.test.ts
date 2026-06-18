import { describe, expect, it } from 'vitest';
import { surfaceInputParamsSchema } from './protocol.js';

// The fast-path size guard on surfaceInputParamsSchema MUST accept/reject the
// EXACT same set of messages as the prior unconditional
// `JSON.stringify(m).length <= 1_000_000` check — otherwise it would be a wire
// contract change. We compare the schema's accept decision against that exact
// reference across small, large, many-key, and over-cap inputs.

const MAX = 1_000_000;

// The exact pre-optimization predicate.
const exactWithinCap = (m: Record<string, unknown>): boolean =>
  JSON.stringify(m).length <= MAX;

const accepts = (message: Record<string, unknown>): boolean =>
  surfaceInputParamsSchema.safeParse({ surfaceId: 's1', message }).success;

describe('surfaceInputParamsSchema size guard (byte-identical to JSON.stringify cap)', () => {
  const cases: Record<string, unknown>[] = [
    // Tiny keystroke / control frames (the hot path).
    { type: 'data', data: 'a' },
    { type: 'key', key: 'Enter' },
    { type: 'click', fx: 0.5, fy: 0.5 },
    { type: 'scroll', dy: -120 },
    { type: 'navigate', url: 'https://example.com/some/path?q=1' },
    // Booleans / null / mixed primitives.
    { type: 'x', a: true, b: false, c: null, n: 1234567 },
    // Empty-ish.
    { type: 't' },
    // Medium paste, comfortably under the cap.
    { type: 'data', data: 'P'.repeat(100_000) },
    // Large but under the exact cap (~990 KB serialized).
    { type: 'data', data: 'Q'.repeat(990_000) },
    // Right at/over the boundary — exercises the exact fallback.
    { type: 'data', data: 'R'.repeat(1_000_000) },
    { type: 'data', data: 'S'.repeat(1_100_000) },
    // Escape-heavy strings (worst-case serialization is far larger than length).
    { type: 'data', data: '\n'.repeat(50_000) },
    { type: 'data', data: '"'.repeat(150_000) },
    // Many short keys — structural overhead, not string bytes, drives the size.
    Object.assign(
      { type: 'many' },
      Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, ''])),
    ),
    // Many short keys near the cap.
    Object.assign(
      { type: 'many' },
      Object.fromEntries(Array.from({ length: 90_000 }, (_, i) => [`k${i}`, ''])),
    ),
    // Nested object (forces the exact slow path) under cap.
    { type: 'nested', payload: { a: 'b'.repeat(1000), c: [1, 2, 3] } },
    // Nested object over cap.
    { type: 'nested', payload: { a: 'b'.repeat(1_100_000) } },
  ];

  it('matches the exact JSON.stringify cap on every representative message', () => {
    for (const message of cases) {
      expect(accepts(message)).toBe(exactWithinCap(message));
    }
  });

  it('randomized fuzz: fast path never diverges from the exact cap', () => {
    let s = 31337;
    const rand = () => ((s = (s * 1664525 + 1013904329) >>> 0) / 0x100000000);
    const chars = ['a', 'b', '\n', '"', '\\', 'z', ' '];
    for (let trial = 0; trial < 300; trial++) {
      const message: Record<string, unknown> = { type: 'fuzz' };
      const keys = Math.floor(rand() * 6);
      for (let k = 0; k < keys; k++) {
        const pick = rand();
        const name = `f${k}`;
        if (pick < 0.5) {
          const len = Math.floor(rand() * rand() * 1_300_000); // skew small, sometimes huge
          const ch = chars[Math.floor(rand() * chars.length)]!;
          message[name] = ch.repeat(len);
        } else if (pick < 0.7) {
          message[name] = Math.floor(rand() * 1e9);
        } else if (pick < 0.85) {
          message[name] = rand() < 0.5;
        } else {
          message[name] = null;
        }
      }
      expect(accepts(message)).toBe(exactWithinCap(message));
    }
  });
});
