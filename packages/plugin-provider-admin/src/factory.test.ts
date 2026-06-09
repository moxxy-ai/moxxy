import { describe, expect, it } from 'vitest';
import { buildProviderDef } from './factory.js';
import type { StoredProvider } from './types.js';

describe('buildProviderDef', () => {
  it('builds an openai-compat ProviderDef wired to the vendor baseURL', () => {
    const entry: StoredProvider = {
      kind: 'openai-compat',
      name: 'zai',
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
      defaultModel: 'glm-4.6',
      models: [
        { id: 'glm-4.6', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
        { id: 'glm-4.5-air', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      ],
    };
    const def = buildProviderDef(entry);
    expect(def.name).toBe('zai');
    expect(def.models.map((m) => m.id)).toEqual(['glm-4.6', 'glm-4.5-air']);
    // createClient must produce something with .stream/.countTokens — the
    // OpenAIProvider satisfies LLMProvider, we just check the shape.
    const client = def.createClient({ apiKey: 'test-key' });
    expect(typeof client.stream).toBe('function');
    expect(typeof client.countTokens).toBe('function');
    // The client reports the VENDOR's slug + catalog, not 'openai' — usage
    // stats, provider_request/response events and error context all read
    // these off the live client, so 'openai' here misattributed every
    // runtime vendor and missed context-window lookups for their models.
    expect(client.name).toBe('zai');
    expect(client.models.map((m) => m.id)).toEqual(['glm-4.6', 'glm-4.5-air']);
  });

  it('throws for unknown kinds', () => {
    expect(() => buildProviderDef({ kind: 'mystery' } as unknown as StoredProvider)).toThrow(/unsupported kind/);
  });
});
