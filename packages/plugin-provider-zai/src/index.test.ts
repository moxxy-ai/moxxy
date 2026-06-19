import { describe, expect, it } from 'vitest';
import { zaiPlugin, zaiProviderDef, zaiCodingPlanProviderDef, glmModels } from './index.js';

describe('@moxxy/plugin-provider-zai', () => {
  it('registers the two GLM providers under the right names', () => {
    expect(zaiPlugin.providers?.map((p) => p.name)).toEqual(['zai', 'zai-coding-plan']);
  });

  it('advertises the GLM catalog (including the 1M-context glm-5.2 flagship)', () => {
    expect(zaiProviderDef.models).toEqual(glmModels);
    expect(zaiCodingPlanProviderDef.models).toEqual(glmModels);
    const flagship = glmModels.find((m) => m.id === 'glm-5.2');
    expect(flagship).toMatchObject({ contextWindow: 1_000_000 });
  });

  it('createClient stamps the vendor slug so usage/errors attribute to z.ai, not openai/anthropic', () => {
    const api = zaiProviderDef.createClient({ apiKey: 'test-key' });
    expect(api.name).toBe('zai');
    expect(api.models).toEqual(glmModels);

    const plan = zaiCodingPlanProviderDef.createClient({ apiKey: 'test-key' });
    expect(plan.name).toBe('zai-coding-plan');
    expect(plan.models).toEqual(glmModels);
  });

  it('narrows the untyped registry config — wrong-typed fields do not crash createClient', () => {
    // The registry hands createClient a `Record<string, unknown>`; the old
    // blanket `config as OpenAIProviderConfig` would smuggle wrong-typed
    // fields straight into the client. The runtime pick must drop non-string
    // apiKey/baseURL/defaultModel (falling back to the z.ai defaults) rather
    // than forward garbage, while still producing a usable client.
    const messy: Record<string, unknown> = {
      apiKey: 'test-key',
      baseURL: { not: 'a string' },
      defaultModel: ['nope'],
      extraneous: 'ignored',
    };
    const api = zaiProviderDef.createClient(messy);
    expect(api.name).toBe('zai');
    expect(api.models).toEqual(glmModels);
    expect(typeof api.stream).toBe('function');

    const plan = zaiCodingPlanProviderDef.createClient(messy);
    expect(plan.name).toBe('zai-coding-plan');
    expect(plan.models).toEqual(glmModels);
    expect(typeof plan.stream).toBe('function');
  });

  it('refuses to construct without a key (no env-fallback credential exfiltration to api.z.ai)', () => {
    // baseURL is pinned to api.z.ai for both modes; if createClient forwarded
    // an absent key, the underlying providers fall back to
    // ANTHROPIC_API_KEY / OPENAI_API_KEY and ship the user's real credential to
    // the third-party host. The guard must throw instead.
    for (const empty of [{}, { apiKey: undefined }, { apiKey: '' }, { apiKey: 123 }] as Record<string, unknown>[]) {
      expect(() => zaiProviderDef.createClient(empty)).toThrow(/api key/i);
      expect(() => zaiCodingPlanProviderDef.createClient(empty)).toThrow(/api key/i);
    }
  });

  it('exposes apiKey auth descriptors for both modes', () => {
    expect(zaiProviderDef.auth).toMatchObject({ kind: 'apiKey' });
    expect(zaiCodingPlanProviderDef.auth).toMatchObject({ kind: 'apiKey' });
  });

  it('the GLM-5 family + glm-4.6 advertise supportsReasoning so reasoning is requested', () => {
    // Reasoning is gated upstream on descriptor.supportsReasoning; without it
    // ProviderRequest.reasoning is always undefined for these reasoning models
    // and the streamed reasoning summary the OpenAIProvider plumbs is never
    // surfaced.
    for (const id of ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.6']) {
      expect(glmModels.find((m) => m.id === id)?.supportsReasoning, id).toBe(true);
    }
  });
});
