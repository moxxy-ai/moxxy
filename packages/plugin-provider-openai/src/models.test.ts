import { expect, it } from 'vitest';
import { fitReasoningRequest, reasoningEffortsOf, startingModel } from '@moxxy/sdk';
import { openaiProviderDef } from './index.js';
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

it('lists the models the API and Codex offer, newest first, each with its documented window', () => {
  expect(openAIModels.map((m) => [m.id, m.contextWindow, m.maxOutputTokens])).toEqual([
    ['gpt-6.2-sol', 1_050_000, 128_000],
    ['gpt-6.2-astra', 1_050_000, 128_000],
    ['gpt-6.1-terra', 1_050_000, 128_000],
    ['gpt-6.1-sol', 1_050_000, 128_000],
    ['gpt-6-astra', 1_050_000, 128_000],
    ['gpt-6-sol', 1_050_000, 128_000],
    ['gpt-6-luna', 1_050_000, 128_000],
    ['gpt-5.6-sol', 1_050_000, 128_000],
    ['gpt-5.6-terra', 1_050_000, 128_000],
    ['gpt-5.6-luna', 1_050_000, 128_000],
  ]);
});

it('offers GPT-6 Luna as the first-turn choice before and after activation, independently of catalog order', () => {
  const active = openaiProviderDef.createClient({ apiKey: 'test-only' });
  for (const provider of [openaiProviderDef, active]) {
    expect(startingModel(provider)).toBe('gpt-6-luna');
    expect(startingModel({ ...provider, models: [...provider.models].reverse() })).toBe('gpt-6-luna');
  }
});

it('preserves the starting model of named OpenAI-compatible providers', () => {
  const vendor = new OpenAIProvider({ name: 'other', apiKey: 'test-only', models: openAIModels });
  expect(startingModel(vendor)).toBe('gpt-6.2-sol');
});

it('uses GPT-6 Luna when a request arrives without a model', async () => {
  let sent: string | undefined;
  const client = {
    responses: {
      create: async (body: { model: string }) => {
        sent = body.model;
        return (async function* () { yield { type: 'response.completed', response: { output: [] } }; })();
      },
    },
  };
  const provider = new OpenAIProvider({ client: client as never });
  for await (const _ of provider.stream({ model: '', messages: [] })) {
    // drain
  }
  expect(sent).toBe('gpt-6-luna');
});

it('offers every model up to Max, the deepest effort the OpenAI API takes', () => {
  for (const model of openAIModels) {
    expect(reasoningEffortsOf(model), model.id).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  }
});

it('asks the API for Max when a turn wants Max or Ultra', async () => {
  const luna = openAIModels.find((model) => model.id === 'gpt-6-luna');
  const sent: Array<unknown> = [];
  const client = {
    responses: {
      create: async (body: { reasoning?: { effort?: unknown } }) => {
        sent.push(body.reasoning?.effort);
        return (async function* () { yield { type: 'response.completed', response: { output: [] } }; })();
      },
    },
  };
  const provider = new OpenAIProvider({ client: client as never });
  for (const effort of ['max', 'ultra'] as const) {
    const reasoning = fitReasoningRequest({ effort }, luna);
    for await (const _ of provider.stream({ model: 'gpt-6-luna', messages: [], reasoning })) {
      // drain
    }
  }
  expect(sent).toEqual(['max', 'max']);
});
