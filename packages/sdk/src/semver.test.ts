import { describe, expect, it } from 'vitest';
import { compareSemver, parseSemverCore } from './semver.js';

describe('compareSemver', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareSemver('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareSemver('1.1.2', '1.1.10')).toBeLessThan(0);
    expect(compareSemver('3.4.5', '3.4.5')).toBe(0);
  });

  it('normalizes to -1 / 0 / 1', () => {
    expect(compareSemver('0.0.1', '0.0.2')).toBe(-1);
    expect(compareSemver('0.0.2', '0.0.1')).toBe(1);
    expect(compareSemver('0.0.1', '0.0.1')).toBe(0);
  });

  it('ignores prerelease/build suffixes (bare-tag precedence)', () => {
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0+build2', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0', '1.0.0+build9')).toBe(0);
  });

  it('treats missing/garbage segments as 0', () => {
    expect(compareSemver('1', '1.0.0')).toBe(0);
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('vX.Y.Z', '0.0.0')).toBe(0);
  });

  it('sorts ascending with a deterministic call-site tie-break', () => {
    const tags = ['1.2.0', '1.10.0', '1.2.0+b', '1.1.0'];
    const sorted = [...tags].sort((a, b) => compareSemver(a, b) || a.localeCompare(b));
    expect(sorted).toEqual(['1.1.0', '1.2.0', '1.2.0+b', '1.10.0']);
  });
});

describe('parseSemverCore', () => {
  it('extracts the numeric core', () => {
    expect(parseSemverCore('12.3.45-rc.1')).toEqual([12, 3, 45]);
    expect(parseSemverCore('0.0.0')).toEqual([0, 0, 0]);
    expect(parseSemverCore('7')).toEqual([7, 0, 0]);
  });
});
