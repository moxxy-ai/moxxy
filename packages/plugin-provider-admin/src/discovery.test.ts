import { describe, expect, it, vi } from 'vitest';
import type { ServiceRegistry } from '@moxxy/sdk';
import { providerAdminPlugin } from './index.js';

/**
 * The discovery-loadable default export resolves the providers registry +
 * credential accessor from the service registry in onInit and publishes its
 * admin api as the 'providerAdmin' service (which Session.providerAdmin exposes),
 * instead of the host `{ providerRegistry, resolveActiveConfig }` closure + stash.
 */
describe('providerAdminPlugin (discovery-loadable)', () => {
  it('exposes the provider tools + an onInit hook', () => {
    const names = providerAdminPlugin.tools?.map((t) => t.name) ?? [];
    expect(names).toContain('provider_add');
    expect(typeof providerAdminPlugin.hooks?.onInit).toBe('function');
  });

  it('onInit resolves providers + resolveCredentials and publishes providerAdmin', async () => {
    const registry = {
      list: () => [],
      register: () => {},
      replace: () => {},
      unregister: () => {},
      getActiveName: () => null,
    };
    const get = vi.fn((name: string) =>
      name === 'providers' ? registry : name === 'resolveCredentials' ? () => ({}) : undefined,
    );
    const register = vi.fn();
    const services = { get, register, require: () => undefined, has: () => true } as unknown as ServiceRegistry;

    // The inner onInit reads ~/.moxxy/providers.json (absent on CI → caught +
    // skipped); we only assert the service wiring here.
    await providerAdminPlugin.hooks!.onInit!({ services } as never);

    expect(get).toHaveBeenCalledWith('providers');
    expect(get).toHaveBeenCalledWith('resolveCredentials');
    expect(register).toHaveBeenCalledWith('providerAdmin', expect.anything());
  });
});
