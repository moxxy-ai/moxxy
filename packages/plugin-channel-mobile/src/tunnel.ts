/**
 * Tunnel selection for the mobile bridge. Reuses the cloudflared / ngrok
 * providers the web channel already ships (shared subprocess management — see
 * TECH_DEBT "unify tunnel subprocess management"). `localhost` means no tunnel
 * (LAN only). The user's choice comes from `channels.mobile.tunnel` (or
 * `MOXXY_MOBILE_TUNNEL`).
 */

import os from 'node:os';
import { cloudflaredTunnel, ngrokTunnel } from '@moxxy/plugin-channel-web';
import type { TunnelProviderDef } from '@moxxy/sdk';

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

/** First non-internal IPv4 address, so a phone on the same Wi-Fi can reach the
 *  bridge without a tunnel. Falls back to the bind host. */
export function lanHost(fallback: string): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return fallback;
}

/**
 * Build the WebSocket connect URL the mobile app uses — token embedded as the
 * `?t=` query the bridge accepts (so a scanned QR carries everything). A tunnel
 * URL (https) becomes `wss://`; the local path uses the LAN host.
 */
export function buildConnectUrl(opts: {
  tunnelUrl: string | null;
  localHost: string;
  port: number;
  token: string;
}): string {
  const t = encodeURIComponent(opts.token);
  if (opts.tunnelUrl) {
    const u = new URL(opts.tunnelUrl);
    const scheme = u.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${u.host}/?t=${t}`;
  }
  return `ws://${opts.localHost}:${opts.port}/?t=${t}`;
}
