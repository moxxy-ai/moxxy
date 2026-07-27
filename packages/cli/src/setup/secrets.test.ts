import { describe, expect, it, vi } from 'vitest';
import { defineSecretProvider } from '@moxxy/sdk';
import type { Session } from '@moxxy/core';
import type { VaultStore } from '@moxxy/plugin-vault';
import { buildSecretResolver, vaultSecretProvider } from './secrets.js';

const fakeVault = (entries: Record<string, string>): VaultStore =>
  ({ get: async (name: string) => entries[name] ?? null }) as unknown as VaultStore;

const sessionWith = (active: ReturnType<typeof defineSecretProvider> | null): Session =>
  ({ secretProviders: { getActive: () => active } }) as unknown as Session;

describe('buildSecretResolver', () => {
  it('falls back to the vault when no provider is active', async () => {
    const resolve = buildSecretResolver(() => sessionWith(null), fakeVault({ K: 'v' }), '/tmp');
    expect(await resolve('K')).toBe('v');
  });

  it('prefers the active provider', async () => {
    const provider = defineSecretProvider({
      name: 'remote',
      open: () => ({ get: async (n) => (n === 'K' ? 'from-remote' : null), close: async () => {} }),
    });
    const resolve = buildSecretResolver(() => sessionWith(provider), fakeVault({ K: 'from-vault' }), '/tmp');
    expect(await resolve('K')).toBe('from-remote');
  });

  // The fallback is what makes adoption incremental: point at an external store
  // and move secrets over one at a time rather than in a big bang.
  it('falls through to the vault for a secret the provider does not hold', async () => {
    const provider = defineSecretProvider({
      name: 'remote',
      open: () => ({ get: async () => null, close: async () => {} }),
    });
    const resolve = buildSecretResolver(() => sessionWith(provider), fakeVault({ K: 'from-vault' }), '/tmp');
    expect(await resolve('K')).toBe('from-vault');
  });

  // An unreachable store must NOT look like a miss: silently using the local
  // vault would mean running on credentials the operator believes they revoked.
  it('propagates a provider failure instead of falling back', async () => {
    const provider = defineSecretProvider({
      name: 'remote',
      open: () => ({
        get: async () => {
          throw new Error('vault unreachable');
        },
        close: async () => {},
      }),
    });
    const resolve = buildSecretResolver(() => sessionWith(provider), fakeVault({ K: 'stale' }), '/tmp');
    await expect(resolve('K')).rejects.toThrow(/unreachable/);
  });

  // An external store holds a connection or a cached auth token; opening one
  // per getSecret would re-authenticate on every tool call.
  it('opens the provider once and reuses it', async () => {
    const open = vi.fn(() => ({ get: async () => 'x', close: async () => {} }));
    const provider = defineSecretProvider({ name: 'remote', open });
    const resolve = buildSecretResolver(() => sessionWith(provider), fakeVault({}), '/tmp');
    await resolve('A');
    await resolve('B');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not double-open when the vault floor is the active provider', async () => {
    const vault = fakeVault({ K: 'v' });
    const resolve = buildSecretResolver(() => sessionWith(vaultSecretProvider(vault)), vault, '/tmp');
    expect(await resolve('K')).toBe('v');
  });
});
