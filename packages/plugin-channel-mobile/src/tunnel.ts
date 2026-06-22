/**
 * Tunnel selection for the mobile bridge. `localhost` means no tunnel (same-Wi-Fi
 * LAN only); `proxy` exposes the bridge through the self-hosted proxy relay
 * with end-to-end encryption (the only remote option — cloudflared/ngrok were
 * removed). The user's choice comes from `channels.mobile.tunnel` (or
 * `MOXXY_MOBILE_TUNNEL`).
 */

import { proxyTunnel } from '@moxxy/plugin-tunnel-proxy';
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
 *  valid choice without editing this union (the built-in remote provider is
 *  `proxy`; cloudflared/ngrok were removed). */
export type TunnelChoice = 'localhost' | 'proxy' | (string & {});

/**
 * Registry of tunnel providers keyed by name, instead of a hardcoded if/else.
 * The shipped remote provider is the self-hosted `proxy` relay. A new provider
 * registers itself via {@link registerTunnelProvider} rather than threading a
 * third arm through `tunnelProviderFor` + `normalizeTunnelChoice`.
 */
const tunnelProviders = new Map<string, TunnelProviderDef>([[proxyTunnel.name, proxyTunnel]]);

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

/** Whether a choice runs the end-to-end-encrypted (relay) path. */
export function isE2EChoice(choice: TunnelChoice): boolean {
  return choice === 'proxy';
}
