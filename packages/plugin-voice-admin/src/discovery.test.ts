import { describe, expect, it } from 'vitest';
import type { ServiceRegistry } from '@moxxy/sdk';
import { voiceAdminPlugin } from './index.js';

function fakeSynths(active: string | null, names: string[]) {
  let cur = active;
  return {
    list: () => names.map((name) => ({ name })),
    has: (n: string) => names.includes(n),
    getActiveName: () => cur,
    setActive: (n: string) => {
      cur = n;
    },
    clearActive: () => {
      cur = null;
    },
  };
}

/**
 * The discovery-loadable default export resolves the synthesizer registry from
 * the inter-plugin service registry in onInit instead of a `build*(session)`
 * closure.
 */
describe('voiceAdminPlugin (discovery-loadable)', () => {
  it('exposes list_voices/set_voice + an onInit hook', () => {
    expect(voiceAdminPlugin.tools?.map((t) => t.name).sort()).toEqual(['list_voices', 'set_voice']);
    expect(typeof voiceAdminPlugin.hooks?.onInit).toBe('function');
  });

  it('onInit wires the synthesizers registry; the tools read it live', async () => {
    const synths = fakeSynths('eleven', ['eleven', 'openai']);
    const services = {
      get: () => synths,
      require: () => synths,
      has: () => true,
      register: () => {},
    } as unknown as ServiceRegistry;
    voiceAdminPlugin.hooks!.onInit!({ services } as never);

    const listVoices = voiceAdminPlugin.tools!.find((t) => t.name === 'list_voices')!;
    const listed = await listVoices.handler({} as never, {} as never);
    expect(listed).toEqual({ active: 'eleven', available: ['system', 'eleven', 'openai'] });

    const setVoice = voiceAdminPlugin.tools!.find((t) => t.name === 'set_voice')!;
    const set = await setVoice.handler({ synthesizer: 'openai' } as never, {} as never);
    expect(set).toEqual({ active: 'openai' });
    expect(synths.getActiveName()).toBe('openai');
  });
});
