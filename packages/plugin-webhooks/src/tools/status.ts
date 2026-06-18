import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { isTunnelCliAvailable } from '../tunnel.js';
import type { ResolvedToolDeps } from './shared.js';

export function defineWebhookStatusTool(deps: ResolvedToolDeps): ToolDef {
  const { store, config, tunnelHandle } = deps;
  return defineTool({
    name: 'webhook_status',
    description:
      'Report current webhook subsystem state: listener host/port, configured public ' +
      'URL (with provenance — manual vs. cloudflared tunnel), tunnel process status, ' +
      'count of triggers, and whether a tunnel CLI is detected on PATH. Call this as ' +
      'the first step when a user asks for webhook help.',
    inputSchema: z.object({}),
    handler: async () => {
      const cfg = await config.get();
      const triggers = await store.list();
      const [cloudflaredOk, ngrokOk] = await Promise.all([
        isTunnelCliAvailable('cloudflared'),
        isTunnelCliAvailable('ngrok'),
      ]);
      return {
        listener: { host: cfg.host, port: cfg.port },
        publicUrl: cfg.publicUrl ?? null,
        publicUrlSource: cfg.publicUrlSource ?? null,
        tunnel: tunnelHandle.current
          ? {
              running: true,
              kind: tunnelHandle.current.kind,
              url: tunnelHandle.current.url,
              pid: tunnelHandle.current.pid,
            }
          : { running: false },
        cliAvailable: { cloudflared: cloudflaredOk, ngrok: ngrokOk },
        triggerCount: triggers.length,
        enabledCount: triggers.filter((t) => t.enabled).length,
        ...(await store.loadWarning().then((w) => (w ? { storeWarning: w } : {}))),
      };
    },
  });
}
