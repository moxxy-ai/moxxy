import { describe, expect, it } from 'vitest';
import { openAIModels } from './provider.js';

describe('current OpenAI chat catalog', () => {
  it.each(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])('advertises %s with its API limits', (id) => {
    expect(openAIModels.find((model) => model.id === id)).toMatchObject({
      contextWindow: 1_050_000, maxOutputTokens: 128_000,
      supportsTools: true, supportsStreaming: true, supportsImages: true, supportsReasoning: true,
    });
  });
});
