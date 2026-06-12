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
  expoWebOrigins,
} from './pairing.js';

export type TunnelChoice = 'localhost' | 'cloudflared' | 'ngrok';

export function normalizeTunnelChoice(raw: string | undefined): TunnelChoice {
  const v = (process.env.MOXXY_MOBILE_TUNNEL ?? raw ?? 'localhost').trim().toLowerCase();
  if (v === 'cloudflared' || v === 'ngrok') return v;
  return 'localhost';
}

/** The provider for a choice, or null for `localhost` (no tunnel). */
export function tunnelProviderFor(choice: TunnelChoice): TunnelProviderDef | null {
  if (choice === 'cloudflared') return cloudflaredTunnel;
  if (choice === 'ngrok') return ngrokTunnel;
  return null;
}
