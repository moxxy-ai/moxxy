import { describe, expect, it } from 'vitest';
import { googlePlugin, googleProviderDef, geminiModels } from './index.js';

describe('@moxxy/plugin-provider-google', () => {
  it('registers the google provider', () => {
    expect(googlePlugin.providers?.map((p) => p.name)).toEqual(['google']);
  });

  it('advertises the Gemini catalog (1M-context, vision-capable)', () => {
    expect(googleProviderDef.models).toEqual(geminiModels);
    expect(geminiModels.find((m) => m.id === 'gemini-3-pro')).toMatchObject({
      contextWindow: 1_000_000,
      supportsImages: true,
    });
  });

  it('createClient stamps the google slug so usage/errors attribute to Gemini, not openai', () => {
    const client = googleProviderDef.createClient({ apiKey: 'test-key' });
    expect(client.name).toBe('google');
    expect(client.models).toEqual(geminiModels);
  });

  it('exposes an apiKey auth descriptor', () => {
    expect(googleProviderDef.auth).toMatchObject({ kind: 'apiKey' });
  });
});
