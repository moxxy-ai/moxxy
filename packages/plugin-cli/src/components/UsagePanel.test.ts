import { describe, expect, it } from 'vitest';
import { peak } from './UsagePanel.js';

describe('peak (UsagePanel)', () => {
  it('matches Math.max for small series (output-identical)', () => {
    for (const s of [[], [0], [5], [1, 2, 3], [3, 1, 2], [-1, -2], [0, 0, 0]]) {
      expect(peak(s)).toBe(Math.max(...s, 0));
    }
  });

  it('peaks over a huge series without RangeError where the spread throws', () => {
    const n = 500_000;
    const series = new Array<number>(n);
    for (let i = 0; i < n; i += 1) series[i] = i % 7919; // bounded, deterministic
    // The old inline form spreads the whole array as call args and throws.
    expect(() => Math.max(...series, 0)).toThrow(RangeError);
    // The reduce-based helper does not, and returns the true max.
    expect(peak(series)).toBe(7918);
  });

  it('honours the seed floor (negative-only series clamps to 0)', () => {
    expect(peak([-5, -3, -10])).toBe(0);
    expect(peak([-5, -3, -10], -1)).toBe(-1);
  });
});
