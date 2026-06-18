import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { isTunnelCliAvailable, startTunnel } from '../tunnel.js';
import { fullUrl, installInstructions, type ResolvedToolDeps } from './shared.js';

export function defineWebhookTunnelStartTool(deps: ResolvedToolDeps): ToolDef {
  const { store, config, tunnelHandle } = deps;
  return defineTool({
    name: 'webhook_tunnel_start',
    description:
      'Spawn a free public tunnel pointing at the local webhook listener. Default ' +
      '`kind:"cloudflared"` requires no signup — the tool runs `cloudflared tunnel ' +
      '--url localhost:<port>`, parses the printed `*.trycloudflare.com` URL, persists ' +
      'it as the public URL, and returns it. `kind:"ngrok"` works if the user has ngrok ' +
      'configured.\n\n' +
      'If the tunnel CLI is not installed, the tool returns a clear error with install ' +
      'instructions — at that point call `webhook_setup_guide` for the walkthrough.\n\n' +
      'Only one tunnel runs at a time; calling again stops the prior one first.',
    inputSchema: z.object({
      kind: z.enum(['cloudflared', 'ngrok']).default('cloudflared'),
      urlTimeoutMs: z.number().int().positive().default(30_000),
    }),
    permission: { action: 'prompt' },
    handler: async ({ kind, urlTimeoutMs }) => {
      const cfg = await config.get();
      const available = await isTunnelCliAvailable(kind);
      if (!available) {
        return {
          ok: false,
          error: `${kind} not found on PATH`,
          install: installInstructions(kind),
        };
      }
      if (tunnelHandle.current) {
        try { await tunnelHandle.current.stop(); } catch { /* ignore */ }
        tunnelHandle.current = null;
      }
      const running = await startTunnel({ kind, port: cfg.port, host: cfg.host, urlTimeoutMs });
      tunnelHandle.current = running;
      await config.set({ publicUrl: running.url, publicUrlSource: kind });
      const triggers = await store.list();
      return {
        ok: true,
        kind: running.kind,
        publicUrl: running.url,
        pid: running.pid,
        updatedUrls: triggers.map((t) => ({ name: t.name, url: fullUrl(running.url, t.id) })),
        note:
          'This tunnel lives only as long as the moxxy process. For long-running setups ' +
          'point a stable hostname (named cloudflared tunnel, Tailscale Funnel, reverse ' +
          'proxy) at the listener and call `webhook_set_public_url` instead.',
      };
    },
  });
}

export function defineWebhookTunnelStopTool(deps: ResolvedToolDeps): ToolDef {
  const { config, tunnelHandle } = deps;
  return defineTool({
    name: 'webhook_tunnel_stop',
    description: 'Stop the running tunnel started by `webhook_tunnel_start`, if any.',
    inputSchema: z.object({}),
    permission: { action: 'prompt' },
    handler: async () => {
      if (!tunnelHandle.current) return { ok: false, reason: 'no tunnel running' };
      const { kind } = tunnelHandle.current;
      try { await tunnelHandle.current.stop(); } catch { /* ignore */ }
      tunnelHandle.current = null;
      await config.clearPublicUrl();
      return { ok: true, stopped: kind };
    },
  });
}
