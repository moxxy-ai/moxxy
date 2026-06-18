import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { describeTrigger } from '../describe.js';
import { filterInputSchema, type ResolvedToolDeps } from './shared.js';

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
    }),
    permission: { action: 'prompt' },
    handler: async ({ id, ...patch }) => {
      const updated = await store.update(id, patch);
      if (!updated) return { ok: false, reason: 'no trigger with that id' };
      const cfg = await config.get();
      return { ok: true, trigger: describeTrigger(updated, cfg.publicUrl) };
    },
  });
}
