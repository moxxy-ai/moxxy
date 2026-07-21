import { describe, expect, it, vi } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import {
  definePlugin,
  defineProvider,
  type ProviderDef,
  type ProviderEvent,
  type ProviderRequest,
} from '@moxxy/sdk';
import { activateProvider } from './activate-provider.js';

function testProvider(name = 'test-provider'): ProviderDef {
  return defineProvider({
    name,
    models: [],
    createClient: () => ({
      name,
      models: [],
      stream: async function* () {},
      countTokens: async () => 0,
    }),
  });
}

function makeSession(providers: ProviderDef[]): Session {
  const session = new Session({ cwd: '/tmp', logger: silentLogger });
  session.pluginHost.registerStatic(
    definePlugin({ name: '@test/providers', providers }),
  );
  return session;
}

const vault = {
  get: async () => null,
  set: async () => undefined,
} as never;

const baseArgs = {
  vault,
  skipKeyPrompt: true,
  progress: () => undefined,
  logger: silentLogger,
};

describe('activateProvider', () => {
  it('marks provider auth as ready after credentials resolve and provider activates', async () => {
    const session = makeSession([testProvider()]);

    await activateProvider({
      ...baseArgs,
      session,
      config: { plugins: { provider: { default: 'test-provider' } } },
      providerConfig: { apiKey: 'sk-test' },
    });

    expect(
      session.requirements.check([
        { kind: 'runtime', name: 'auth:provider:test-provider', state: 'ready' },
      ]),
    ).toEqual({ ready: true, issues: [] });
  });

  it('delegates credentials and provider-specific config to the selected provider', async () => {
    const resolveCredentials = vi.fn(async ({ providerConfig }) => ({ ...providerConfig, credential: 'ready' }));
    const custom = { ...testProvider('custom'), resolveCredentials };
    const session = makeSession([custom]);
    const result = await activateProvider({
      ...baseArgs,
      session,
      config: { plugins: { provider: { default: 'custom', items: { custom: { config: { option: true } } } } } },
      providerConfig: {},
    });
    expect(result.activated).toEqual({ name: 'custom', cfg: { option: true, credential: 'ready' } });
    expect(resolveCredentials).toHaveBeenCalledWith(expect.objectContaining({ providerConfig: { option: true } }));
  });
});
