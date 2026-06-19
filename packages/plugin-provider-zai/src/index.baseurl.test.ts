import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DefineOpenAICompatProviderSpec } from '@moxxy/plugin-provider-openai';

/**
 * The whole point of this plugin is that traffic (and the z.ai key) goes to
 * api.z.ai — the OpenAI-compatible endpoint for `zai`, the Anthropic-compatible
 * endpoint for `zai-coding-plan` — and NEVER to openai.com / anthropic.com. The
 * resolved base URLs are private inside the underlying SDK clients, so a
 * refactor that dropped `ZAI_OPENAI_BASE_URL` / `ZAI_ANTHROPIC_BASE_URL` (or
 * routed one mode through the wrong vendor) would ship the z.ai credential to
 * the wrong host and still pass the rest of the suite.
 *
 * These tests pin the wiring at zai's own trust boundary: they mock zai's two
 * direct workspace deps and assert that the z.ai base URLs (and slug/catalog)
 * reach the construction call. The real `pickOpenAICompatConfig` narrowing is
 * preserved so the `zai-coding-plan` config-handling stays exercised.
 */

const ZAI_OPENAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
const ZAI_ANTHROPIC_BASE_URL = 'https://api.z.ai/api/anthropic';

/** Captured spec from the (mocked) defineOpenAICompatProvider call. */
let compatSpec: DefineOpenAICompatProviderSpec | undefined;
/** Captured config from the (mocked) AnthropicProvider construction. */
let anthropicConfig: Record<string, unknown> | undefined;

vi.mock('@moxxy/plugin-provider-openai', async (importActual) => {
  const actual = await importActual<typeof import('@moxxy/plugin-provider-openai')>();
  return {
    ...actual,
    // Capture the spec zai hands the shared factory, and return a tiny stub
    // ProviderDef so importing index.ts doesn't construct a real SDK client.
    defineOpenAICompatProvider: (spec: DefineOpenAICompatProviderSpec) => {
      compatSpec = spec;
      return {
        name: spec.name,
        models: [...spec.models],
        createClient: () => ({ name: spec.name, models: spec.models }),
        ...(spec.auth ? { auth: spec.auth } : {}),
      };
    },
  };
});

vi.mock('@moxxy/plugin-provider-anthropic', () => ({
  // Spy class: record the config zai passes, expose name/models like the real
  // provider so any later assertions still see a usable shape.
  AnthropicProvider: class {
    name: string;
    models: unknown;
    constructor(config: Record<string, unknown>) {
      anthropicConfig = config;
      this.name = typeof config.name === 'string' ? config.name : 'anthropic';
      this.models = config.models;
    }
  },
}));

describe('@moxxy/plugin-provider-zai base-URL pinning', () => {
  beforeEach(() => {
    compatSpec = undefined;
    anthropicConfig = undefined;
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('`zai` is wired to the z.ai OpenAI-compatible endpoint, not openai.com', async () => {
    const { zaiProviderDef } = await import('./index.js');
    expect(zaiProviderDef.name).toBe('zai');
    // The slug + base URL + default model + catalog reach the shared factory.
    expect(compatSpec).toBeDefined();
    expect(compatSpec?.name).toBe('zai');
    expect(compatSpec?.baseURL).toBe(ZAI_OPENAI_BASE_URL);
    expect(compatSpec?.baseURL).not.toContain('openai.com');
    expect(compatSpec?.defaultModel).toBe('glm-4.6');
    expect(compatSpec?.models.map((m) => m.id)).toContain('glm-5.2');
  });

  it('`zai-coding-plan` constructs AnthropicProvider against the z.ai Anthropic endpoint, not anthropic.com', async () => {
    const { zaiCodingPlanProviderDef } = await import('./index.js');
    const client = zaiCodingPlanProviderDef.createClient({ apiKey: 'plan-key' });
    expect(client.name).toBe('zai-coding-plan');
    expect(anthropicConfig).toBeDefined();
    expect(anthropicConfig?.name).toBe('zai-coding-plan');
    expect(anthropicConfig?.apiKey).toBe('plan-key');
    expect(anthropicConfig?.baseURL).toBe(ZAI_ANTHROPIC_BASE_URL);
    expect(String(anthropicConfig?.baseURL)).not.toContain('anthropic.com');
    expect(anthropicConfig?.defaultModel).toBe('glm-4.6');
  });

  it('`zai-coding-plan` config may override the base URL but a wrong-typed override falls back to the z.ai endpoint', async () => {
    const { zaiCodingPlanProviderDef } = await import('./index.js');

    // A valid string override is honored (self-hosted / proxy).
    zaiCodingPlanProviderDef.createClient({ apiKey: 'k', baseURL: 'https://proxy.internal/anthropic' });
    expect(anthropicConfig?.baseURL).toBe('https://proxy.internal/anthropic');

    // A wrong-typed baseURL is dropped by pickOpenAICompatConfig and must fall
    // back to the pinned z.ai endpoint — never leak through as a bogus value.
    anthropicConfig = undefined;
    zaiCodingPlanProviderDef.createClient({ apiKey: 'k', baseURL: { not: 'a string' } } as Record<string, unknown>);
    expect(anthropicConfig?.baseURL).toBe(ZAI_ANTHROPIC_BASE_URL);
  });
});
