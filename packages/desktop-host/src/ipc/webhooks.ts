import type { WebhookSummary } from '@moxxy/desktop-ipc-contract';
// TYPE-ONLY import (fully erased): the runtime value import of
// `@moxxy/plugin-webhooks` is deferred to a lazy `import()` below. A static
// value import here would be fatal — `@moxxy/desktop-host` is bundled into the
// Electron main entry (BUNDLED_WORKSPACE_DEPS), so a static import drags the
// webhooks plugin's proxy/E2E stack and, transitively, `ulid` into the main
// entry's eager module graph. `ulid` eager-initialises before electron-vite's
// injected `require` shim and throws "secure crypto unusable, insecure
// Math.random not allowed" at boot, so the app never starts (see the desktop
// 0.22.3 changelog for the identical mobile-proxy regression + fix).
import type { WebhookStore, WebhookTrigger } from '@moxxy/plugin-webhooks';
import type { DeskStore } from '../desks';
import { buildSessionNameResolver, handle, type SessionNameResolver } from './shared';

interface WebhooksModule {
  readonly store: WebhookStore;
  readonly describeTrigger: (
    trigger: WebhookTrigger,
    publicUrl: string | undefined,
  ) => Record<string, unknown>;
}

// First webhooks.* invocation pays the dynamic import + opens the default store;
// the result is cached for the rest of the session. Crucially this runs on a
// COMMAND, long after `app.whenReady` — so `ulid` initialises in a normal,
// shim-ready context instead of during boot.
let cached: Promise<WebhooksModule> | null = null;
function loadWebhooks(): Promise<WebhooksModule> {
  if (!cached) {
    cached = import('@moxxy/plugin-webhooks').then((m) => ({
      store: new m.WebhookStore(),
      describeTrigger: m.describeTrigger,
    }));
  }
  return cached;
}

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
 *
 * @param injectedStore Tests pass a temp-file store so they don't touch the
 *  real `~/.moxxy/webhooks.json`; production lazy-loads the default store.
 * @param desks The desk registry, used to resolve a trigger's `targetSessionId`
 *  to a display name for the panel. Omitted by the injected-store tests.
 */
export function registerWebhookHandlers(injectedStore?: WebhookStore, desks?: DeskStore): void {
  const get: () => Promise<WebhooksModule> = injectedStore
    ? async () => ({
        store: injectedStore,
        describeTrigger: (await import('@moxxy/plugin-webhooks')).describeTrigger,
      })
    : loadWebhooks;

  handle('webhooks.list', async () => {
    const { store, describeTrigger } = await get();
    store.invalidate();
    const [triggers, resolveName] = await Promise.all([store.list(), buildSessionNameResolver(desks)]);
    return triggers.map((t) => toWebhookSummary(t, describeTrigger, resolveName));
  });

  handle('webhooks.setEnabled', async ({ id, enabled }) => {
    const { store, describeTrigger } = await get();
    store.invalidate();
    const updated = await store.update(id, { enabled });
    return updated ? toWebhookSummary(updated, describeTrigger, await buildSessionNameResolver(desks)) : null;
  });

  handle('webhooks.setTargetSession', async ({ id, sessionId }) => {
    const { store, describeTrigger } = await get();
    store.invalidate();
    // `ownerSessionId` is the stored routing key; the queue/drain already
    // honors it, so reassigning here re-homes the trigger's deliveries.
    const updated = await store.update(id, { ownerSessionId: sessionId ?? undefined });
    return updated ? toWebhookSummary(updated, describeTrigger, await buildSessionNameResolver(desks)) : null;
  });

  handle('webhooks.delete', async ({ id }) => {
    const { store } = await get();
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
function toWebhookSummary(
  trigger: WebhookTrigger,
  describeTrigger: WebhooksModule['describeTrigger'],
  resolveName: SessionNameResolver,
): WebhookSummary {
  // `describeTrigger` already carries `targetSessionId` (the stored
  // ownerSessionId); the host adds the resolved display name on top.
  const described = describeTrigger(trigger, undefined) as unknown as WebhookSummary;
  return { ...described, targetSessionName: resolveName(described.targetSessionId) };
}
