/**
 * The `mobile` channel plugin. Registered as a builtin so `moxxy mobile` starts
 * it and `moxxy serve --all` includes it, exposing the runner's session to the
 * Expo app over an authenticated WebSocket.
 */

import { defineChannel, definePlugin } from '@moxxy/sdk';
import { MobileChannel } from './channel.js';

export { MobileChannel, type MobileChannelOptions, type MobileStartOpts } from './channel.js';
export { MobileSessionHost, type MobileHostOptions } from './single-session-host.js';
export { resolveMobileToken, rotateMobileToken } from './token.js';

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
// Pass any string through; `normalizeTunnelChoice` validates it against the
// tunnel-provider registry and falls back to `localhost` for an unknown name,
// so a registered third provider is a valid config value without editing here.
function asTunnel(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}
function pickExpoOptions(opts: Record<string, unknown>) {
  return {
    'no-expo': opts['no-expo'],
    'expo-host': opts['expo-host'],
    'expo-port': opts['expo-port'],
    expoHost: opts.expoHost,
    expoPort: opts.expoPort,
    expoAppDir: opts.expoAppDir,
  };
}

export const mobileChannelDef = defineChannel({
  name: 'mobile',
  description:
    'WebSocket bridge for the moxxy mobile app (Expo) — serves the IPC contract backed by this session.',
  // Unlike telegram/slack, mobile is NOT dedicated — it self-hosts the runner's
  // single session. But `moxxy mobile` still owns that session, so stamp its
  // origin explicitly: otherwise the runner's env-heuristic persistence records
  // the empty pre-first-prompt session as `tui`, dropping it from the mobile
  // list until the first prompt. The CLI honors this for the launched channel.
  sessionSource: 'mobile',
  create: (deps) =>
    new MobileChannel({
      port: asNumber(deps.options?.port),
      bindHost: asString(deps.options?.bindHost),
      token: asString(deps.options?.token),
      tunnel: asTunnel(deps.options?.tunnel),
      expo: pickExpoOptions((deps.options ?? {}) as Record<string, unknown>),
      allowQueryToken: asBoolean(deps.options?.allowQueryToken),
      logger: deps.logger,
    }),
  isAvailable: async () => ({ ok: true }),
});

export const mobileChannelPlugin = definePlugin({
  name: '@moxxy/plugin-channel-mobile',
  version: '0.0.0',
  channels: [mobileChannelDef],
});

export default mobileChannelPlugin;
