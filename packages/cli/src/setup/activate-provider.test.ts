import { afterEach, describe, expect, it } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import { definePlugin, defineProvider, type ProviderDef } from '@moxxy/sdk';
import {
  __setClaudeCommandRunner,
  claudeCodeProviderDef,
} from '@moxxy/plugin-provider-claude-code';
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

afterEach(() => {
  __setClaudeCommandRunner(async () => ({ code: 1, stdout: '', stderr: 'not configured' }));
});

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

  it('uses a fallback provider item config when probing activation', async () => {
    const executable = '/Applications/Claude Code/bin/claude';
    const seen: string[] = [];
    __setClaudeCommandRunner(async (value) => {
      seen.push(value);
      return { code: 0, stdout: '{"loggedIn":true}', stderr: '' };
    });
    const session = makeSession([testProvider('unconfigured'), claudeCodeProviderDef]);

    const result = await activateProvider({
      ...baseArgs,
      session,
      config: {
        plugins: {
          provider: {
            default: 'unconfigured',
            fallbacks: ['claude-code'],
            items: { 'claude-code': { config: { executable } } },
          },
        },
      },
      providerConfig: {},
    });

    expect(result.activated).toMatchObject({
      name: 'claude-code',
      cfg: { executable },
    });
    expect(seen).toEqual([executable]);
  });

  it('uses provider item config for readiness probes and runtime switching', async () => {
    const executable = '/Applications/Claude Code/bin/claude';
    const seen: string[] = [];
    __setClaudeCommandRunner(async (value) => {
      seen.push(value);
      return { code: 0, stdout: '{"loggedIn":true}', stderr: '' };
    });
    const session = makeSession([testProvider(), claudeCodeProviderDef]);

    const { credentialResolver } = await activateProvider({
      ...baseArgs,
      session,
      config: {
        plugins: {
          provider: {
            default: 'test-provider',
            items: { 'claude-code': { config: { executable } } },
          },
        },
      },
      providerConfig: { apiKey: 'sk-test' },
    });

    expect(session.readyProviders.has('claude-code')).toBe(true);
    await expect(credentialResolver('claude-code')).resolves.toMatchObject({ executable });
    expect(seen).toEqual([executable, executable]);
  });
});
