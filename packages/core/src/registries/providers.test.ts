import { describe, expect, it } from 'vitest';
import type { LLMProvider, ProviderDef } from '@moxxy/sdk';
import { ProviderRegistry } from './providers.js';

function def(name: string): ProviderDef {
  return {
    name,
    models: [{ id: `${name}-model`, contextWindow: 1000 }],
    createClient: () => ({ name, models: [] }) as unknown as LLMProvider,
  } as ProviderDef;
}

describe('ProviderRegistry enable/disable', () => {
  it('providers are enabled by default; disabling blocks setActive', () => {
    const reg = new ProviderRegistry();
    reg.register(def('a'));
    expect(reg.isEnabled('a')).toBe(true);

    reg.setEnabled('a', false);
    expect(reg.isEnabled('a')).toBe(false);
    expect(() => reg.setActive('a')).toThrow(/disabled/);

    reg.setEnabled('a', true);
    expect(() => reg.setActive('a')).not.toThrow();
  });

  it('refuses to disable the ACTIVE provider', () => {
    const reg = new ProviderRegistry();
    reg.register(def('a'));
    reg.setActive('a');
    expect(() => reg.setEnabled('a', false)).toThrow(/active provider/i);
    // Still enabled after the refused toggle.
    expect(reg.isEnabled('a')).toBe(true);
  });

  it('accepts seeding unknown names before their defs register (boot order)', () => {
    const reg = new ProviderRegistry();
    reg.setEnabled('later', false);
    reg.register(def('later'));
    expect(reg.isEnabled('later')).toBe(false);
    expect(() => reg.setActive('later')).toThrow(/disabled/);
  });

  it('keeps disabled providers listed (visible but inactive)', () => {
    const reg = new ProviderRegistry();
    reg.register(def('a'));
    reg.setEnabled('a', false);
    expect(reg.list().map((d) => d.name)).toContain('a');
  });
});
