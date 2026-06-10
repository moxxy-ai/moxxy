/**
 * Pure pairing-URL helpers: host advertisement + the connect-URL the QR carries.
 *
 * These are split out of `tunnel.ts` (which also depends on the heavyweight
 * cloudflared/ngrok tunnel providers) so a host that only needs to BUILD a
 * pairing URL — e.g. the desktop main, which exposes the gateway over its own
 * WebSocket bridge — can import them without pulling the tunnel-provider deps.
 * The `qr.ts` / channel code re-export through `tunnel.ts` for back-compat.
 *
 * Only `node:os` is touched here.
 */

import os from 'node:os';

/** Bind address resolution, mirroring the channel's env → config → default
 *  convention. Loopback by default — exposing the bridge on the LAN is an
 *  explicit opt-in (`MOXXY_MOBILE_HOST=0.0.0.0` or `channels.mobile.bindHost`). */
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
 * Build the pairing URL the QR carries — the token rides as a `?t=` query so a
 * single scan carries everything. This is a PAIRING payload, not the live WS
 * URL: the app strips `?t=` before connecting and presents the token via the
 * `Sec-WebSocket-Protocol` bearer entry instead (the channel keeps
 * `allowQueryToken` on only for older app builds that still connect with the
 * token in the URL). A tunnel URL (https) becomes `wss://`; the local path
 * uses the advertised host.
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
