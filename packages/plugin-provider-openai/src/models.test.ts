import { expect, it } from 'vitest';
import { OpenAIProvider, openAIModels } from './provider.js';

it('adds Astra to the static API catalog using the Sol descriptor shape', () => {
  const sol = openAIModels.find((model) => model.id === 'gpt-5.6-sol');
  expect(sol).toBeDefined();
  expect(openAIModels.find((model) => model.id === 'gpt-6-astra')).toEqual({
    ...sol,
    id: 'gpt-6-astra',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
  });
  const provider = new OpenAIProvider({ apiKey: 'test-only' });
  expect(provider.models).toBe(openAIModels);
  expect(provider.models.filter((model) => model.id === 'gpt-6-astra')).toHaveLength(1);
});
