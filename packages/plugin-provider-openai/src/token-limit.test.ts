import { expect, it } from 'vitest';
import { tokenLimitParams } from './token-limit.js';

it.each(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.4-mini', 'o3'])('uses the completion budget for %s', (model) => {
  expect(tokenLimitParams(model, 1024)).toEqual({ max_completion_tokens: 1024 });
});

it.each(['gpt-4o', 'qwen3', 'glm-5'])('preserves compatible token budgets for %s', (model) => {
  expect(tokenLimitParams(model, 1024)).toEqual({ max_tokens: 1024 });
});

it('omits an unspecified budget', () => {
  expect(tokenLimitParams('gpt-6-astra', undefined)).toEqual({});
});
