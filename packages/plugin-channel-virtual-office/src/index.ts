/**
 * The `office` channel plugin. Registered as a builtin so `moxxy office`
 * starts the pixel-art virtual office: a browser game where every animated
 * worker sprite is a full moxxy session, served over the authenticated
 * WebSocket IPC bridge.
 */

import { defineChannel, definePlugin } from '@moxxy/sdk';
import { VirtualOfficeChannel } from './channel.js';

export {
  VirtualOfficeChannel,
  type OfficeChannelOptions,
  type OfficeStartOpts,
} from './channel.js';
export {
  VirtualOfficeHost,
  type VirtualOfficeHostDeps,
  type SpawnedWorkerSession,
} from './multi-session-host.js';
export {
  spawnWorkerSession,
  attachWorkerPersistence,
  isLocalSession,
  type SpawnWorkerOptions,
} from './worker-session.js';
export { resolveOfficeToken, rotateOfficeToken } from './token.js';

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export const officeChannelDef = defineChannel({
  name: 'office',
  description:
    'Pixel-art virtual office in the browser — every worker sprite is a full moxxy session; click to chat, spawn agents, watch subagents meet in the war room.',
  create: (deps) =>
    new VirtualOfficeChannel(
      {
        port: asNumber(deps.options?.port),
        wsPort: asNumber(deps.options?.wsPort),
        bindHost: asString(deps.options?.bindHost),
        token: asString(deps.options?.token),
        logger: deps.logger,
      },
      { cwd: deps.cwd, vault: deps.vault },
    ),
  isAvailable: async () => ({ ok: true }),
});

export const virtualOfficeChannelPlugin = definePlugin({
  name: '@moxxy/plugin-channel-virtual-office',
  version: '0.0.0',
  channels: [officeChannelDef],
});

export default virtualOfficeChannelPlugin;
