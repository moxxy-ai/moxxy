import type { ToolDef } from '@moxxy/sdk';
import { defineWebhookCreateTool } from './create.js';
import { defineWebhookDeleteTool } from './delete.js';
import { defineWebhookSetupGuideTool } from './guide.js';
import { defineWebhookListTool } from './list.js';
import {
  defineWebhookClearPublicUrlTool,
  defineWebhookSetPublicUrlTool,
} from './public-url.js';
import {
  defaultWebhookSecretsDir,
  type ResolvedToolDeps,
  type WebhooksToolDeps,
} from './shared.js';
import { defineWebhookStatusTool } from './status.js';
import { defineWebhookTestTool } from './test.js';
import { defineWebhookTunnelStartTool, defineWebhookTunnelStopTool } from './tunnel.js';
import { defineWebhookUpdateTool } from './update.js';

export { defaultWebhookSecretsDir };
export type { WebhooksToolDeps };

/**
 * Composes the agent-facing webhook tools from per-tool factories.
 * The order is preserved exactly as before extraction.
 */
export function buildWebhookTools(deps: WebhooksToolDeps): ReadonlyArray<ToolDef> {
  const resolved: ResolvedToolDeps = {
    store: deps.store,
    config: deps.config,
    dispatcher: deps.dispatcher,
    tunnelHandle: deps.tunnelHandle,
    secretsDir: deps.secretsDir ?? defaultWebhookSecretsDir(),
  };

  return [
    defineWebhookCreateTool(resolved),
    defineWebhookListTool(resolved),
    defineWebhookDeleteTool(resolved),
    defineWebhookUpdateTool(resolved),
    defineWebhookTestTool(resolved),
    defineWebhookStatusTool(resolved),
    defineWebhookSetPublicUrlTool(resolved),
    defineWebhookClearPublicUrlTool(resolved),
    defineWebhookTunnelStartTool(resolved),
    defineWebhookTunnelStopTool(resolved),
    defineWebhookSetupGuideTool(resolved),
  ];
}
