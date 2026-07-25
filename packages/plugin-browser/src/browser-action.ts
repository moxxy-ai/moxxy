import { z } from '@moxxy/sdk';

const requiredTabId = z.string().min(1).max(256);
const optionalTabId = requiredTabId.optional();
const publicHttpUrl = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), 'only http(s) URLs allowed');

export const browserSessionActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('goto'),
    url: publicHttpUrl,
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    tabId: optionalTabId,
  }),
  z.object({
    kind: z.literal('click'),
    selector: z.string().min(1),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
    tabId: optionalTabId,
  }),
  z.object({
    kind: z.literal('fill'),
    selector: z.string().min(1),
    value: z.string(),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
    tabId: optionalTabId,
  }),
  z.object({ kind: z.literal('text'), selector: z.string().optional(), tabId: optionalTabId }),
  z.object({ kind: z.literal('html'), tabId: optionalTabId }),
  z.object({ kind: z.literal('screenshot'), fullPage: z.boolean().optional(), tabId: optionalTabId }),
  z.object({ kind: z.literal('eval'), expression: z.string().min(1), tabId: optionalTabId }),
  z.object({ kind: z.literal('url'), tabId: optionalTabId }),
  z.object({ kind: z.literal('tabs') }),
  z.object({ kind: z.literal('new_tab'), url: publicHttpUrl.optional() }),
  z.object({ kind: z.literal('select_tab'), tabId: requiredTabId }),
  z.object({ kind: z.literal('close_tab'), tabId: requiredTabId }),
]);

export type BrowserSessionAction = z.infer<typeof browserSessionActionSchema>;
