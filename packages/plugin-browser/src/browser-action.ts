import { z } from '@moxxy/sdk';

const requiredTabId = z.string().min(1).max(256);
const optionalTabId = requiredTabId.optional();
const selector = z.string().min(1).max(16_384);
const revision = z.string().min(1).max(128);
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

const clickActionSchema = z
  .object({
    kind: z.literal('click'),
    selector: selector.optional(),
    target: browserTargetSchema.optional(),
    button: z.enum(['left', 'middle', 'right']).optional(),
    count: z.number().int().min(1).max(3).optional(),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
    tabId: optionalTabId,
  })
  .strict()
  .superRefine((action, context) => {
    if (Boolean(action.selector) === Boolean(action.target)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provide exactly one of selector or target',
        path: ['target'],
      });
    }
  });

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

export const browserSessionActionSchema = z.union([
  z.object({
    kind: z.literal('goto'),
    url: publicHttpUrl,
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    tabId: optionalTabId,
  }).strict(),
  clickActionSchema,
  z
    .object({
      kind: z.literal('fill'),
      selector,
      value: z.string().max(2 * 1024 * 1024),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
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
      modifiers: z
        .array(z.enum(['alt', 'control', 'meta', 'shift']))
        .max(4)
        .optional(),
      target: textTargetSchema.optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('scroll'),
      deltaX: z.number().finite().min(-100_000).max(100_000).optional(),
      deltaY: z.number().finite().min(-100_000).max(100_000).optional(),
      at: z
        .object({
          x: normalizedCoordinate,
          y: normalizedCoordinate,
        })
        .strict()
        .optional(),
      tabId: optionalTabId,
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
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('select'),
      target: textTargetSchema,
      values: z.array(z.string().max(4_096)).min(1).max(20),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('upload'),
      target: textTargetSchema,
      paths: z.array(z.string().min(1).max(4_096)).min(1).max(16),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
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
      mode: z.enum(['semantic', 'visual', 'hybrid']).optional(),
      maxNodes: z.number().int().min(1).max(300).optional(),
      maxTextChars: z.number().int().min(0).max(20_000).optional(),
      tabId: optionalTabId,
    })
    .strict(),
  z.object({ kind: z.literal('text'), selector: selector.optional(), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('html'), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('screenshot'), fullPage: z.boolean().optional(), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('eval'), expression: z.string().min(1).max(2 * 1024 * 1024), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('url'), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('back'), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('forward'), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('reload'), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('tabs') }).strict(),
  z.object({ kind: z.literal('new_tab'), url: publicHttpUrl.optional() }).strict(),
  z.object({ kind: z.literal('select_tab'), tabId: requiredTabId }).strict(),
  z.object({ kind: z.literal('close_tab'), tabId: requiredTabId }).strict(),
]);

export type BrowserSessionAction = z.infer<typeof browserSessionActionSchema>;
export type BrowserTarget = z.infer<typeof browserTargetSchema>;
