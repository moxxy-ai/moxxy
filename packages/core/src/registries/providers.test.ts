import { describe, expect, it } from 'vitest';
import type { AgentTurnStart, LLMProvider, ProviderDef } from '@moxxy/sdk';
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

describe('ProviderRegistry turns an agent starts by itself', () => {
  function agentDef(name: string): { def: ProviderDef; start: (sessionId: string, name: string) => void } {
    const listeners = new Set<(start: AgentTurnStart) => void>();
    const client = {
      name,
      models: [],
      onAgentTurn: (listener: (start: AgentTurnStart) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as LLMProvider;
    return {
      def: { name, models: [], createClient: () => client } as unknown as ProviderDef,
      start: (sessionId, turn) => {
        for (const listener of [...listeners]) listener({ sessionId, name: turn });
      },
    };
  }

  it('passes on a turn the active agent started, and none from an agent no longer active', () => {
    const reg = new ProviderRegistry();
    const claude = agentDef('claude');
    reg.register(claude.def);
    reg.register(def('other'));
    const seen: AgentTurnStart[] = [];
    reg.onAgentTurn((start) => seen.push(start));

    reg.setActive('claude');
    claude.start('s1', 'List files finished in the background');
    reg.setActive('other');
    claude.start('s1', 'Too late');

    expect(seen).toEqual([{ sessionId: 's1', name: 'List files finished in the background' }]);
  });
});
