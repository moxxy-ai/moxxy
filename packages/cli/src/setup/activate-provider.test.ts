import { describe, expect, it, vi } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import {
  definePlugin,
  defineProvider,
  type ProviderDef,
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

  it('carries the session workspace through production activation', async () => {
    const createClient = vi.fn(() => ({
      name: 'custom', models: [], stream: async function* () {}, countTokens: async () => 0,
    }));
    const resolveCredentials = vi.fn(async ({ providerConfig, host }) => ({
      ...providerConfig, credential: 'ready', cwd: host.cwd,
    }));
    const custom = defineProvider({ name: 'custom', models: [], createClient, resolveCredentials });
    const session = makeSession([custom]);
    expect(session.cwd).not.toBe(process.cwd());

    const result = await activateProvider({
      ...baseArgs,
      session,
      config: { plugins: { provider: { default: 'custom', items: { custom: { config: { option: true } } } } } },
      providerConfig: {},
    });
    const expected = { option: true, credential: 'ready', cwd: session.cwd };
    expect(result.activated).toEqual({ name: 'custom', cfg: expected });
    expect(resolveCredentials).toHaveBeenCalledWith(expect.objectContaining({
      providerConfig: { option: true }, host: { cwd: session.cwd },
    }));
    expect(createClient).toHaveBeenCalledWith(expected);
  });
});
