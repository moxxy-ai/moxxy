import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadConfig,
  setCategoryDefault,
  setProviderItemConfig,
  setProviderModel,
  type MoxxyConfig,
} from '@moxxy/config';
import { Session, silentLogger } from '@moxxy/core';
import {
  definePlugin,
  defineProvider,
  type ProviderDef,
  type ProviderEvent,
  type ProviderRequest,
} from '@moxxy/sdk';
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

const tempDirs: string[] = [];

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

afterEach(async () => {
  __setClaudeCommandRunner(async () => ({ code: 1, stdout: '', stderr: 'not configured' }));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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

  it.each(['claude-fable-5', 'claude-opus-4-8'])(
    'loads a persisted %s selection through production activation into the Claude child arguments',
    async (model) => {
      const home = await mkdtemp(join(tmpdir(), 'moxxy-claude-activation-'));
      tempDirs.push(home);
      const configPath = join(home, 'config.yaml');
      const executable = await makeFakeClaude(home);

      // Use the same comment-preserving writers as `moxxy provision`, then the
      // real merged loader. This pins the persistence path rather than mocking
      // ProvisionEffects.writeConfig or manually constructing createClient args.
      await setCategoryDefault('provider', 'claude-code', { configPath });
      await setProviderItemConfig('claude-code', { executable }, { configPath });
      await setProviderModel('claude-code', model, { configPath });
      const yaml = await readFile(configPath, 'utf8');
      expect(yaml).toContain('claude-code:');
      expect(yaml).toContain(`model: ${model}`);

      const priorHome = process.env.MOXXY_HOME;
      process.env.MOXXY_HOME = home;
      let config: MoxxyConfig;
      try {
        ({ config } = await loadConfig({ cwd: home }));
      } finally {
        if (priorHome === undefined) delete process.env.MOXXY_HOME;
        else process.env.MOXXY_HOME = priorHome;
      }

      __setClaudeCommandRunner(async () => ({ code: 0, stdout: '{"loggedIn":true}', stderr: '' }));
      const session = makeSession([claudeCodeProviderDef]);
      await activateProvider({ ...baseArgs, session, config, providerConfig: {} });
      await collect(session.providers.getActive().stream({ ...textRequest(), model: '' }));

      const args = JSON.parse(await readFile(join(home, 'args.json'), 'utf8')) as string[];
      expect(args.slice(-2)).toEqual(['--model', model]);
    },
  );

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

function textRequest(): ProviderRequest {
  return {
    model: '',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  };
}

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function makeFakeClaude(dir: string): Promise<string> {
  const executable = join(dir, 'claude');
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
process.stdin.resume();
process.stdin.on('end', () => {
  fs.writeFileSync(path.join(__dirname, 'args.json'), JSON.stringify(process.argv.slice(2)));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } }));
});
`, 'utf8');
  await chmod(executable, 0o755);
  return executable;
}
