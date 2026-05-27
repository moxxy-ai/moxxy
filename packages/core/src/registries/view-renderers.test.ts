import { describe, expect, it } from 'vitest';
import type { ViewRendererDef } from '@moxxy/sdk';
import { ViewRendererRegistry } from './view-renderers.js';

const mk = (name: string): ViewRendererDef => ({
  name,
  allowList: [],
  parse: () => ({ ok: false, errors: [{ message: name }] }),
  validate: () => [],
});

describe('ViewRendererRegistry', () => {
  it('auto-activates the first registered renderer', () => {
    const r = new ViewRendererRegistry();
    expect(r.getActive()).toBeNull();
    r.register(mk('a'));
    expect(r.getActive()?.name).toBe('a');
    r.register(mk('b'));
    expect(r.getActive()?.name).toBe('a'); // still the first
  });

  it('throws on duplicate register', () => {
    const r = new ViewRendererRegistry();
    r.register(mk('a'));
    expect(() => r.register(mk('a'))).toThrow(/already registered/);
  });

  it('replace overwrites without throwing and keeps active', () => {
    const r = new ViewRendererRegistry();
    r.register(mk('a'));
    const replacement = mk('a');
    r.replace(replacement);
    expect(r.getActive()).toBe(replacement);
    expect(r.list()).toHaveLength(1);
  });

  it('replace on empty registry auto-activates', () => {
    const r = new ViewRendererRegistry();
    r.replace(mk('a'));
    expect(r.getActive()?.name).toBe('a');
  });

  it('setActive switches; throws for unknown', () => {
    const r = new ViewRendererRegistry();
    r.register(mk('a'));
    r.register(mk('b'));
    r.setActive('b');
    expect(r.getActive()?.name).toBe('b');
    expect(() => r.setActive('nope')).toThrow(/not registered/);
  });

  it('unregister clears the active slot rather than picking a successor', () => {
    const r = new ViewRendererRegistry();
    r.register(mk('a'));
    r.register(mk('b'));
    r.unregister('a');
    expect(r.getActive()).toBeNull();
    expect(r.list().map((x) => x.name)).toEqual(['b']);
  });

  it('unregistering a non-active renderer leaves active intact', () => {
    const r = new ViewRendererRegistry();
    r.register(mk('a'));
    r.register(mk('b'));
    r.unregister('b');
    expect(r.getActive()?.name).toBe('a');
  });
});
