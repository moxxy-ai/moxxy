import { describe, expect, it } from 'vitest';
import { mergeConfigs } from './merge.js';

describe('mergeConfigs', () => {
  it('returns empty for no inputs', () => {
    expect(mergeConfigs()).toEqual({});
  });

  it('passes through a single config unchanged', () => {
    const a = { provider: { name: 'anthropic', model: 'sonnet' } };
    expect(mergeConfigs(a)).toEqual(a);
  });

  it('later wins on scalar fields', () => {
    const a = { provider: { name: 'anthropic', model: 'haiku' } };
    const b = { provider: { name: 'anthropic', model: 'sonnet' } };
    expect(mergeConfigs(a, b).provider?.model).toBe('sonnet');
  });

  it('merges nested objects key-by-key', () => {
    const a = { plugins: { 'a': { enabled: true } } };
    const b = { plugins: { 'b': { enabled: false } } };
    expect(mergeConfigs(a, b).plugins).toEqual({
      a: { enabled: true },
      b: { enabled: false },
    });
  });

  it('skips undefined entries', () => {
    expect(mergeConfigs(undefined, { provider: { name: 'x' } }, undefined)).toEqual({
      provider: { name: 'x' },
    });
  });

  it('concatenates arrays rather than replacing', () => {
    const a = { permissions: { allow: [{ name: 'Read' }] } };
    const b = { permissions: { allow: [{ name: 'Edit' }] } };
    expect(mergeConfigs(a, b).permissions?.allow).toEqual([{ name: 'Read' }, { name: 'Edit' }]);
  });

  it('merges plugin-specific options deeply', () => {
    const a = { plugins: { p: { options: { a: 1, deep: { x: 1 } } } } };
    const b = { plugins: { p: { options: { b: 2, deep: { y: 2 } } } } };
    expect(mergeConfigs(a, b).plugins?.p?.options).toEqual({
      a: 1,
      b: 2,
      deep: { x: 1, y: 2 },
    });
  });

  it('ignores a literal __proto__ key without corrupting the merged object', () => {
    // A parsed config (JSON default-export / some YAML) can carry an own
    // enumerable `__proto__`; assigning it would hit the prototype setter,
    // silently drop the data AND replace the result's prototype.
    const malicious = JSON.parse('{"mode":"goal","__proto__":{"polluted":true}}') as Record<
      string,
      unknown
    >;
    const out = mergeConfigs(malicious as never) as Record<string, unknown>;
    expect(out.mode).toBe('goal');
    // No prototype pollution leaked onto Object.prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // The merged object keeps a plain-object prototype (not corrupted).
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect('polluted' in out).toBe(false);
  });

  it('ignores literal constructor / prototype keys', () => {
    const src = JSON.parse('{"mode":"x","constructor":{"bad":1},"prototype":{"bad":2}}') as Record<
      string,
      unknown
    >;
    const out = mergeConfigs(src as never) as Record<string, unknown>;
    expect(out.mode).toBe('x');
    expect(typeof out.constructor).toBe('function');
    expect('prototype' in out).toBe(false);
  });
});
