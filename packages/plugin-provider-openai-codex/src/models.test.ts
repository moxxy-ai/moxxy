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
