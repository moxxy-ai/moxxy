import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { describeTrigger } from '../describe.js';
import { WEBHOOKS_CONFIG_GLOB, WEBHOOKS_STORE_GLOB, type ResolvedToolDeps } from './shared.js';

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
    // Read-only, but the store may quarantine-rename a corrupt file on load —
    // hence the write grant on the store glob (see shared.ts).
    isolation: {
      capabilities: {
        fs: {
          read: [WEBHOOKS_STORE_GLOB, WEBHOOKS_CONFIG_GLOB],
          write: [WEBHOOKS_STORE_GLOB],
        },
        net: { mode: 'none' },
        timeMs: 30_000,
      },
    },
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
