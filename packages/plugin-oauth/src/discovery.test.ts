import { describe, expect, it, vi } from 'vitest';
import type { ServiceRegistry } from '@moxxy/sdk';
import { oauthPlugin } from './index.js';

/**
 * The discovery-loadable default export resolves the vault from the inter-plugin
 * service registry in onInit instead of a `build*({ vault })` closure. (The tool
 * behaviour with an injected vault is covered by tools.test via buildOauthPlugin.)
 */
describe('oauthPlugin (discovery-loadable)', () => {
  it('exposes the oauth tools and an onInit hook', () => {
    expect(oauthPlugin.tools?.map((t) => t.name).sort()).toEqual([
      'oauth_authorize',
      'oauth_clear_token',
      'oauth_get_token',
    ]);
    expect(typeof oauthPlugin.hooks?.onInit).toBe('function');
  });

  it('onInit resolves the "vault" service from the registry', () => {
    const fakeVault = { tag: 'vault-store' };
    const require = vi.fn((name: string) => {
      if (name !== 'vault') throw new Error(`unexpected service: ${name}`);
      return fakeVault;
    });
    const services = {
      require,
      get: () => fakeVault,
      has: () => true,
      register: () => {},
    } as unknown as ServiceRegistry;
    oauthPlugin.hooks!.onInit!({ services } as never);
    expect(require).toHaveBeenCalledWith('vault');
  });
});
