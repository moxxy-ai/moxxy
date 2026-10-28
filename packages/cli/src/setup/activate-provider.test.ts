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

    const result = await activateProvider({
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
    expect(result.retiredReplaced).toBe(false);
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

describe('activateProvider after ChatGPT sign-in was removed', () => {
  it('moves a configured ChatGPT sign-in to the Codex agent and says why', async () => {
    const codexAgent = defineProvider({
      ...testProvider('codex-agent'),
      resolveCredentials: async ({ providerConfig }) => ({ ...providerConfig, executable: 'codex' }),
    });
    const session = makeSession([codexAgent]);
    const warn = vi.fn();

    const result = await activateProvider({
      ...baseArgs,
      logger: { ...silentLogger, warn },
      session,
      config: { plugins: { provider: { default: 'openai-codex' } } },
      providerConfig: {},
    });

    expect(result.activated?.name).toBe('codex-agent');
    expect(result.retiredReplaced).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/ChatGPT sign-in was removed.*ChatGPT — Codex agent/),
      expect.anything(),
    );
  });

  it('explains the removal, and asks for another provider, when the Codex agent cannot start', async () => {
    const codexAgent = defineProvider({
      name: 'codex-agent',
      models: [],
      createClient: () => { throw new Error('unused'); },
      resolveCredentials: async () => { throw new Error('Codex is not installed.'); },
    });
    const session = makeSession([codexAgent]);
    const progress = vi.fn();

    await activateProvider({
      ...baseArgs,
      progress,
      tolerateNoProvider: true,
      session,
      config: { plugins: { provider: { default: 'openai-codex' } } },
      providerConfig: {},
    });

    expect(session.providers.getActiveName()).toBeNull();
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'provider-failed',
      error: expect.stringMatching(/ChatGPT sign-in was removed.*choose another provider/),
    }));
    // The removal is explained once, and the real reason the Codex agent did
    // not start stays visible.
    const failed = progress.mock.calls.map(([event]) => event).find((event) => event.kind === 'provider-failed');
    expect(failed.error.match(/ChatGPT sign-in was removed/g)).toHaveLength(1);
    expect(failed.error).toContain('(Codex is not installed.)');
  });
});


it('does not carry retired backend options into the Codex agent', async () => {
  const received: unknown[] = [];
  const session = makeSession([defineProvider({
    ...testProvider('codex-agent'),
    resolveCredentials: async ({ providerConfig }) => { received.push(providerConfig); return providerConfig; },
  })]);
  await activateProvider({ ...baseArgs, session, config: { plugins: { provider: { default: 'openai-codex', items: { 'codex-agent': { config: { executable: 'codex' } } } } } }, providerConfig: { baseURL: 'https://chatgpt.com/backend-api', model: 'private-model' } });
  expect(received[0]).toEqual({ executable: 'codex' });
});
