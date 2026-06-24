import type { WebhookSummary } from '@moxxy/desktop-ipc-contract';
import { WebhookStore, describeTrigger, type WebhookTrigger } from '@moxxy/plugin-webhooks';
import { handle } from './shared';

const defaultStore = new WebhookStore();

/**
 * Webhook trigger management for the desktop — mirrors the scheduler handlers.
 * The host reads the shared webhooks store file directly (the same file the
 * runner's webhooks plugin writes), so the panel sees every trigger including
 * those the agent created via its `webhook_*` tools. `invalidate()` before each
 * read drops the in-memory cache so a trigger created/updated out-of-process
 * (by a running runner) is reflected immediately.
 *
 * Host-only: these are deliberately NOT in REMOTE_ALLOWED_COMMANDS — a paired
 * phone can't toggle or delete inbound triggers.
 */
export function registerWebhookHandlers(store: WebhookStore = defaultStore): void {
  handle('webhooks.list', async () => {
    store.invalidate();
    const triggers = await store.list();
    return triggers.map(toWebhookSummary);
  });

  handle('webhooks.setEnabled', async ({ id, enabled }) => {
    store.invalidate();
    const updated = await store.update(id, { enabled });
    return updated ? toWebhookSummary(updated) : null;
  });

  handle('webhooks.delete', async ({ id }) => {
    store.invalidate();
    return { deleted: await store.delete(id) };
  });
}

/**
 * The host doesn't know the live tunnel URL (that lives in the runner's
 * webhook server), so pass `undefined` — `describeTrigger` then yields a null
 * public `url` and the always-present `localPath`, which is what the panel
 * shows. Secrets are stripped by `describeTrigger`/`redactVerification`.
 */
function toWebhookSummary(trigger: WebhookTrigger): WebhookSummary {
  return describeTrigger(trigger, undefined) as unknown as WebhookSummary;
}
