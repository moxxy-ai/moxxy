import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { startTunnel } from '../tunnel.js';
import { fullUrl, type ResolvedToolDeps } from './shared.js';

export function defineWebhookTunnelStartTool(deps: ResolvedToolDeps): ToolDef {
  const { store, config, tunnelHandle } = deps;
  return defineTool({
    name: 'webhook_tunnel_start',
    description:
      'Expose the local webhook listener publicly through the self-hosted proxy relay ' +
      '(`https://<uuid>.proxy.moxxy.ai/webhook`). No account, no CLI, no signup — the ' +
      'agent dials out to the relay, the resulting URL is persisted as the public URL, ' +
      'and returned.\n\n' +
      'Only one tunnel runs at a time; calling again stops the prior one first.',
    inputSchema: z.object({}),
    permission: { action: 'prompt' },
    handler: async () => {
      const cfg = await config.get();
      if (tunnelHandle.current) {
        try {
          await tunnelHandle.current.stop();
        } catch {
          /* ignore */
        }
        tunnelHandle.current = null;
      }
      const running = await startTunnel({ port: cfg.port, host: cfg.host });
      tunnelHandle.current = running;
      await config.set({ publicUrl: running.url, publicUrlSource: 'proxy' });
      const triggers = await store.list();
      return {
        ok: true,
        publicUrl: running.url,
        updatedUrls: triggers.map((t) => ({ name: t.name, url: fullUrl(running.url, t.id) })),
        note:
          'This tunnel lives only as long as the moxxy process (and the relay being up). ' +
          'For a stable hostname independent of moxxy, point your own reverse proxy at the ' +
          'listener and call `webhook_set_public_url` instead.',
      };
    },
  });
}

export function defineWebhookTunnelStopTool(deps: ResolvedToolDeps): ToolDef {
  const { config, tunnelHandle } = deps;
  return defineTool({
    name: 'webhook_tunnel_stop',
    description: 'Stop the running proxy tunnel started by `webhook_tunnel_start`, if any.',
    inputSchema: z.object({}),
    permission: { action: 'prompt' },
    handler: async () => {
      if (!tunnelHandle.current) return { ok: false, reason: 'no tunnel running' };
      try {
        await tunnelHandle.current.stop();
      } catch {
        /* ignore */
      }
      tunnelHandle.current = null;
      await config.clearPublicUrl();
      return { ok: true, stopped: true };
    },
  });
}
