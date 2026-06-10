import { defineChannel, definePlugin, resolveChannelToken, type Plugin } from '@moxxy/sdk';
import { VirtualOfficeChannel, type VirtualOfficeChannelOptions } from './channel.js';

export {
  VirtualOfficeChannel,
  type VirtualOfficeChannelOptions,
  type VirtualOfficeStartOpts,
} from './channel.js';
export {
  OFFICE_ROUTES,
  handleEvents,
  type OfficeRoute,
  type OfficeRequestContext,
  type OfficeEventStream,
  type OfficeLogger,
} from './routes.js';
export {
  OfficeAgentRuntime,
  type OfficeAgentCreateInput,
  type OfficeAgentHistory,
  type OfficeRunStart,
  type VirtualOfficeAgent,
  type OfficeGraveyardEntry,
} from './office-agent-runtime.js';
export {
  HttpPermissionBroker,
  PERMISSION_REQUESTED_SUBTYPE,
  PERMISSION_RESOLVED_SUBTYPE,
} from './permission-broker.js';
export {
  eventToVirtualOfficeEnvelope,
  type VirtualOfficeEnvelope,
} from './virtual-office-events.js';

const TOKEN_FILE = 'virtual-office-token';

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Resolve the office channel's bearer token via the shared channel-auth
 * convention (env `MOXXY_VIRTUAL_OFFICE_TOKEN` → `channels.virtual-office.token`
 * config → a generated secret persisted at `~/.moxxy/virtual-office-token`), so
 * the surface is never accidentally unauthenticated.
 */
export function resolveVirtualOfficeToken(configured?: string): string {
  return resolveChannelToken({ configured, envVar: 'MOXXY_VIRTUAL_OFFICE_TOKEN', fileName: TOKEN_FILE });
}

/**
 * The Virtual Office as a self-contained channel: `moxxy virtual-office` stands
 * up its own HTTP + SSE server (no dependency on `@moxxy/plugin-channel-http`
 * and no core extension seam) serving the office surface — agents, unified
 * timeline, graveyard, and (opt-in) interactive permissions. Opt-in: it only
 * runs when the channel is invoked, and it bearer-auths every route itself.
 */
export const virtualOfficeChannelDef = defineChannel({
  name: 'virtual-office',
  description:
    'Standalone multi-agent Virtual Office channel — its own HTTP+SSE server (agents, unified timeline, graveyard, interactive permissions). Bearer-token auth.',
  create: (deps) => {
    const opts = deps.options ?? {};
    const channelOpts: VirtualOfficeChannelOptions = {
      authToken: resolveVirtualOfficeToken(asString(opts.authToken) ?? asString(opts.token)),
      ...(asNumber(opts.port) !== undefined ? { port: asNumber(opts.port) } : {}),
      ...(asString(opts.host) !== undefined ? { host: asString(opts.host) } : {}),
      ...(asBool(opts.interactivePermissions) !== undefined
        ? { interactivePermissions: asBool(opts.interactivePermissions) }
        : {}),
      logger: deps.logger,
    };
    return new VirtualOfficeChannel(channelOpts);
  },
  isAvailable: async () => ({ ok: true }),
});

export const virtualOfficePlugin: Plugin = definePlugin({
  name: '@moxxy/plugin-virtual-office',
  version: '0.0.0',
  channels: [virtualOfficeChannelDef],
});

export default virtualOfficePlugin;
