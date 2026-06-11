/**
 * Bearer-token + Origin checks for the WebSocket bridge handshake. Reuses the
 * SDK's constant-time {@link bearerGuard} (same comparator the HTTP/web
 * channels use) so a token guess can't be timed. Token presentations, in
 * preference order:
 *   1. `Authorization: Bearer <token>` — native clients (Node `ws`, RN with
 *      header support).
 *   2. a `Sec-WebSocket-Protocol` entry `moxxy.bearer.<encoded-token>` — for
 *      WebSocket implementations that cannot set request headers (browser /
 *      React Native). See `encodeWsBearerProtocol` in `@moxxy/sdk`.
 *   3. a `?t=<token>` query parameter — legacy only, OFF by default: query
 *      strings leak through logs (tunnel providers, proxies) and shoulder-surfed
 *      URLs. Enable via `allowQueryToken` only where an already-paired legacy
 *      client must keep working.
 *
 * Origin: a request WITHOUT an `Origin` header (Node `ws`, Android/OkHttp)
 * always passes that check; one that carries an Origin is rejected unless it
 * is explicitly allow-listed — this stops a malicious webpage on the victim's
 * machine from even attempting the token handshake. NOTE the header is NOT a
 * browser-only signal: iOS React Native (SocketRocket) sends an Origin derived
 * from the WS URL itself (ws→http, wss→https), so a server real devices pair
 * with must allow-list the origins of every URL it advertises.
 */

import type { IncomingMessage } from 'node:http';
import { bearerGuard, tokenFromWsProtocolHeader } from '@moxxy/sdk';

const BEARER = 'Bearer ';

export interface WsAuthOptions {
  /** Accept the legacy `?t=<token>` query credential. Default false. */
  readonly allowQueryToken?: boolean;
}

export function checkWsAuth(
  req: IncomingMessage,
  expected: string,
  opts: WsAuthOptions = {},
): boolean {
  // Shared pre-connection bearer handler — empty `expected` always denies.
  const guard = bearerGuard(expected);

  const auth = req.headers.authorization;
  if (auth && auth.startsWith(BEARER) && guard(auth.slice(BEARER.length))) return true;

  const fromProtocol = tokenFromWsProtocolHeader(req.headers['sec-websocket-protocol']);
  if (fromProtocol !== null && guard(fromProtocol)) return true;

  if (opts.allowQueryToken) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (guard(url.searchParams.get('t'))) return true;
    } catch {
      // Malformed request URL — treat as unauthenticated.
    }
  }
  return false;
}

/**
 * Reject unknown-origin upgrades: a request with an `Origin` header only
 * passes when that origin is in `allowedOrigins` (case-insensitive). Requests
 * WITHOUT an Origin header (Node `ws`, Android/OkHttp) always pass; browsers
 * cannot omit the header, so this cleanly fences off web pages probing
 * `ws://127.0.0.1`. iOS React Native DOES send one (derived from the WS URL),
 * so the caller must allow-list every advertised URL's origin.
 */
export function checkWsOrigin(
  req: IncomingMessage,
  allowedOrigins: readonly string[] = [],
): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const lower = origin.toLowerCase();
  return allowedOrigins.some((allowed) => allowed.toLowerCase() === lower);
}
