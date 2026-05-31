import { describe, expect, it } from 'vitest';
import type { Synthesizer, SynthesizerDef } from '@moxxy/sdk';
import { SynthesizerRegistry } from './synthesizers.js';

function def(name: string, onCreate?: (ctx: { getSecret?: (n: string) => Promise<string | null> }) => void): SynthesizerDef {
  return {
    name,
    create: (ctx): Synthesizer => {
      onCreate?.(ctx);
      return {
        name,
        synthesize: async () => ({ audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/mpeg' }),
      };
    },
  };
}

describe('SynthesizerRegistry', () => {
  it('auto-activates the first registered synthesizer', () => {
    const reg = new SynthesizerRegistry();
    expect(reg.getActiveName()).toBeNull();
    reg.register(def('elevenlabs'));
    expect(reg.getActiveName()).toBe('elevenlabs');
    // A second registration does NOT steal the active slot.
    reg.register(def('openai'));
    expect(reg.getActiveName()).toBe('elevenlabs');
  });

  it('setActive / clearActive switch the active backend', () => {
    const reg = new SynthesizerRegistry();
    reg.register(def('elevenlabs'));
    reg.register(def('openai'));
    reg.setActive('openai');
    expect(reg.getActiveName()).toBe('openai');
    reg.clearActive();
    expect(reg.getActiveName()).toBeNull();
    expect(reg.tryGetActive()).toBeNull();
  });

  it('unregistering the active backend clears active', () => {
    const reg = new SynthesizerRegistry();
    reg.register(def('elevenlabs'));
    reg.unregister('elevenlabs');
    expect(reg.getActiveName()).toBeNull();
    expect(reg.has('elevenlabs')).toBe(false);
  });

  it('passes the vault-backed getSecret into create()', async () => {
    let seen: ((n: string) => Promise<string | null>) | undefined;
    const reg = new SynthesizerRegistry({
      secretResolver: async (n) => (n === 'ELEVENLABS_API_KEY' ? 'sk-1' : null),
    });
    reg.register(def('elevenlabs', (ctx) => (seen = ctx.getSecret)));
    reg.getActive(); // forces create()
    expect(typeof seen).toBe('function');
    expect(await seen!('ELEVENLABS_API_KEY')).toBe('sk-1');
  });

  it('getActive throws when none is active', () => {
    const reg = new SynthesizerRegistry();
    expect(() => reg.getActive()).toThrow(/No active synthesizer/);
  });
});
