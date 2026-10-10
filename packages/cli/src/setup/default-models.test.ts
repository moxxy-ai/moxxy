import { describe, expect, it } from 'vitest';
import { configuredDefaultModels } from './default-models.js';

describe('configuredDefaultModels', () => {
  it('reads the model set for each provider', () => {
    const models = configuredDefaultModels({
      plugins: {
        provider: {
          default: 'openai-codex',
          items: { 'openai-codex': { model: 'gpt-6-luna' }, anthropic: { model: 'claude-sonnet-5-5' } },
        },
      },
    });

    expect(models).toEqual({ 'openai-codex': 'gpt-6-luna', anthropic: 'claude-sonnet-5-5' });
  });

  it('leaves out a provider that has no model set', () => {
    const models = configuredDefaultModels({
      plugins: { provider: { items: { openai: { enabled: false }, local: { config: { baseURL: 'http://x' } } } } },
    });

    expect(models).toEqual({});
  });

  it('is empty without a provider block', () => {
    expect(configuredDefaultModels({})).toEqual({});
  });
});
