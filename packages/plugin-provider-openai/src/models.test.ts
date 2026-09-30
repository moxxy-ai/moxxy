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

it('lists only current models: GPT-6 and GPT-5.6, each with its documented window', () => {
  expect(openAIModels.map((m) => [m.id, m.contextWindow, m.maxOutputTokens])).toEqual([
    ['gpt-6-astra', 1_050_000, 128_000],
    ['gpt-6-sol', 1_050_000, 128_000],
    ['gpt-6-luna', 1_050_000, 128_000],
    ['gpt-5.6-sol', 1_050_000, 128_000],
    ['gpt-5.6-terra', 1_050_000, 128_000],
    ['gpt-5.6-luna', 1_050_000, 128_000],
  ]);
});

it('defaults to a model that is still listed', async () => {
  let sent: string | undefined;
  const client = {
    chat: {
      completions: {
        create: async (body: { model: string }) => {
          sent = body.model;
          return (async function* () {})();
        },
      },
    },
  };
  const provider = new OpenAIProvider({ client: client as never });
  for await (const _ of provider.stream({ model: '', messages: [] })) {
    // drain
  }
  expect(openAIModels.map((m) => m.id)).toContain(sent);
});
