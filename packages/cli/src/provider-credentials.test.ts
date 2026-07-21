import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProviderCredentials } from './provider-credentials.js';
import { defineProvider } from '@moxxy/sdk';

const client = (name: string) => ({ name, models: [], stream: async function* () {}, countTokens: async () => 0 });
const vault = { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as never;

describe('resolveProviderCredentials', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates custom authentication to the provider', async () => {
    const resolveCredentials = vi.fn(async ({ providerConfig }) => ({ ...providerConfig, token: 'subscription' }));
    const provider = defineProvider({ name: 'subscription-provider', models: [], createClient: () => client('subscription-provider'), resolveCredentials });
    await expect(resolveProviderCredentials(provider, vault, { cwd: '/workspace' }, { providerConfig: { model: 'm1' } }))
      .resolves.toEqual({ model: 'm1', token: 'subscription' });
    expect(resolveCredentials).toHaveBeenCalledWith(expect.objectContaining({
      vault, providerConfig: { model: 'm1' }, host: { cwd: '/workspace' },
    }));
  });

  it('passes config through for providers that require no credentials', async () => {
    const provider = defineProvider({ name: 'local', models: [], createClient: () => client('local'), auth: { kind: 'none' } });
    await expect(resolveProviderCredentials(provider, vault, { cwd: '/workspace' }, { providerConfig: { baseURL: 'http://localhost' } }))
      .resolves.toEqual({ baseURL: 'http://localhost' });
  });

  it('rejects OAuth providers that omit a credential resolver', async () => {
    const provider = defineProvider({
      name: 'broken-oauth', models: [], createClient: () => client('broken-oauth'),
      auth: { kind: 'oauth', login: async () => ({}) },
    });
    await expect(resolveProviderCredentials(provider, vault, { cwd: '/workspace' })).rejects.toThrow(/resolveCredentials/);
  });
});
