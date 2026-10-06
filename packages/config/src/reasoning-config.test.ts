import { describe, expect, it } from 'vitest';
import { contextConfigSchema } from './schema.js';

describe('context.reasoning effort', () => {
  it.each(['low', 'medium', 'high', 'xhigh'] as const)('accepts %s', (effort) => {
    expect(contextConfigSchema.parse({ reasoning: { effort } }).reasoning).toEqual({ effort });
  });

  it('rejects a level outside the list', () => {
    expect(() => contextConfigSchema.parse({ reasoning: { effort: 'extreme' } })).toThrow();
  });
});
