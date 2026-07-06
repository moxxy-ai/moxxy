import { describe, expect, it, vi } from 'vitest';
import type { ServiceRegistry } from '@moxxy/sdk';
import { assertDefined } from '@moxxy/sdk';
import { memoryConsolidatePlugin } from './index.js';

/**
 * The discovery-loadable default export resolves the long-term store ('memory',
 * published by the memory plugin) + the active provider (via 'providers') from
 * the inter-plugin service registry in onInit, instead of a `(store, getProvider)`
 * closure. (Behaviour with an injected store is covered by consolidate.test.)
 */
describe('memoryConsolidatePlugin (discovery-loadable)', () => {
  it('exposes the consolidate tools + an onInit hook (alongside the nudge hook)', () => {
    expect(memoryConsolidatePlugin.tools?.map((t) => t.name).sort()).toEqual([
      'memory_consolidate',
      'memory_consolidate_plan',
    ]);
    expect(typeof memoryConsolidatePlugin.hooks?.onInit).toBe('function');
    expect(typeof memoryConsolidatePlugin.hooks?.onBeforeProviderCall).toBe('function');
  });

  it('onInit resolves the memory + providers services from the registry', () => {
    const get = vi.fn(() => ({ getActive: () => null }));
    const services = {
      get,
      require: () => ({}),
      has: () => true,
      register: () => {},
    } as unknown as ServiceRegistry;
    const hooks = memoryConsolidatePlugin.hooks;
    assertDefined(hooks, 'plugin defines hooks');
    assertDefined(hooks.onInit, 'plugin defines an onInit hook');
    hooks.onInit({ services } as never);
    expect(get).toHaveBeenCalledWith('memory');
    expect(get).toHaveBeenCalledWith('providers');
  });
});
