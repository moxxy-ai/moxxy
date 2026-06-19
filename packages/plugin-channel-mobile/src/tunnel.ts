/**
 * Tunnel selection for the mobile bridge. Reuses the cloudflared / ngrok
 * providers the web channel already ships (shared subprocess management — see
 * TECH_DEBT "unify tunnel subprocess management"). `localhost` means no tunnel
 * (LAN only). The user's choice comes from `channels.mobile.tunnel` (or
 * `MOXXY_MOBILE_TUNNEL`).
 */

import { cloudflaredTunnel, ngrokTunnel } from '@moxxy/plugin-channel-web';
import type { TunnelProviderDef } from '@moxxy/sdk';

// The pure pairing-URL helpers live in `pairing.ts` (no tunnel-provider deps)
// so a host that only needs to build a connect URL can import them directly.
// Re-exported here so existing `from './tunnel.js'` importers are unchanged.
export {
  resolveBindHost,
  isLoopbackHost,
  isWildcardHost,
  lanHost,
  advertisedHost,
  buildConnectUrl,
  connectUrlOrigin,
  advertisedOrigins,
} from './pairing.js';

/** `localhost` (no tunnel) plus the name of any registered provider. Kept a wide
 *  `string` so a provider registered via {@link registerTunnelProvider} is a
 *  valid choice without editing this union (the built-ins are documented here). */
export type TunnelChoice = 'localhost' | 'cloudflared' | (string & {});

/**
 * Registry of tunnel providers keyed by name, instead of a hardcoded if/else.
 * A new provider (e.g. the planned self-hosted relay client) registers itself
 * via {@link registerTunnelProvider} rather than threading a third arm through
 * `tunnelProviderFor` + `normalizeTunnelChoice` + the index.ts guard.
 */
const tunnelProviders = new Map<string, TunnelProviderDef>([
  [cloudflaredTunnel.name, cloudflaredTunnel],
  [ngrokTunnel.name, ngrokTunnel],
]);

/** Register (or override) a tunnel provider under its `name`. */
export function registerTunnelProvider(provider: TunnelProviderDef): void {
  tunnelProviders.set(provider.name, provider);
}

export function normalizeTunnelChoice(raw: string | undefined): TunnelChoice {
  const v = (process.env.MOXXY_MOBILE_TUNNEL ?? raw ?? 'localhost').trim().toLowerCase();
  return tunnelProviders.has(v) ? v : 'localhost';
}

/** The provider for a choice, or null for `localhost` / an unknown name. */
export function tunnelProviderFor(choice: TunnelChoice): TunnelProviderDef | null {
  return tunnelProviders.get(choice) ?? null;
}
