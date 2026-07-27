import { z } from 'zod';

/** Increment when the native socket request/response contract changes. */
export const NATIVE_BROWSER_PROTOCOL_VERSION = 3;

const requiredTabId = z.string().trim().min(1).max(256);
const optionalTabId = requiredTabId.optional();
const selector = z.string().trim().min(1).max(16_384);
const revision = z.string().trim().min(1).max(128);
const browserRef = z.string().regex(/^b[1-9][0-9]{0,5}$/);
const normalizedCoordinate = z.number().finite().min(0).max(1_000);
const publicHttpUrl = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), 'only http(s) URLs allowed');

export const browserTargetSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ref'),
      ref: browserRef,
      revision,
    })
    .strict(),
  z
    .object({
      type: z.literal('selector'),
      selector,
    })
    .strict(),
  z
    .object({
      type: z.literal('point'),
      x: normalizedCoordinate.describe('Viewport-relative X from 0 to 1000.'),
      y: normalizedCoordinate.describe('Viewport-relative Y from 0 to 1000.'),
    })
    .strict(),
]);

const textTargetSchema = z.union([
  z
    .object({
      type: z.literal('ref'),
      ref: browserRef,
      revision,
    })
    .strict(),
  z
    .object({
      type: z.literal('selector'),
      selector,
    })
    .strict(),
]);

const waitConditionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('target'),
      target: textTargetSchema,
      state: z.enum(['visible', 'hidden']),
    })
    .strict(),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(4_096) }).strict(),
  z.object({ type: z.literal('url'), includes: z.string().min(1).max(4_096) }).strict(),
  z.object({ type: z.literal('networkidle') }).strict(),
]);

export const browserExpectationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), includes: z.string().min(1).max(4_096) }).strict(),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(4_096) }).strict(),
  z.object({ type: z.literal('element'), target: textTargetSchema, state: z.enum(['visible', 'hidden']) }).strict(),
  z.object({
    type: z.literal('control'),
    target: textTargetSchema,
    property: z.enum(['value', 'checked', 'disabled']),
    equals: z.union([z.string().max(4_096), z.boolean()]),
  }).strict(),
  z.object({
    type: z.literal('computed_style'),
    target: textTargetSchema,
    property: z.enum(['background-color', 'color', 'opacity', 'display', 'visibility']),
    equals: z.string().min(1).max(256),
  }).strict(),
  z.object({
    type: z.literal('visual_region'),
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    width: normalizedCoordinate,
    height: normalizedCoordinate,
  }).strict(),
]);

const canonicalBrowserSessionActionSchema = z.union([
  z
    .object({
      kind: z.literal('goto'),
      url: publicHttpUrl,
      waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
      timeoutMs: z.number().int().positive().max(120_000).optional(),
      expect: browserExpectationSchema.optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('click'),
      target: browserTargetSchema,
      button: z.enum(['left', 'middle', 'right']).optional(),
      count: z.number().int().min(1).max(3).optional(),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
      expect: browserExpectationSchema.optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('type'),
      target: textTargetSchema,
      value: z.string().max(2 * 1024 * 1024),
      replace: z.boolean().optional(),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
      expect: browserExpectationSchema.optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('hover'),
      target: browserTargetSchema,
      timeoutMs: z.number().int().positive().max(60_000).optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('press'),
      key: z.string().min(1).max(64),
      modifiers: z.array(z.enum(['alt', 'control', 'meta', 'shift'])).max(4).optional(),
      target: textTargetSchema.optional(),
      tabId: optionalTabId,
      expect: browserExpectationSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('scroll'),
      deltaX: z.number().finite().min(-100_000).max(100_000).optional(),
      deltaY: z.number().finite().min(-100_000).max(100_000).optional(),
      at: z.object({ x: normalizedCoordinate, y: normalizedCoordinate }).strict().optional(),
      tabId: optionalTabId,
      expect: browserExpectationSchema.optional(),
    })
    .strict()
    .refine((action) => action.deltaX !== undefined || action.deltaY !== undefined, {
      message: 'provide deltaX or deltaY',
    }),
  z
    .object({
      kind: z.literal('drag'),
      from: browserTargetSchema,
      to: browserTargetSchema,
      steps: z.number().int().min(2).max(60).optional(),
      expect: browserExpectationSchema.optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('select'),
      target: textTargetSchema,
      values: z.array(z.string().max(4_096)).min(1).max(20),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
      expect: browserExpectationSchema.optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('upload'),
      target: textTargetSchema,
      paths: z.array(z.string().trim().min(1).max(4_096)).min(1).max(16),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
      expect: browserExpectationSchema.optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('wait'),
      condition: waitConditionSchema,
      timeoutMs: z.number().int().positive().max(120_000).optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('observe'),
      mode: z.enum(['auto', 'semantic', 'visual', 'hybrid']).optional(),
      maxNodes: z.number().int().min(1).max(300).optional(),
      maxTextChars: z.number().int().min(0).max(20_000).optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z.object({ kind: z.literal('inspect'), target: browserTargetSchema, tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('text'), target: textTargetSchema.optional(), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('html'), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('screenshot'), fullPage: z.boolean().optional(), tabId: optionalTabId }).strict(),
  z.object({
    kind: z.literal('eval'),
    expression: z.string().min(1).max(2 * 1024 * 1024),
    expect: browserExpectationSchema.optional(),
    tabId: optionalTabId,
  }).strict(),
  z.object({ kind: z.literal('url'), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('back'), tabId: optionalTabId, expect: browserExpectationSchema.optional() }).strict(),
  z.object({ kind: z.literal('forward'), tabId: optionalTabId, expect: browserExpectationSchema.optional() }).strict(),
  z.object({ kind: z.literal('reload'), tabId: optionalTabId, expect: browserExpectationSchema.optional() }).strict(),
  z.object({ kind: z.literal('tabs') }).strict(),
  z.object({ kind: z.literal('new_tab'), url: publicHttpUrl.optional() }).strict(),
  z.object({ kind: z.literal('select_tab'), tabId: requiredTabId }).strict(),
  z.object({ kind: z.literal('close_tab'), tabId: requiredTabId }).strict(),
]);

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Accept the pre-0.34 selector/fill surface without exposing it to providers.
 * The canonical target always wins when a provider sends both generations of
 * the contract, which is how real OpenAI calls triggered the Canva regression.
 */
function normalizeLegacyBrowserAction(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const source = input as Record<string, unknown>;
  const action: Record<string, unknown> = { ...source };
  const tabId = nonBlankString(action.tabId);
  if (tabId) action.tabId = tabId;
  else delete action.tabId;

  if (action.kind === 'click') {
    const legacySelector = nonBlankString(action.selector);
    if (!action.target && legacySelector) {
      action.target = { type: 'selector', selector: legacySelector };
    }
    delete action.selector;
  }

  if (action.kind === 'fill') {
    const legacySelector = nonBlankString(action.selector);
    return {
      kind: 'type',
      ...(legacySelector
        ? { target: { type: 'selector', selector: legacySelector } }
        : {}),
      value: action.value,
      replace: true,
      ...(action.timeoutMs === undefined ? {} : { timeoutMs: action.timeoutMs }),
      ...(tabId ? { tabId } : {}),
    };
  }

  if (action.kind === 'text' && 'selector' in action) {
    const legacySelector = nonBlankString(action.selector);
    if (!action.target && legacySelector) {
      action.target = { type: 'selector', selector: legacySelector };
    }
    delete action.selector;
  }

  return action;
}

export const browserSessionActionSchema = z.preprocess(
  normalizeLegacyBrowserAction,
  canonicalBrowserSessionActionSchema,
);

type JsonSchema = Readonly<Record<string, unknown>>;

const stringSchema = (maxLength: number, minLength = 1): JsonSchema => ({
  type: 'string',
  minLength,
  maxLength,
});

const targetJsonSchema: JsonSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['ref'] },
        ref: { type: 'string', pattern: '^b[1-9][0-9]{0,5}$' },
        revision: stringSchema(128),
      },
      required: ['type', 'ref', 'revision'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['selector'] },
        selector: stringSchema(16_384),
      },
      required: ['type', 'selector'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['point'] },
        x: { type: 'number', minimum: 0, maximum: 1_000 },
        y: { type: 'number', minimum: 0, maximum: 1_000 },
      },
      required: ['type', 'x', 'y'],
      additionalProperties: false,
    },
  ],
};

const textTargetJsonSchema: JsonSchema = {
  oneOf: (targetJsonSchema.oneOf as readonly unknown[]).slice(0, 2),
};

const enumSchema = (values: readonly string[]): JsonSchema => ({ type: 'string', enum: values });

const expectationJsonSchema: JsonSchema = {
  oneOf: [
    {
      type: 'object', properties: {
        type: { type: 'string', enum: ['url'] }, includes: stringSchema(4_096),
      }, required: ['type', 'includes'], additionalProperties: false,
    },
    {
      type: 'object', properties: {
        type: { type: 'string', enum: ['text'] }, text: stringSchema(4_096),
      }, required: ['type', 'text'], additionalProperties: false,
    },
    {
      type: 'object', properties: {
        type: { type: 'string', enum: ['element'] }, target: textTargetJsonSchema,
        state: enumSchema(['visible', 'hidden']),
      }, required: ['type', 'target', 'state'], additionalProperties: false,
    },
    {
      type: 'object', properties: {
        type: { type: 'string', enum: ['control'] }, target: textTargetJsonSchema,
        property: enumSchema(['value', 'checked', 'disabled']),
        equals: { oneOf: [{ type: 'string', maxLength: 4_096 }, { type: 'boolean' }] },
      }, required: ['type', 'target', 'property', 'equals'], additionalProperties: false,
    },
    {
      type: 'object', properties: {
        type: { type: 'string', enum: ['computed_style'] }, target: textTargetJsonSchema,
        property: enumSchema(['background-color', 'color', 'opacity', 'display', 'visibility']),
        equals: stringSchema(256),
      }, required: ['type', 'target', 'property', 'equals'], additionalProperties: false,
    },
    {
      type: 'object', properties: {
        type: { type: 'string', enum: ['visual_region'] },
        x: { type: 'number', minimum: 0, maximum: 1_000 },
        y: { type: 'number', minimum: 0, maximum: 1_000 },
        width: { type: 'number', minimum: 0, maximum: 1_000 },
        height: { type: 'number', minimum: 0, maximum: 1_000 },
      }, required: ['type', 'x', 'y', 'width', 'height'], additionalProperties: false,
    },
  ],
};

const tabIdJsonSchema = stringSchema(256);
const timeoutJsonSchema = (maximum: number): JsonSchema => ({
  type: 'integer', minimum: 1, maximum,
});

function actionJsonSchema(
  kind: string,
  properties: Readonly<Record<string, unknown>> = {},
  required: readonly string[] = [],
  extra: Readonly<Record<string, unknown>> = {},
): JsonSchema {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [kind] },
      ...properties,
    },
    required: ['kind', ...required],
    additionalProperties: false,
    ...extra,
  };
}

const tab = { tabId: tabIdJsonSchema };
const timeout60 = { timeoutMs: timeoutJsonSchema(60_000) };

/** Exact schema shown to model providers. Legacy selector/fill fields exist
 * only in the Zod compatibility parser above and can never be generated from
 * this contract. */
export const browserSessionActionInputJsonSchema: JsonSchema = {
  type: 'object',
  properties: {
    action: {
      oneOf: [
        actionJsonSchema('goto', {
          url: { type: 'string', format: 'uri', pattern: '^https?://' },
          waitUntil: enumSchema(['load', 'domcontentloaded', 'networkidle']),
          timeoutMs: timeoutJsonSchema(120_000), expect: expectationJsonSchema, ...tab,
        }, ['url']),
        actionJsonSchema('click', {
          target: targetJsonSchema,
          button: enumSchema(['left', 'middle', 'right']),
          count: { type: 'integer', minimum: 1, maximum: 3 },
          expect: expectationJsonSchema, ...timeout60, ...tab,
        }, ['target']),
        actionJsonSchema('type', {
          target: textTargetJsonSchema,
          value: stringSchema(2 * 1024 * 1024, 0),
          replace: { type: 'boolean' }, expect: expectationJsonSchema, ...timeout60, ...tab,
        }, ['target', 'value']),
        actionJsonSchema('hover', { target: targetJsonSchema, ...timeout60, ...tab }, ['target']),
        actionJsonSchema('press', {
          key: stringSchema(64),
          modifiers: { type: 'array', items: enumSchema(['alt', 'control', 'meta', 'shift']), maxItems: 4 },
          target: textTargetJsonSchema, expect: expectationJsonSchema, ...tab,
        }, ['key']),
        actionJsonSchema('scroll', {
          deltaX: { type: 'number', minimum: -100_000, maximum: 100_000 },
          deltaY: { type: 'number', minimum: -100_000, maximum: 100_000 },
          at: {
            type: 'object',
            properties: {
              x: { type: 'number', minimum: 0, maximum: 1_000 },
              y: { type: 'number', minimum: 0, maximum: 1_000 },
            },
            required: ['x', 'y'], additionalProperties: false,
          }, expect: expectationJsonSchema, ...tab,
        }, [], { anyOf: [{ required: ['deltaX'] }, { required: ['deltaY'] }] }),
        actionJsonSchema('drag', {
          from: targetJsonSchema, to: targetJsonSchema,
          steps: { type: 'integer', minimum: 2, maximum: 60 }, expect: expectationJsonSchema, ...tab,
        }, ['from', 'to']),
        actionJsonSchema('select', {
          target: textTargetJsonSchema,
          values: { type: 'array', items: stringSchema(4_096, 0), minItems: 1, maxItems: 20 },
          expect: expectationJsonSchema, ...timeout60, ...tab,
        }, ['target', 'values']),
        actionJsonSchema('upload', {
          target: textTargetJsonSchema,
          paths: { type: 'array', items: stringSchema(4_096), minItems: 1, maxItems: 16 },
          expect: expectationJsonSchema, ...timeout60, ...tab,
        }, ['target', 'paths']),
        actionJsonSchema('wait', {
          condition: {
            oneOf: [
              {
                type: 'object', properties: {
                  type: { type: 'string', enum: ['target'] },
                  target: textTargetJsonSchema,
                  state: enumSchema(['visible', 'hidden']),
                }, required: ['type', 'target', 'state'], additionalProperties: false,
              },
              {
                type: 'object', properties: {
                  type: { type: 'string', enum: ['text'] }, text: stringSchema(4_096),
                }, required: ['type', 'text'], additionalProperties: false,
              },
              {
                type: 'object', properties: {
                  type: { type: 'string', enum: ['url'] }, includes: stringSchema(4_096),
                }, required: ['type', 'includes'], additionalProperties: false,
              },
              {
                type: 'object', properties: { type: { type: 'string', enum: ['networkidle'] } },
                required: ['type'], additionalProperties: false,
              },
            ],
          }, timeoutMs: timeoutJsonSchema(120_000), ...tab,
        }, ['condition']),
        actionJsonSchema('observe', {
          mode: enumSchema(['auto', 'semantic', 'visual', 'hybrid']),
          maxNodes: { type: 'integer', minimum: 1, maximum: 300 },
          maxTextChars: { type: 'integer', minimum: 0, maximum: 20_000 }, ...tab,
        }),
        actionJsonSchema('inspect', { target: targetJsonSchema, ...tab }, ['target']),
        actionJsonSchema('text', { target: textTargetJsonSchema, ...tab }),
        actionJsonSchema('html', tab),
        actionJsonSchema('screenshot', { fullPage: { type: 'boolean' }, ...tab }),
        actionJsonSchema('eval', {
          expression: stringSchema(2 * 1024 * 1024), expect: expectationJsonSchema, ...tab,
        }, ['expression']),
        actionJsonSchema('url', tab),
        actionJsonSchema('back', { ...tab, expect: expectationJsonSchema }),
        actionJsonSchema('forward', { ...tab, expect: expectationJsonSchema }),
        actionJsonSchema('reload', { ...tab, expect: expectationJsonSchema }),
        actionJsonSchema('tabs'),
        actionJsonSchema('new_tab', { url: { type: 'string', format: 'uri', pattern: '^https?://' } }),
        actionJsonSchema('select_tab', { tabId: tabIdJsonSchema }, ['tabId']),
        actionJsonSchema('close_tab', { tabId: tabIdJsonSchema }, ['tabId']),
      ],
    },
  },
  required: ['action'],
  additionalProperties: false,
};

export type BrowserSessionAction = z.infer<typeof canonicalBrowserSessionActionSchema>;
export type BrowserTarget = z.infer<typeof browserTargetSchema>;
