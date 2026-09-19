import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './provider-utils.js';

describe('model-visible validation constraints', () => {
  it('preserves integer limits including exclusive positive bounds', () => {
    expect(zodToJsonSchema(z.number().int().min(500).max(8000))).toEqual({ type: 'integer', minimum: 500, maximum: 8000 });
    expect(zodToJsonSchema(z.number().positive().lt(10))).toEqual({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 });
  });
  it('preserves string lengths and supported key patterns', () => {
    expect(zodToJsonSchema(z.string().min(1).max(160))).toEqual({ type: 'string', minLength: 1, maxLength: 160 });
    expect(zodToJsonSchema(z.string().regex(/^(enter|tab)$/))).toEqual({ type: 'string', pattern: '^(enter|tab)$' });
    expect(zodToJsonSchema(z.string().length(3))).toEqual({ type: 'string', minLength: 3, maxLength: 3 });
  });
  it('preserves array bounds', () => {
    expect(zodToJsonSchema(z.array(z.string()).min(1).max(4))).toEqual({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 });
    expect(zodToJsonSchema(z.array(z.number()).length(2))).toEqual({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 });
  });
  it('preserves an explicit null alternative through optional and transform wrappers', () => {
    const schema = z.object({ root: z.object({ id: z.string().min(1) }).nullable().optional().transform(value => value ?? undefined) });
    expect(zodToJsonSchema(schema)).toMatchObject({
      required: [], properties: { root: { anyOf: [
        { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'] },
        { type: 'null' },
      ] } },
    });
    expect(schema.parse({ root: null })).toEqual({ root: undefined });
  });
});
