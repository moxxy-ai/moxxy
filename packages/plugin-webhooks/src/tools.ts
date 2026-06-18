/**
 * Public entry point for the agent-facing webhook tools.
 *
 * The tool definitions live in per-tool factory modules under `./tools/`
 * (one `defineWebhook*Tool(deps)` per tool) and `./tools/index.ts` composes
 * them. This file preserves the original import surface (`./tools.js`) so
 * every existing consumer keeps working unchanged.
 */
export { buildWebhookTools, defaultWebhookSecretsDir } from './tools/index.js';
export type { WebhooksToolDeps } from './tools/index.js';
