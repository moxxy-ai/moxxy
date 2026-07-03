import { rm } from 'node:fs/promises';
import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import {
  secretFilePath,
  WEBHOOKS_SECRETS_GLOB,
  WEBHOOKS_STORE_GLOB,
  type ResolvedToolDeps,
} from './shared.js';

export function defineWebhookDeleteTool(deps: ResolvedToolDeps): ToolDef {
  const { store, secretsDir } = deps;
  return defineTool({
    name: 'webhook_delete',
    description:
      'Permanently remove a webhook trigger by id. Does NOT touch any subscription ' +
      "registered on the external side — the user must also delete the webhook from " +
      "the source's dashboard, otherwise it'll keep retrying.",
    inputSchema: z.object({ id: z.string().min(1) }),
    permission: { action: 'prompt' },
    isolation: {
      capabilities: {
        fs: {
          read: [WEBHOOKS_STORE_GLOB],
          write: [WEBHOOKS_STORE_GLOB, WEBHOOKS_SECRETS_GLOB],
        },
        net: { mode: 'none' },
        timeMs: 30_000,
      },
    },
    handler: async ({ id }) => {
      const trigger = await store.get(id);
      const deleted = await store.delete(id);
      if (deleted && trigger) {
        // Best-effort cleanup of the out-of-band secret file, if one was issued.
        await rm(secretFilePath(secretsDir, trigger.name), { force: true }).catch(() => {});
      }
      return { deleted };
    },
  });
}
