import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { setActiveBus } from './shared';
import { registerSettingsHandlers } from './settings';
import { removeDir } from '@moxxy/vitest-preset/fs';

type Handler = (...args: unknown[]) => Promise<unknown>;

function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  setActiveBus({
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as never);
  registerSettingsHandlers({} as never);
  return handlers;
}

describe('settings.providerCatalog', () => {
  const previousHome = process.env.MOXXY_HOME;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'moxxy-settings-'));
    process.env.MOXXY_HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = previousHome;
    await removeDir(home);
  });

  it('offers every provider the desktop ships, including the Claude Pro/Max sign-in and the Codex and OpenCode agents', async () => {
    const catalog = captureHandlers().get('settings.providerCatalog');
    assertDefined(catalog, 'settings.providerCatalog handler');

    expect(await catalog()).toEqual([
      { name: 'anthropic', kind: 'api' },
      { name: 'openai', kind: 'api' },
      { name: 'claude-code', kind: 'agent' },
      { name: 'codex-agent', kind: 'agent' },
      { name: 'opencode', kind: 'agent' },
    ]);
  });
});

describe('settings.modelDefaults', () => {
  const previousHome = process.env.MOXXY_HOME;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'moxxy-settings-'));
    process.env.MOXXY_HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = previousHome;
    await removeDir(home);
  });

  it('reads nothing set on a new install', async () => {
    const read = captureHandlers().get('settings.modelDefaults');
    assertDefined(read, 'settings.modelDefaults handler');

    expect(await read()).toEqual({ provider: null, model: null, effort: 'off', fast: false });
  });

  it('saves the choice into the config every surface starts from, and reads it back', async () => {
    const handlers = captureHandlers();
    const read = handlers.get('settings.modelDefaults');
    const save = handlers.get('settings.setModelDefaults');
    assertDefined(read, 'settings.modelDefaults handler');
    assertDefined(save, 'settings.setModelDefaults handler');

    await save({ model: { provider: 'codex-agent', model: 'gpt-6-luna' }, effort: 'medium', fast: true });

    expect(await read()).toEqual({ provider: 'codex-agent', model: 'gpt-6-luna', effort: 'medium', fast: true });
    const config = await readFile(path.join(home, 'config.yaml'), 'utf8');
    expect(config).toContain('default: codex-agent');
    expect(config).toContain('model: gpt-6-luna');
    expect(config).toContain('effort: medium');
    expect(config).toContain('fast: true');
  });
});

describe('settings.providers', () => {
  const previousHome = process.env.MOXXY_HOME;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'moxxy-settings-'));
    process.env.MOXXY_HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = previousHome;
    await removeDir(home);
  });

  it("carries an agent connection's name and the last check of its CLI", async () => {
    const agentCli = {
      state: 'update-available',
      command: 'codex',
      installed: '0.155.1',
      latest: '0.162.1',
      minimum: '0.155.1',
      checkedAt: 1,
      signedIn: true,
      account: 'ChatGPT',
    };
    const info = {
      activeProvider: 'codex-agent',
      readyProviders: ['codex-agent'],
      providers: [{ name: 'codex-agent', models: [], authKind: 'oauth', agentName: 'Codex', agentCli }],
    };
    const pool = { activeWorkspaceId: () => 'w1', get: () => ({ remote: () => ({ getInfo: () => info }) }) };
    const handlers = new Map<string, Handler>();
    setActiveBus({ handle: (channel: string, fn: Handler) => void handlers.set(channel, fn) } as never);
    registerSettingsHandlers(pool as never);
    const providers = handlers.get('settings.providers');
    assertDefined(providers, 'settings.providers handler');

    expect(await providers({}, undefined)).toEqual([
      expect.objectContaining({ name: 'codex-agent', agentName: 'Codex', agentCli }),
    ]);
  });
});
