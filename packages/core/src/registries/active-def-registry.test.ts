import { describe, expect, it } from 'vitest';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * Contract test for the shared base behind compactors, cache-strategies,
 * view-renderers, tunnel-providers and workflow-executors. The five concrete
 * subclasses keep thin sanity tests; the invariants live here once.
 */

interface Thing {
  name: string;
  v?: number;
}
const mk = (name: string, v?: number): Thing => ({ name, v });

describe('ActiveDefRegistry (shared base)', () => {
  it('getActive() is null when empty', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing' });
    expect(r.getActive()).toBeNull();
    expect(r.getActiveName()).toBeNull();
    expect(r.list()).toEqual([]);
  });

  it('auto-activates the first registered def and keeps it on later registers', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing' });
    r.register(mk('a'));
    expect(r.getActive()?.name).toBe('a');
    expect(r.getActiveName()).toBe('a');
    r.register(mk('b'));
    expect(r.getActive()?.name).toBe('a'); // still the first
  });

  it('throws the exact noun-prefixed message on duplicate register', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing' });
    r.register(mk('a'));
    expect(() => r.register(mk('a'))).toThrow('Thing already registered: a');
  });

  it('replace overwrites without throwing and keeps active', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing' });
    r.register(mk('a', 1));
    const replacement = mk('a', 2);
    r.replace(replacement);
    expect(r.getActive()).toBe(replacement);
    expect(r.getActive()?.v).toBe(2);
    expect(r.list()).toHaveLength(1);
  });

  it('replace on empty registry auto-activates', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing' });
    r.replace(mk('a'));
    expect(r.getActive()?.name).toBe('a');
  });

  it('setActive switches; throws the exact noun-prefixed message for unknown', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing' });
    r.register(mk('a'));
    r.register(mk('b'));
    r.setActive('b');
    expect(r.getActive()?.name).toBe('b');
    expect(() => r.setActive('nope')).toThrow('Thing not registered: nope');
  });

  it('unregister clears the active slot rather than picking a successor', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing' });
    r.register(mk('a'));
    r.register(mk('b'));
    r.unregister('a');
    expect(r.getActive()).toBeNull();
    expect(r.getActiveName()).toBeNull();
    expect(r.list().map((x) => x.name)).toEqual(['b']);
  });

  it('unregistering a non-active def leaves active intact', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing' });
    r.register(mk('a'));
    r.register(mk('b'));
    r.unregister('b');
    expect(r.getActive()?.name).toBe('a');
  });

  it('has() reflects membership; clearActive() deactivates without removing', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing' });
    r.register(mk('a'));
    expect(r.has('a')).toBe(true);
    expect(r.has('z')).toBe(false);
    r.clearActive();
    expect(r.getActive()).toBeNull();
    expect(r.getActiveName()).toBeNull();
    expect(r.has('a')).toBe(true); // still registered, just not active
    r.setActive('a');
    expect(r.getActive()?.name).toBe('a');
  });

  it('autoAdoptFirst:false leaves nothing active until setActive', () => {
    const r = new ActiveDefRegistry<Thing>({ noun: 'Thing', autoAdoptFirst: false });
    r.register(mk('a'));
    r.replace(mk('b'));
    expect(r.getActive()).toBeNull();
    r.setActive('a');
    expect(r.getActive()?.name).toBe('a');
  });
});
