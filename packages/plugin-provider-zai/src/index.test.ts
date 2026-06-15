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

  it('exposes apiKey auth descriptors for both modes', () => {
    expect(zaiProviderDef.auth).toMatchObject({ kind: 'apiKey' });
    expect(zaiCodingPlanProviderDef.auth).toMatchObject({ kind: 'apiKey' });
  });
});
