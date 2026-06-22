import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { isLoopbackHost } from '../config.js';
import type { ResolvedToolDeps } from './shared.js';

export function defineWebhookStatusTool(deps: ResolvedToolDeps): ToolDef {
  const { store, config, tunnelHandle } = deps;
  return defineTool({
    name: 'webhook_status',
    description:
      'Report current webhook subsystem state: listener host/port, configured public ' +
      'URL (with provenance — manual vs. proxy tunnel), proxy tunnel status, and ' +
      'count of triggers. Also surfaces an ' +
      'EXPOSURE warning when the listener binds a non-loopback host while one or more ' +
      'enabled triggers use verification:"none" (any machine on the network could fire ' +
      'them). Call this as the first step when a user asks for webhook help.',
    inputSchema: z.object({}),
    handler: async () => {
      const cfg = await config.get();
      const triggers = await store.list();
      // Exposure check: a non-loopback bind reaches the unauthenticated POST
      // surface from other hosts. Combined with an enabled verification:'none'
      // trigger, ANY machine on the network can fire arbitrary agent turns.
      // Surface it here (the init-time log is ephemeral) so the agent/user can
      // see and fix it. Only the trigger NAMES are listed — never secrets.
      const loopback = isLoopbackHost(cfg.host);
      const openTriggers = triggers.filter(
        (t) => t.enabled && t.verification.type === 'none',
      );
      let exposureWarning: string | undefined;
      if (!loopback && openTriggers.length > 0) {
        exposureWarning =
          `CRITICAL: the listener binds a non-loopback host (${cfg.host}) and ` +
          `${openTriggers.length} enabled trigger${openTriggers.length === 1 ? '' : 's'} ` +
          `use verification:"none" (${openTriggers.map((t) => t.name).join(', ')}). ` +
          'Any host that can reach this address can fire those triggers as agent turns. ' +
          'Add verification (bearer/hmac) to them, disable them, or bind the listener to ' +
          '127.0.0.1 and reach it via a tunnel instead.';
      } else if (!loopback) {
        exposureWarning =
          `The listener binds a non-loopback host (${cfg.host}); its POST surface is ` +
          'reachable from other machines on the network. All enabled triggers currently ' +
          'require verification, but keep new triggers authenticated on this bind.';
      }
      return {
        listener: { host: cfg.host, port: cfg.port, loopback },
        publicUrl: cfg.publicUrl ?? null,
        publicUrlSource: cfg.publicUrlSource ?? null,
        tunnel: tunnelHandle.current
          ? { running: true, url: tunnelHandle.current.url }
          : { running: false },
        triggerCount: triggers.length,
        enabledCount: triggers.filter((t) => t.enabled).length,
        ...(exposureWarning ? { exposureWarning } : {}),
        ...(await store.loadWarning().then((w) => (w ? { storeWarning: w } : {}))),
      };
    },
  });
}
