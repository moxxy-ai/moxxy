import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { describeTrigger } from '../describe.js';
import type { ResolvedToolDeps } from './shared.js';

export function defineWebhookListTool(deps: ResolvedToolDeps): ToolDef {
  const { store, config } = deps;
  return defineTool({
    name: 'webhook_list',
    description:
      'List every webhook trigger with its current URL (if a public URL is set), last ' +
      'fire timestamp, and outcome. Secrets are never returned.',
    inputSchema: z.object({
      includeDisabled: z.boolean().default(true),
    }),
    handler: async ({ includeDisabled }) => {
      const triggers = await store.list();
      const cfg = await config.get();
      const filtered = includeDisabled ? triggers : triggers.filter((t) => t.enabled);
      const storeWarning = await store.loadWarning();
      return {
        publicUrl: cfg.publicUrl ?? null,
        listener: { host: cfg.host, port: cfg.port },
        triggers: filtered.map((t) => describeTrigger(t, cfg.publicUrl)),
        ...(storeWarning ? { storeWarning } : {}),
      };
    },
  });
}
