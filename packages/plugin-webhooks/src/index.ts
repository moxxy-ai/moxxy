import { definePlugin, type Plugin } from '@moxxy/sdk';
import {
  defaultWebhookConfigFile,
  isLoopbackHost,
  WebhookConfigStore,
  type WebhookConfig,
  type WebhookConfigStoreOptions,
  webhookConfigSchema,
} from './config.js';
import { DeliveryDedupeCache } from './dedupe.js';
import {
  defaultWebhookInboxDir,
  WebhookDispatcher,
  type InboxOptions,
  type WebhookDispatcherOptions,
  type WebhookFireOutcome,
  type WebhookPromptResult,
  type WebhookPromptRunner,
} from './runner.js';
import {
  WebhookServer,
  type WebhookServerHandle,
  type WebhookServerOptions,
} from './server.js';
import {
  defaultWebhooksFile,
  WebhookStore,
  webhookTriggerSchema,
  verificationSchema,
  filterSchema,
  filterRuleSchema,
  type FilterRule,
  type WebhookFilter,
  type WebhookStoreLogger,
  type WebhookStoreOptions,
  type WebhookTrigger,
  type WebhookVerification,
} from './store.js';
import { shouldFire, type FilterInput } from './filter.js';
import { describeTrigger, redactVerification } from './describe.js';
import { renderPrompt, type TemplateContext } from './template.js';
import {
  isTunnelCliAvailable,
  startTunnel,
  webhookTunnelProviders,
  type RunningTunnel,
  type TunnelKind,
  type TunnelStartOptions,
} from './tunnel.js';
import { buildWebhookTools, defaultWebhookSecretsDir, type WebhooksToolDeps } from './tools.js';
import { idempotencyKey, verifyDelivery, type VerificationInput, type VerificationResult } from './verify.js';

export {
  // Stores
  WebhookStore,
  WebhookConfigStore,
  defaultWebhooksFile,
  defaultWebhookConfigFile,
  webhookTriggerSchema,
  verificationSchema,
  filterSchema,
  filterRuleSchema,
  webhookConfigSchema,
  shouldFire,
  describeTrigger,
  redactVerification,
  // Runtime
  WebhookDispatcher,
  WebhookServer,
  DeliveryDedupeCache,
  defaultWebhookInboxDir,
  // Verification + templating
  verifyDelivery,
  idempotencyKey,
  renderPrompt,
  // Tunnel
  startTunnel,
  isTunnelCliAvailable,
  webhookTunnelProviders,
  // Tools
  buildWebhookTools,
  defaultWebhookSecretsDir,
  type WebhookTrigger,
  type WebhookVerification,
  type WebhookFilter,
  type FilterRule,
  type FilterInput,
  type WebhookConfig,
  type WebhookConfigStoreOptions,
  type WebhookStoreLogger,
  type WebhookStoreOptions,
  type WebhookDispatcherOptions,
  type WebhookServerOptions,
  type WebhookServerHandle,
  type WebhookPromptRunner,
  type WebhookPromptResult,
  type WebhookFireOutcome,
  type InboxOptions,
  type TemplateContext,
  type VerificationInput,
  type VerificationResult,
  type RunningTunnel,
  type TunnelKind,
  type TunnelStartOptions,
  type WebhooksToolDeps,
};

export interface BuildWebhooksPluginOptions {
  /** Persistent trigger store. Default: `~/.moxxy/webhooks.json`. */
  readonly store?: WebhookStore;
  /** Persistent host config (listener + public URL). Default: `~/.moxxy/webhooks-config.json`. */
  readonly config?: WebhookConfigStore;
  /**
   * Bootstrap-provided runner that executes prompts in a session.
   * Required — without it, deliveries land but nothing fires.
   */
  readonly runner: WebhookPromptRunner;
  readonly inbox?: InboxOptions;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Notification hook fired after every delivery. */
  readonly onFired?: (trigger: WebhookTrigger, outcome: WebhookFireOutcome) => void;
  /** Override listener binding (otherwise read from config). */
  readonly listenerOverride?: { readonly host?: string; readonly port?: number };
  /** Max accepted body size (bytes). Default 1MB. */
  readonly maxBodyBytes?: number;
}

export interface BuiltWebhooksPlugin {
  readonly plugin: Plugin;
  readonly store: WebhookStore;
  readonly config: WebhookConfigStore;
  readonly dispatcher: WebhookDispatcher;
  /** Set after onInit fires; null before listener boots and after shutdown. */
  readonly getServer: () => WebhookServerHandle | null;
  /** Stop any running tunnel started via the agent's `webhook_tunnel_start` tool. */
  readonly stopTunnel: () => Promise<void>;
  /** Stop the listener and any running tunnel. Idempotent. Use this when an
   *  embedder wants to disable webhooks without unloading the plugin. */
  readonly stop: () => Promise<void>;
}

/**
 * Build the webhooks plugin. Lifecycle:
 *   - `onInit`  — loads config, starts the HTTP listener.
 *   - `onShutdown` — stops the listener and any running tunnel.
 *
 * Tools are registered eagerly so they're callable from the very first
 * turn (e.g. `webhook_setup_guide` works before the listener is fully
 * up). The dispatcher is constructed eagerly too so `webhook_test` can
 * fire synthetic deliveries without a network round-trip.
 *
 * Programmatic API: pass `store` / `config` to point at custom paths
 * (great for embedding moxxy in another binary with its own profile
 * directory). The returned `getServer`/`stopTunnel` give hosts that
 * embed moxxy a clean shutdown hook beyond what `onShutdown` provides.
 */
export function buildWebhooksPlugin(opts: BuildWebhooksPluginOptions): BuiltWebhooksPlugin {
  const store = opts.store ?? new WebhookStore(opts.logger ? { logger: opts.logger } : {});
  const config = opts.config ?? new WebhookConfigStore();
  const dispatcher = new WebhookDispatcher({
    store,
    runner: opts.runner,
    ...(opts.inbox ? { inbox: opts.inbox } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(opts.onFired ? { onFired: opts.onFired } : {}),
  });

  const tunnelHandle: { current: RunningTunnel | null } = { current: null };
  let serverInstance: WebhookServer | null = null;
  let serverHandle: WebhookServerHandle | null = null;

  const tools = buildWebhookTools({ store, config, dispatcher, tunnelHandle });

  const plugin = definePlugin({
    name: '@moxxy/plugin-webhooks',
    version: '0.0.0',
    tools,
    hooks: {
      onInit: async () => {
        const cfg = await config.get();
        const host = opts.listenerOverride?.host ?? cfg.host;
        const port = opts.listenerOverride?.port ?? cfg.port;
        if (!isLoopbackHost(host)) {
          // Surface the open-auth triggers if the store is readable, but never
          // let a warning-path store read abort listener init (the delivery
          // path already handles an unreadable store on its own).
          let openAuth: WebhookTrigger[] = [];
          try {
            openAuth = (await store.list()).filter(
              (t) => t.enabled && t.verification.type === 'none',
            );
          } catch {
            /* fall back to the generic warning below */
          }
          opts.logger?.warn?.(
            'webhooks: binding a NON-LOOPBACK host — the unauthenticated POST surface is ' +
              'reachable from other machines on the network',
            {
              host,
              port,
              ...(openAuth.length > 0
                ? {
                    unauthenticatedTriggers: openAuth.map((t) => t.name),
                    severity: 'critical: any host on the network can fire these triggers',
                  }
                : {}),
            },
          );
        }
        serverInstance = new WebhookServer({
          host,
          port,
          store,
          dispatcher,
          ...(opts.logger ? { logger: opts.logger } : {}),
          ...(opts.maxBodyBytes !== undefined ? { maxBodyBytes: opts.maxBodyBytes } : {}),
        });
        try {
          serverHandle = await serverInstance.start();
        } catch (err) {
          // Port in use is the most common failure — log and let other
          // plugins keep working. The agent can surface the issue via
          // webhook_status (listener will show as down).
          opts.logger?.warn?.('webhooks: listener failed to start', {
            err: err instanceof Error ? err.message : String(err),
            host,
            port,
          });
          serverInstance = null;
        }
      },
      onShutdown: () => stopAll(),
    },
  });

  async function stopAll(): Promise<void> {
    if (serverInstance) {
      try { await serverInstance.stop(); } catch { /* ignore */ }
      serverInstance = null;
      serverHandle = null;
    }
    if (tunnelHandle.current) {
      try { await tunnelHandle.current.stop(); } catch { /* ignore */ }
      tunnelHandle.current = null;
    }
  }

  return {
    plugin,
    store,
    config,
    dispatcher,
    getServer: () => serverHandle,
    stopTunnel: async () => {
      if (tunnelHandle.current) {
        try { await tunnelHandle.current.stop(); } catch { /* ignore */ }
        tunnelHandle.current = null;
      }
    },
    stop: stopAll,
  };
}
