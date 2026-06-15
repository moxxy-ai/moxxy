import { describe, expect, it } from 'vitest';
import { xaiPlugin, xaiProviderDef, grokModels } from './index.js';

describe('@moxxy/plugin-provider-xai', () => {
  it('registers the xai provider', () => {
    expect(xaiPlugin.providers?.map((p) => p.name)).toEqual(['xai']);
  });

  it('advertises the Grok catalog (including the 1M-context grok-4.3 flagship)', () => {
    expect(xaiProviderDef.models).toEqual(grokModels);
    expect(grokModels.find((m) => m.id === 'grok-4.3')).toMatchObject({ contextWindow: 1_000_000 });
  });

  it('createClient stamps the xai slug so usage/errors attribute to xAI, not openai', () => {
    const client = xaiProviderDef.createClient({ apiKey: 'xai-test-key' });
    expect(client.name).toBe('xai');
    expect(client.models).toEqual(grokModels);
  });

  it('exposes an apiKey auth descriptor', () => {
    expect(xaiProviderDef.auth).toMatchObject({ kind: 'apiKey' });
  });
});
