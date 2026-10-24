import { describe, expect, it } from 'vitest';
import { startingModel } from './starting-model.js';

describe('startingModel', () => {
  const models = [{ id: 'big' }, { id: 'medium' }, { id: 'light' }];

  it("is the provider's starter model when it lists it", () => {
    expect(startingModel({ models, starterModel: 'light' })).toBe('light');
  });

  it('is the first listed model without a starter model, or when the starter is not listed', () => {
    expect(startingModel({ models })).toBe('big');
    expect(startingModel({ models, starterModel: 'retired' })).toBe('big');
  });

  it('is nothing for a provider that lists no models', () => {
    expect(startingModel({ models: [], starterModel: 'light' })).toBeUndefined();
  });
});
