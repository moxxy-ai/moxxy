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

/**
 * Bind address resolution, mirroring the channel's env → config → default
 * convention (cf. MOXXY_MOBILE_TOKEN / MOXXY_MOBILE_TUNNEL). Loopback by
 * default — exposing the bridge on the LAN is an explicit opt-in
 * (`MOXXY_MOBILE_HOST=0.0.0.0` or `channels.mobile.bindHost`).
 */
export function resolveBindHost(configured?: string): string {
  const v = (process.env.MOXXY_MOBILE_HOST ?? configured ?? '').trim();
  return v.length > 0 ? v : '127.0.0.1';
}

/** Loopback addresses: only reachable from this machine (incl. simulators). */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || h.startsWith('127.');
}

/** Wildcard binds listen on every interface — the bind string itself is not a
 *  connectable address, so the QR must advertise a real one instead. */
export function isWildcardHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '0.0.0.0' || h === '::' || h === '[::]';
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
 * The host the QR / connect URL should advertise for a given bind address —
 * never an address the server isn't actually reachable on:
 *  - wildcard bind (0.0.0.0 / ::) → the machine's LAN IP (loopback fallback),
 *    since the bind string itself is unconnectable;
 *  - anything else (loopback default, an explicit LAN IP, a hostname) → the
 *    bind host verbatim. In particular the loopback default advertises
 *    127.0.0.1, NOT the LAN IP the server is not listening on.
 */
export function advertisedHost(bindHost: string): string {
  if (isWildcardHost(bindHost)) return lanHost('127.0.0.1');
  return bindHost;
}

/**
 * Build the WebSocket connect URL the mobile app uses — token embedded as the
 * `?t=` query the bridge accepts (so a scanned QR carries everything). A tunnel
 * URL (https) becomes `wss://`; the local path uses the advertised host.
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
