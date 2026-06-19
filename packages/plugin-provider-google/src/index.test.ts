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

  it('exposes an apiKey auth descriptor pinned to the canonical GOOGLE_API_KEY env var', () => {
    expect(googleProviderDef.auth).toMatchObject({ kind: 'apiKey', envVar: 'GOOGLE_API_KEY' });
  });

  it('every Gemini model advertises supportsImages (image_url data URLs are honored by the compat endpoint)', () => {
    for (const m of geminiModels) {
      expect(m.supportsImages, `${m.id} supportsImages`).toBe(true);
    }
  });

  it('no Gemini model over-claims supportsDocuments (the OpenAI-compat endpoint rejects the file part)', () => {
    // Worst case if this regresses: the desktop ships raw PDF bytes as an
    // OpenAI `file`/`file_data` part the Gemini compat endpoint does not honor,
    // so the document is dropped/400s with no fallback. Keeping the flag unset
    // preserves the safe extracted-text path.
    for (const m of geminiModels) {
      expect(m.supportsDocuments, `${m.id} supportsDocuments`).toBeFalsy();
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
