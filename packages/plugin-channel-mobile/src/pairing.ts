/**
 * Pure pairing-URL helpers: host advertisement + the connect-URL the QR carries.
 *
 * These are split out of `tunnel.ts` (which pulls in the proxy tunnel provider)
 * so a host that only needs to BUILD a pairing URL — e.g. the desktop main,
 * which exposes the gateway over its own
 * WebSocket bridge — can import them without pulling the tunnel-provider deps.
 * The `qr.ts` / channel code re-export through `tunnel.ts` for back-compat.
 *
 * Only `node:os` is touched here.
 */

import os from 'node:os';

/** Bind address resolution, mirroring the channel's env → config → default
 *  convention. LAN-capable by default so `moxxy mobile` works with a physical
 *  phone out of the box; explicit loopback remains available for simulators. */
export function resolveBindHost(configured?: string): string {
  const v = (process.env.MOXXY_MOBILE_HOST ?? configured ?? '').trim();
  return v.length > 0 ? v : '0.0.0.0';
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

/** Interface names that are overlay/virtual links a phone on the Wi-Fi cannot
 *  reach: VPN tunnels (utun/wg/tailscale…), VM/container bridges (vmnet/
 *  bridge/docker…), and Apple's special-purpose links (awdl/llw/ap). A private
 *  address on one of these is only routable inside that overlay. */
const VIRTUAL_IFACE = /^(?:utun|tun|tap|ppp|ipsec|wg|zt|ts|tailscale|vmnet|vnic|bridge|docker|veth|awdl|llw|ap|anpi)\d*$/i;

/** 169.254/16 — self-assigned, never routed; a phone can't dial it. (Intel
 *  Macs expose the T2 iBridge as `en5` with a link-local IPv4, and it often
 *  enumerates BEFORE en0 — the classic "first IPv4" trap.) */
function isLinkLocalV4(ip: string): boolean {
  return ip.startsWith('169.254.');
}

/** RFC1918 private space — what a home/office Wi-Fi actually hands out. */
function isRfc1918(ip: string): boolean {
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const m = /^172\.(\d{1,3})\./.exec(ip);
  return m !== null && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

/** 100.64/10 (CGNAT) — Tailscale-style overlay addresses; reachable only by
 *  peers of the same overlay, not by a phone on the local Wi-Fi. */
function isCgnat(ip: string): boolean {
  const m = /^100\.(\d{1,3})\./.exec(ip);
  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/**
 * The IPv4 address a phone on the same Wi-Fi should dial, so the bridge is
 * reachable without a tunnel. NOT simply the first non-internal IPv4: macOS
 * enumerates iBridge link-locals, VPN utuns, and VM bridges alongside the real
 * NIC, and advertising one of those in the QR makes pairing dial a dead
 * address. Candidates are ranked:
 *   1. RFC1918 on a physical-looking interface (en0/eth0/wlan0…),
 *   2. any other routable address on a physical interface,
 *   3. RFC1918 on a virtual interface (a VPN's 10.x — last-resort connectable),
 *   4. CGNAT overlay (Tailscale) / other virtual,
 *   5. link-local 169.254.x (kept only so SOMETHING shows when it's all we have),
 * with enumeration order breaking ties. Falls back to the bind host.
 */
export function lanHost(fallback: string): string {
  let best: { address: string; rank: number } | null = null;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const virtual = VIRTUAL_IFACE.test(name);
      let rank: number;
      if (isLinkLocalV4(ni.address)) rank = 5;
      else if (isRfc1918(ni.address)) rank = virtual ? 3 : 1;
      else if (isCgnat(ni.address)) rank = 4;
      else rank = virtual ? 4 : 2;
      if (!best || rank < best.rank) best = { address: ni.address, rank };
    }
  }
  return best?.address ?? fallback;
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
  /** Agent public-key fingerprint for the E2E (proxy) path — pinned by the app. */
  fingerprint?: string;
}): string {
  const t = encodeURIComponent(opts.token);
  const fp = opts.fingerprint ? `&fp=${encodeURIComponent(opts.fingerprint)}` : '';
  if (opts.tunnelUrl) {
    const u = new URL(opts.tunnelUrl);
    const scheme = u.protocol === 'https:' ? 'wss' : 'ws';
    // Preserve the routing path (e.g. `/mobile`) the relay routes on.
    const path = u.pathname === '/' ? '/' : `${u.pathname.replace(/\/$/, '')}/`;
    return `${scheme}://${u.host}${path}?t=${t}${fp}`;
  }
  return `ws://${opts.localHost}:${opts.port}/?t=${t}${fp}`;
}

/**
 * The `Origin` header a client dialing `url` will present, when its WebSocket
 * implementation sends one. Browsers send the page origin, but iOS React
 * Native (SocketRocket) derives an Origin from the WS URL itself — ws→http,
 * wss→https, default ports elided — so the bridge must allow-list the origin
 * of every URL it advertises or real iOS devices are rejected at the upgrade
 * handshake. Accepts ws/wss connect URLs and http/https tunnel URLs alike.
 */
export function connectUrlOrigin(url: string): string {
  const u = new URL(url);
  const secure = u.protocol === 'wss:' || u.protocol === 'https:';
  // WHATWG URL elides the scheme-default port from `host` (ws:80 / wss:443),
  // matching SocketRocket's own default-port elision after scheme mapping.
  return `${secure ? 'https' : 'http'}://${u.host}`;
}

/**
 * Every Origin a correctly-paired client may present to a bridge bound to
 * `bindHost`:`port` WITHOUT a tunnel: the advertised URL's origin, plus both
 * loopback spellings (simulators on this machine dial 127.0.0.1 or localhost
 * regardless of what the QR advertises). A tunnel origin is appended by the
 * caller once the tunnel URL is known — see `setAllowedOrigins`.
 */
export function advertisedOrigins(bindHost: string, port: number): string[] {
  return [
    ...new Set([
      connectUrlOrigin(`ws://${advertisedHost(bindHost)}:${port}`),
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ]),
  ];
}

/**
 * Browser-hosted Expo clients present the PAGE origin at the WebSocket
 * handshake, not the dialed WS URL's origin. `moxxy mobile` starts the full
 * Expo app beside the bridge for local smoke/debug work, so the bridge must
 * allow-list that exact app origin while keeping the default-deny posture for
 * unrelated browser pages.
 */
export function expoWebOrigins(expo: {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
}): string[] {
  if (!expo.enabled) return [];
  const origins = new Set<string>([
    `http://localhost:${expo.port}`,
    `http://127.0.0.1:${expo.port}`,
  ]);
  const host = expo.host.trim().toLowerCase();
  if (host === 'lan' || isWildcardHost(host)) {
    origins.add(`http://${lanHost('127.0.0.1')}:${expo.port}`);
  } else if (host && host !== 'local' && host !== 'localhost' && !host.startsWith('127.')) {
    origins.add(`http://${advertisedHost(expo.host)}:${expo.port}`);
  }
  return [...origins];
}
