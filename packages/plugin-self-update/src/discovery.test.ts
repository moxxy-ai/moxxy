import { describe, expect, it, vi } from 'vitest';
import type { ServiceRegistry } from '@moxxy/sdk';
import { selfUpdatePlugin } from './index.js';

/**
 * The discovery-loadable default export resolves pluginHost + registrySnapshot +
 * the writable appendEvent + its config options from the service registry in
 * onInit, instead of the host SelfUpdateDeps closure.
 */
describe('selfUpdatePlugin (discovery-loadable)', () => {
  it('exposes the self_update tools + an onInit hook', () => {
    const names = selfUpdatePlugin.tools?.map((t) => t.name) ?? [];
    expect(names).toContain('self_update_classify');
    expect(names).toContain('self_update_begin');
    expect(typeof selfUpdatePlugin.hooks?.onInit).toBe('function');
  });

  it('onInit resolves pluginHost/registrySnapshot/appendEvent/getPluginOptions', () => {
    const get = vi.fn((name: string) => {
      switch (name) {
        case 'pluginHost':
          return { reload: async () => {}, unload: async () => {}, listSkipped: () => [] };
        case 'registrySnapshot':
          return () => ({});
        case 'appendEvent':
          return async () => {};
        case 'getPluginOptions':
          return () => ({});
        default:
          return undefined;
      }
    });
    const services = { get, register: () => {}, require: () => undefined, has: () => true } as unknown as ServiceRegistry;
    selfUpdatePlugin.hooks!.onInit!({ services } as never);
    expect(get).toHaveBeenCalledWith('pluginHost');
    expect(get).toHaveBeenCalledWith('registrySnapshot');
    expect(get).toHaveBeenCalledWith('appendEvent');
    expect(get).toHaveBeenCalledWith('getPluginOptions');
  });
});
