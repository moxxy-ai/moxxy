import { describe, expect, it } from 'vitest';
import { pretty } from './block-shared';

describe('pretty — bounded tool-body rendering', () => {
  it('passes through small values unchanged', () => {
    expect(pretty({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(pretty('hello')).toBe('hello');
  });

  it('caps a multi-MB string so it cannot blow up the DOM', () => {
    const huge = 'x'.repeat(5_000_000);
    const out = pretty(huge);
    expect(out.length).toBeLessThan(huge.length);
    expect(out.length).toBeLessThan(200_000);
    expect(out).toContain('more chars truncated');
  });

  it('caps a huge JSON payload (stringified) too', () => {
    const out = pretty({ blob: 'y'.repeat(2_000_000) });
    expect(out.length).toBeLessThan(200_000);
    expect(out).toContain('more chars truncated');
  });

  it('does not throw on a circular structure, falling back to a bounded string', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(() => pretty(obj)).not.toThrow();
    expect(typeof pretty(obj)).toBe('string');
  });
});
