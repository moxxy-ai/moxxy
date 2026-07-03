import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { describeTrigger } from '../describe.js';
import {
  filterInputSchema,
  WEBHOOKS_CONFIG_GLOB,
  WEBHOOKS_STORE_GLOB,
  type ResolvedToolDeps,
} from './shared.js';

export function defineWebhookUpdateTool(deps: ResolvedToolDeps): ToolDef {
  const { store, config } = deps;
  return defineTool({
    name: 'webhook_update',
    description:
      'Patch an existing webhook trigger. Useful for toggling enable, editing the ' +
      'prompt template, widening the allowedTools set, or tightening the filters. ' +
      'To rotate a secret, delete and recreate — silent secret rotation is intentionally ' +
      'unsupported.',
    inputSchema: z.object({
      id: z.string().min(1),
      enabled: z.boolean().optional(),
      prompt: z.string().min(1).optional(),
      allowedTools: z.array(z.string()).optional(),
      model: z.string().optional(),
      description: z.string().optional(),
      idempotencyHeader: z.string().optional(),
      filters: filterInputSchema.optional(),
      targetSessionId: z
        .string()
        .min(1)
        .optional()
        .describe('Reassign which session this webhook delivers to (where its runs execute + display).'),
    }),
    permission: { action: 'prompt' },
    isolation: {
      capabilities: {
        fs: {
          // `$cwd/**` mirrors webhook_create: a jsonPath filter rule's `path`
          // field is a JSON body path the cap checker treats as a file path.
          read: ['$cwd/**', WEBHOOKS_STORE_GLOB, WEBHOOKS_CONFIG_GLOB],
          write: [WEBHOOKS_STORE_GLOB],
        },
        net: { mode: 'none' },
        timeMs: 30_000,
      },
    },
    handler: async ({ id, targetSessionId, ...patch }) => {
      // `targetSessionId` is the user-facing name for the stored `ownerSessionId`
      // routing key — map it so reassigning a webhook re-homes its deliveries.
      const updated = await store.update(id, {
        ...patch,
        ...(targetSessionId !== undefined ? { ownerSessionId: targetSessionId } : {}),
      });
      if (!updated) return { ok: false, reason: 'no trigger with that id' };
      const cfg = await config.get();
      return { ok: true, trigger: describeTrigger(updated, cfg.publicUrl) };
    },
  });
}
