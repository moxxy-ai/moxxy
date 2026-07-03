import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import {
  fullUrl,
  WEBHOOKS_CONFIG_GLOB,
  WEBHOOKS_STORE_GLOB,
  type ResolvedToolDeps,
} from './shared.js';

export function defineWebhookSetPublicUrlTool(deps: ResolvedToolDeps): ToolDef {
  const { store, config } = deps;
  return defineTool({
    name: 'webhook_set_public_url',
    description:
      'Persist the public URL the external system will POST to. Use when the user ' +
      'already has a tunnel/proxy and just needs moxxy to remember it. The URL is stored ' +
      'at `~/.moxxy/webhooks-config.json`. If the user does NOT have a tunnel yet, ' +
      'prefer `webhook_tunnel_start` (auto-spawn) or `webhook_setup_guide` (walkthrough).',
    inputSchema: z.object({
      publicUrl: z.string().url('publicUrl must be a full URL like https://example.com'),
    }),
    permission: { action: 'prompt' },
    // The handler only PERSISTS the URL — no request is made. `net` is still
    // 'any' because the cap checker validates URL-shaped inputs against it,
    // and the public URL's host is user-chosen (no static allowlist exists);
    // 'none' would deny every call.
    isolation: {
      capabilities: {
        fs: {
          read: [WEBHOOKS_STORE_GLOB, WEBHOOKS_CONFIG_GLOB],
          write: [WEBHOOKS_STORE_GLOB, WEBHOOKS_CONFIG_GLOB],
        },
        net: { mode: 'any' },
        timeMs: 30_000,
      },
    },
    handler: async ({ publicUrl }) => {
      const updated = await config.set({ publicUrl, publicUrlSource: 'manual' });
      const triggers = await store.list();
      return {
        publicUrl: updated.publicUrl,
        updatedUrls: triggers.map((t) => ({ name: t.name, url: fullUrl(publicUrl, t.id) })),
      };
    },
  });
}

export function defineWebhookClearPublicUrlTool(deps: ResolvedToolDeps): ToolDef {
  const { config } = deps;
  return defineTool({
    name: 'webhook_clear_public_url',
    description:
      'Forget the configured public URL. Triggers stay in place but external systems ' +
      'will no longer be able to reach them until a new URL is set.',
    inputSchema: z.object({}),
    permission: { action: 'prompt' },
    isolation: {
      capabilities: {
        fs: { read: [WEBHOOKS_CONFIG_GLOB], write: [WEBHOOKS_CONFIG_GLOB] },
        net: { mode: 'none' },
        timeMs: 30_000,
      },
    },
    handler: async () => {
      await config.clearPublicUrl();
      return { ok: true };
    },
  });
}
