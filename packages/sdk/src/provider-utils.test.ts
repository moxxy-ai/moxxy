import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './provider-utils.js';
import { resolveProviderTools } from './provider-tool-utils.js';
import { defineTool } from './define.js';

/**
 * Regression coverage for the codex `/responses` 400 we hit when a tool's
 * input schema was `z.object(...).and(z.object(...).refine(...))`. The old
 * converter fell through to a bare `{ type: 'object' }` (no `properties`
 * key), and Codex rejects that. These tests pin every wrapper kind so the
 * fix doesn't silently regress.
 */
describe('zodToJsonSchema', () => {
  it('unwraps ZodEffects (.refine) to the underlying object', () => {
    const schema = z
      .object({ a: z.string(), b: z.number() })
      .refine((v) => v.a.length > 0);
    const out = zodToJsonSchema(schema) as Record<string, unknown>;
    expect(out.type).toBe('object');
    expect(out.properties).toEqual({
      a: { type: 'string' },
      b: { type: 'number' },
    });
    expect(out.required).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('merges ZodIntersection of two ZodObjects into one object schema', () => {
    const left = z.object({ name: z.string() });
    const right = z.object({ count: z.number() });
    const out = zodToJsonSchema(left.and(right)) as Record<string, unknown>;
    expect(out.type).toBe('object');
    expect(out.properties).toEqual({
      name: { type: 'string' },
      count: { type: 'number' },
    });
    expect(out.required).toEqual(expect.arrayContaining(['name', 'count']));
  });

  it('matches the scheduler tool shape (object .and(object.refine))', () => {
    // The actual shape that triggered the codex 400.
    const cronOrTimestamp = z
      .object({ cron: z.string().optional(), runAt: z.number().optional() })
      .refine((v) => !!v.cron || v.runAt !== undefined);
    const schema = z
      .object({ name: z.string(), prompt: z.string() })
      .and(cronOrTimestamp);
    const out = zodToJsonSchema(schema) as Record<string, unknown>;
    expect(out.type).toBe('object');
    expect(out.properties).toBeDefined();
    expect(out.properties).toMatchObject({
      name: { type: 'string' },
      prompt: { type: 'string' },
      cron: { type: 'string' },
      runAt: { type: 'number' },
    });
  });

  it('unwraps ZodOptional / ZodDefault / ZodNullable', () => {
    expect(zodToJsonSchema(z.string().optional())).toEqual({ type: 'string' });
    expect(zodToJsonSchema(z.number().default(0))).toEqual({ type: 'number' });
    expect(zodToJsonSchema(z.string().nullable())).toEqual({ type: 'string' });
  });

  it('converts ZodEnum to string + enum list', () => {
    const out = zodToJsonSchema(z.enum(['a', 'b', 'c'])) as Record<string, unknown>;
    expect(out).toEqual({ type: 'string', enum: ['a', 'b', 'c'] });
  });

  it('converts ZodUnion via anyOf', () => {
    const out = zodToJsonSchema(z.union([z.string(), z.number()])) as Record<string, unknown>;
    expect(out.anyOf).toEqual([{ type: 'string' }, { type: 'number' }]);
  });

  it('unknown schemas fall back to an object with explicit properties', () => {
    // Synthetic "unknown" wrapper — uses a typeName the converter doesn't know.
    const out = zodToJsonSchema({ _def: { typeName: 'ZodNeverHeardOfIt' } }) as Record<
      string,
      unknown
    >;
    // The key fix: properties is always present, even on the catch-all path,
    // so strict validators (codex /responses) don't reject the tool.
    expect(out).toHaveProperty('type', 'object');
    expect(out).toHaveProperty('properties');
  });

  it('bounds recursion on a deeply nested schema instead of overflowing the stack', () => {
    // Build a pathologically deep array nesting; the converter must degrade to
    // the permissive {} past its depth cap rather than blow the call stack.
    let schema: z.ZodTypeAny = z.string();
    for (let i = 0; i < 500; i++) schema = z.array(schema);
    expect(() => zodToJsonSchema(schema)).not.toThrow();
    const out = zodToJsonSchema(schema);
    expect(out).toBeDefined();
  });
});

describe('resolveProviderTools', () => {
  const webSearch = defineTool({
    name: 'web_search',
    description: 'fallback',
    inputSchema: z.object({ query: z.string() }),
    hosted: { type: 'web_search' },
    handler: () => [],
  });
  const read = defineTool({
    name: 'Read',
    description: 'read',
    inputSchema: z.object({ path: z.string() }),
    handler: () => '',
  });

  it('replaces a marked fallback only when the exact model advertises the hosted tool', () => {
    const resolved = resolveProviderTools(
      [read, webSearch],
      [
        {
          id: 'native-model',
          contextWindow: 100,
          supportsTools: true,
          supportsStreaming: true,
          hostedTools: ['web_search'],
        },
      ],
      'native-model',
    );
    expect(resolved.tools.map((tool) => tool.name)).toEqual(['Read']);
    expect(resolved.hostedTools).toEqual([{ type: 'web_search' }]);
  });

  it('enables a model capability even when no client fallback plugin is installed', () => {
    const resolved = resolveProviderTools(
      undefined,
      [{
        id: 'native-model',
        contextWindow: 100,
        supportsTools: true,
        supportsStreaming: true,
        hostedTools: ['web_search'],
      }],
      'native-model',
    );
    expect(resolved.tools).toEqual([]);
    expect(resolved.hostedTools).toEqual([{ type: 'web_search' }]);
  });

  it('keeps the local fallback for unsupported and unknown models', () => {
    const models = [
      { id: 'plain-model', contextWindow: 100, supportsTools: true, supportsStreaming: true },
    ];
    expect(resolveProviderTools([webSearch], models, 'plain-model').tools).toEqual([webSearch]);
    expect(resolveProviderTools([webSearch], models, 'catalog-drift').tools).toEqual([webSearch]);
  });
});

/**
 * Field descriptions are the only place a tool author can say what a parameter
 * means, and the model is the audience. They were dropped on the floor: every
 * `.describe()` in every moxxy tool reached the provider as nothing at all,
 * which is how a model ends up inventing `tab_id: "current"` for a field whose
 * description reads "Omit for the active tab".
 */
describe('zodToJsonSchema — descriptions', () => {
  it('carries a field description through to the model', () => {
    const out = zodToJsonSchema(z.object({ a: z.string().describe('Co to jest a') })) as {
      properties: Record<string, Record<string, unknown>>;
    };

    expect(out.properties.a).toEqual({ type: 'string', description: 'Co to jest a' });
  });

  it('keeps a description that sits under a wrapper', () => {
    expect(zodToJsonSchema(z.string().describe('opis').optional())).toEqual({
      type: 'string',
      description: 'opis',
    });
  });

  it('lets the outermost description win when a wrapper carries one too', () => {
    const schema = z.string().describe('wewnetrzny').optional().describe('zewnetrzny');

    expect(zodToJsonSchema(schema)).toEqual({ type: 'string', description: 'zewnetrzny' });
  });

  it('describes a whole object, an enum and an array element too', () => {
    const out = zodToJsonSchema(
      z
        .object({
          mode: z.enum(['a', 'b']).describe('Tryb'),
          tags: z.array(z.string()).describe('Etykiety'),
        })
        .describe('Cale wejscie'),
    ) as { description: string; properties: Record<string, Record<string, unknown>> };

    expect(out.description).toBe('Cale wejscie');
    expect(out.properties.mode?.description).toBe('Tryb');
    expect(out.properties.tags?.description).toBe('Etykiety');
  });

  it('adds no description key when the author wrote none', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' });
    expect(zodToJsonSchema(z.object({ a: z.string() }))).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    });
  });
});
