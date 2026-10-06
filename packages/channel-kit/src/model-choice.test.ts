import { beforeEach, describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { FakeProvider } from '@moxxy/testing';
import { defineProvider, definePlugin } from '@moxxy/sdk';
import {
  applyModelChoice,
  findModelOptions,
  formatModelChoice,
  listModelOptions,
  parseModelChoice,
} from './model-choice.js';

let session: Session;
let resolverCalls: string[];

function fakeProviderDef(name: string, modelIds: ReadonlyArray<string>) {
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

beforeEach(() => {
  session = new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'model-choice-test',
      providers: [fakeProviderDef('alpha', ['a-small', 'a-large']), fakeProviderDef('beta', ['b-fast'])],
    }),
  );
  session.providers.setActive('alpha');
  resolverCalls = [];
  session.credentialResolver = async (name) => {
    resolverCalls.push(name);
    return { token: `${name}-token` };
  };
});

describe('parseModelChoice / formatModelChoice', () => {
  it('round-trips provider::model', () => {
    const choice = { provider: 'openai-codex', model: 'gpt-5.6-luna' };
    expect(parseModelChoice(formatModelChoice(choice))).toEqual(choice);
  });

  it.each([null, undefined, '', 'gpt-5', '::m', 'p::', ' :: '])('rejects %j', (raw) => {
    expect(parseModelChoice(raw)).toBeNull();
  });
});

describe('listModelOptions', () => {
  it('flattens every provider model and marks readiness from readyProviders', () => {
    session.readyProviders = new Set(['alpha']);
    expect(listModelOptions(session)).toEqual([
      { provider: 'alpha', model: 'a-small', connected: true },
      { provider: 'alpha', model: 'a-large', connected: true },
      { provider: 'beta', model: 'b-fast', connected: false },
    ]);
  });

  it('treats only the active provider as connected when readiness is unknown', () => {
    const connected = listModelOptions(session).filter((o) => o.connected).map((o) => o.provider);
    expect(new Set(connected)).toEqual(new Set(['alpha']));
  });
});

describe('findModelOptions', () => {
  it('matches an exact provider::model', () => {
    expect(findModelOptions(listModelOptions(session), 'beta::b-fast')).toEqual([
      { provider: 'beta', model: 'b-fast', connected: false },
    ]);
  });

  it('matches a bare model id exactly before falling back to substrings', () => {
    const found = findModelOptions(listModelOptions(session), 'a-small');
    expect(found.map((o) => o.model)).toEqual(['a-small']);
  });

  it('filters by case-insensitive substring', () => {
    const found = findModelOptions(listModelOptions(session), 'ALPHA');
    expect(found.map((o) => o.model)).toEqual(['a-small', 'a-large']);
  });
});

describe('applyModelChoice', () => {
  it('switches to a connected provider with its resolved credentials', async () => {
    session.readyProviders = new Set(['alpha', 'beta']);

    const result = await applyModelChoice(session, { provider: 'beta', model: 'b-fast' });

    expect(result).toEqual({ ok: true });
    expect(session.providers.getActiveName()).toBe('beta');
    expect(resolverCalls).toEqual(['beta']);
  });

  it('keeps the active provider untouched (no credential round-trip) when only the model changes', async () => {
    const result = await applyModelChoice(session, { provider: 'alpha', model: 'a-large' });

    expect(result).toEqual({ ok: true });
    expect(session.providers.getActiveName()).toBe('alpha');
    expect(resolverCalls).toEqual([]);
  });

  it('accepts a model outside the static catalog for a known provider (live/custom models)', async () => {
    expect(await applyModelChoice(session, { provider: 'alpha', model: 'a-preview-2' })).toEqual({ ok: true });
  });

  it('refuses a provider that is not connected, with the setup hint, and leaves the session as is', async () => {
    session.readyProviders = new Set(['alpha']);

    const result = await applyModelChoice(session, { provider: 'beta', model: 'b-fast' });

    expect(result).toMatchObject({ ok: false, reason: 'not-connected' });
    expect(result.ok ? '' : result.message).toMatch(/beta/);
    expect(session.providers.getActiveName()).toBe('alpha');
  });

  it('refuses an unknown provider', async () => {
    const result = await applyModelChoice(session, { provider: 'gamma', model: 'g1' });
    expect(result).toMatchObject({ ok: false, reason: 'unknown-provider' });
    expect(session.providers.getActiveName()).toBe('alpha');
  });
});
