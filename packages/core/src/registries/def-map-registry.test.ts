import { describe, expect, it } from 'vitest';
import { DefMapRegistry } from './def-map-registry.js';

/**
 * Contract test for the shared base behind agents, channels and surfaces.
 * Covers the default `name`-keyed shape and a `kind`-keyed variant (surfaces).
 */

interface NamedThing {
  name: string;
  v?: number;
}
const named = (name: string, v?: number): NamedThing => ({ name, v });

interface KindThing {
  kind: string;
}

describe('DefMapRegistry (shared base)', () => {
  const make = () =>
    new DefMapRegistry<NamedThing>({ noun: 'Thing', keyOf: (d) => d.name });

  it('register / get / has / list round-trip', () => {
    const r = make();
    expect(r.list()).toEqual([]);
    expect(r.get('a')).toBeUndefined();
    expect(r.has('a')).toBe(false);
    const a = named('a');
    r.register(a);
    expect(r.get('a')).toBe(a);
    expect(r.has('a')).toBe(true);
    r.register(named('b'));
    expect(r.list().map((x) => x.name)).toEqual(['a', 'b']);
  });

  it('throws the exact noun-prefixed message on duplicate register', () => {
    const r = make();
    r.register(named('a'));
    expect(() => r.register(named('a'))).toThrow('Thing already registered: a');
  });

  it('replace overwrites without throwing', () => {
    const r = make();
    r.register(named('a', 1));
    r.replace(named('a', 2));
    expect(r.get('a')?.v).toBe(2);
    expect(r.list()).toHaveLength(1);
  });

  it('unregister removes by key', () => {
    const r = make();
    r.register(named('a'));
    r.register(named('b'));
    r.unregister('a');
    expect(r.has('a')).toBe(false);
    expect(r.list().map((x) => x.name)).toEqual(['b']);
  });

  it('supports a non-name key field (kind) and interpolates it in the error', () => {
    const r = new DefMapRegistry<KindThing>({ noun: 'Surface', keyOf: (d) => d.kind });
    r.register({ kind: 'terminal' });
    expect(r.get('terminal')).toEqual({ kind: 'terminal' });
    expect(() => r.register({ kind: 'terminal' })).toThrow('Surface already registered: terminal');
    r.unregister('terminal');
    expect(r.has('terminal')).toBe(false);
  });
});
