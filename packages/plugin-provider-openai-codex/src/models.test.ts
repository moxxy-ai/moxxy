import { expect, it } from 'vitest';
import { codexModels, DEFAULT_CODEX_MODEL } from './models.js';

it('gives Astra an OAuth-specific operational budget without changing the default', () => {
  expect(codexModels.find((m) => m.id === 'gpt-6-astra')).toMatchObject({
    contextWindow: 258_400,
    maxOutputTokens: 16_384,
    supportsImages: true,
    supportsTools: true,
  });
  expect(DEFAULT_CODEX_MODEL).toBe('gpt-5.6-sol');
});

it('lists only the models the ChatGPT plan still serves: GPT-6 and GPT-5.6', () => {
  expect(codexModels.map((m) => m.id)).toEqual([
    'gpt-6-astra',
    'gpt-6-sol',
    'gpt-6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
  ]);
});

it("budgets every model to the Codex backend's 272k window less its 5% margin", () => {
  for (const model of codexModels) {
    expect(model).toMatchObject({
      contextWindow: 258_400,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsImages: true,
      supportsReasoning: true,
    });
  }
});

it('offers fast mode on every model the plan serves', () => {
  for (const model of codexModels) expect(model.supportsFast, model.id).toBe(true);
});
