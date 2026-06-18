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

  it('every Gemini model the header calls multimodal carries supportsImages + supportsDocuments', () => {
    // The header states the 2.5/3 families are natively multimodal and accept
    // native PDF input; the desktop gates raw-PDF shipping on supportsDocuments.
    for (const m of geminiModels) {
      expect(m.supportsImages, `${m.id} supportsImages`).toBe(true);
      expect(m.supportsDocuments, `${m.id} supportsDocuments`).toBe(true);
    }
  });

  it('the reasoning-tier Gemini models advertise supportsReasoning', () => {
    // Reasoning gating (reasoning_effort + reasoning-stream surfacing) keys off
    // this flag; the pro/flash tiers are reasoning models.
    const reasoningIds = ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'];
    for (const id of reasoningIds) {
      expect(geminiModels.find((m) => m.id === id)?.supportsReasoning, id).toBe(true);
    }
  });
});
