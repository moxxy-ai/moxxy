import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { FakeProvider } from '@moxxy/testing';
import { defineProvider, definePlugin } from '@moxxy/sdk';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { DISCORD_MODEL_KEY } from '../keys.js';
import { modelSuggestions, resolveChannelModel, runModelCommand } from './model-command.js';
import { buildAppCommands } from './slash-handler.js';

let tmp: string;
let vault: VaultStore;
let session: Session;

function providerDef(name: string, modelIds: ReadonlyArray<string>) {
  const models = modelIds.map((id) => ({
    id,
    contextWindow: 100_000,
    maxOutputTokens: 4_000,
    supportsTools: true,
    supportsStreaming: true,
  }));
  const instance = new FakeProvider({ name, models });
  return defineProvider({ name, models, createClient: () => instance });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-dc-model-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'discord-model-test',
      providers: [providerDef('alpha', ['a-small', 'a-large']), providerDef('beta', ['b-fast'])],
    }),
  );
  session.providers.setActive('alpha');
  session.readyProviders = new Set(['alpha', 'beta']);
  session.credentialResolver = async () => ({});
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const deps = () => ({ session, vault });

describe('/model', () => {
  it('without an argument says the bot runs the default model and lists the choices', async () => {
    session.readyProviders = new Set(['alpha']);

    const reply = await runModelCommand('', deps());

    expect(reply).toMatch(/default/i);
    expect(reply).toContain('alpha::a-small');
    expect(reply).toContain('beta::b-fast (not connected)');
    expect(reply).toMatch(/\/model <name>/);
  });

  it('marks the channel model as current when one is saved', async () => {
    await vault.set(DISCORD_MODEL_KEY, 'beta::b-fast');

    const reply = await runModelCommand('', deps());

    expect(reply).toMatch(/beta::b-fast/);
    expect(reply).toMatch(/• beta::b-fast/);
  });

  it('switches to provider::model, activates the provider and saves it for this channel only', async () => {
    const reply = await runModelCommand('beta::b-fast', deps());

    expect(reply).toMatch(/✓.*beta::b-fast/);
    expect(await vault.get(DISCORD_MODEL_KEY)).toBe('beta::b-fast');
    expect(session.providers.getActiveName()).toBe('beta');
  });

  it('switches by a bare model id', async () => {
    await runModelCommand('a-large', deps());
    expect(await vault.get(DISCORD_MODEL_KEY)).toBe('alpha::a-large');
  });

  it('"default" forgets the channel model', async () => {
    await vault.set(DISCORD_MODEL_KEY, 'beta::b-fast');

    const reply = await runModelCommand('default', deps());

    expect(reply).toMatch(/default/i);
    expect(await vault.get(DISCORD_MODEL_KEY)).toBeNull();
  });

  it('refuses a provider that is not connected and keeps the saved model', async () => {
    session.readyProviders = new Set(['alpha']);

    const reply = await runModelCommand('beta::b-fast', deps());

    expect(reply).toMatch(/isn't connected/);
    expect(await vault.get(DISCORD_MODEL_KEY)).toBeNull();
    expect(session.providers.getActiveName()).toBe('alpha');
  });

  it('asks to be more specific when several models match', async () => {
    const reply = await runModelCommand('a-', deps());

    expect(reply).toMatch(/more specific/i);
    expect(reply).toContain('alpha::a-small');
    expect(reply).toContain('alpha::a-large');
    expect(await vault.get(DISCORD_MODEL_KEY)).toBeNull();
  });

  it('says so when nothing matches', async () => {
    expect(await runModelCommand('zzz', deps())).toMatch(/no model matches "zzz"/);
  });
});

describe('resolveChannelModel (before every turn)', () => {
  it('uses the default model when the channel has none saved', async () => {
    expect(await resolveChannelModel(deps())).toEqual({});
  });

  it('applies the saved channel model — also one changed from the desktop while the bot runs', async () => {
    await vault.set(DISCORD_MODEL_KEY, 'beta::b-fast');

    expect(await resolveChannelModel(deps())).toEqual({ model: 'b-fast' });
    expect(session.providers.getActiveName()).toBe('beta');
  });

  it('falls back to the default with a warning when the saved provider is not connected', async () => {
    session.readyProviders = new Set(['alpha']);
    await vault.set(DISCORD_MODEL_KEY, 'beta::b-fast');

    const out = await resolveChannelModel(deps());

    expect(out.model).toBeUndefined();
    expect(out.warning).toMatch(/beta::b-fast/);
    expect(session.providers.getActiveName()).toBe('alpha');
  });
});

describe('the /model application command', () => {
  it('is published with an optional "name" option that suggests models as you type', () => {
    const cmd = buildAppCommands(session).find((c) => c.name === 'model');
    expect(cmd).toBeDefined();
    expect(cmd?.options).toEqual([
      expect.objectContaining({ type: 3, name: 'name', required: false, autocomplete: true }),
    ]);
  });
});

describe('/model suggestions (the list Discord shows under the "name" option)', () => {
  it('offers the default and every model, marking the current and the unconnected ones', async () => {
    session.readyProviders = new Set(['alpha']);
    await vault.set(DISCORD_MODEL_KEY, 'alpha::a-large');

    const choices = await modelSuggestions('', deps());

    expect(choices).toEqual([
      { name: 'default', value: 'default' },
      { name: 'alpha::a-small', value: 'alpha::a-small' },
      { name: 'alpha::a-large (current)', value: 'alpha::a-large' },
      { name: 'beta::b-fast (not connected)', value: 'beta::b-fast' },
    ]);
  });

  it('narrows the list to what has been typed so far', async () => {
    const choices = await modelSuggestions('FAST', deps());
    expect(choices).toEqual([{ name: 'beta::b-fast', value: 'beta::b-fast' }]);
  });

  it('picking a suggestion switches to it', async () => {
    const [picked] = await modelSuggestions('b-fast', deps());

    await runModelCommand(picked?.value ?? '', deps());

    expect(await vault.get(DISCORD_MODEL_KEY)).toBe('beta::b-fast');
  });

  it('stays within the 25 choices Discord accepts', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `m-${i}`);
    session.pluginHost.registerStatic(
      definePlugin({ name: 'discord-many-models', providers: [providerDef('gamma', many)] }),
    );

    expect(await modelSuggestions('', deps())).toHaveLength(25);
  });
});

describe('the /auto-approve application command', () => {
  it('is published as /auto-approve (the /yolo name stays a typed alias only)', () => {
    const names = buildAppCommands(session).map((c) => c.name);
    expect(names).toContain('auto-approve');
    expect(names).not.toContain('yolo');
  });
});

describe('the voice call application commands', () => {
  it('publishes /call and /hangup', () => {
    const names = buildAppCommands(session).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['call', 'hangup']));
  });
});
