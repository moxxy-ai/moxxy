import { rm } from 'node:fs/promises';
import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { secretFilePath, type ResolvedToolDeps } from './shared.js';

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
