/**
 * Client-side parsing of the pairing URL a moxxy QR carries (`moxxy mobile`,
 * the desktop gateway). The payload is the connect URL itself with the pairing
 * token embedded as `?t=` — one scan carries everything:
 *
 *   ws://192.168.1.7:8765/?t=<token>        (LAN)
 *   wss://xyz.trycloudflare.com/?t=<token>  (tunnel)
 *
 * The split yields the bare WS URL + the token: the token must never ride the
 * live WS URL (query strings leak through tunnel/proxy logs), so callers hand
 * it to {@link makeWsApi}, which presents it via the `Sec-WebSocket-Protocol`
 * bearer entry instead. Regex, not `new URL` — Hermes' URL support is
 * unreliable, and this module must stay RN-bundlable.
 *
 * This is the OTHER half of the contract `buildConnectUrl` (in
 * `@moxxy/plugin-channel-mobile`) emits; the desktop's ws-bridge round-trip
 * test feeds its gateway URL through this exact function.
 */
export function splitConnectUrl(scanned: string): { url: string; token?: string } {
  const match = /[?&]t=([^&#]+)/.exec(scanned);
  if (!match) return { url: scanned };
  let token: string;
  try {
    token = decodeURIComponent(match[1]!);
  } catch {
    return { url: scanned }; // malformed escape — connect as-is
  }
  // Strip EVERY `t=` param (a hostile/malformed QR can carry more than one —
  // any surviving `t=` would leak onto the live WS URL we hand to makeWsApi),
  // then normalize the leftover separators so no dangling `?`/`&`/`?#` rides
  // out (RN/Hermes' WebSocket can choke on those artifacts).
  const url = scanned
    .replace(/([?&])t=[^&#]*/g, '$1')
    .replace(/&{2,}/g, '&')
    .replace(/([?&])&/g, '$1')
    .replace(/[?&](?=#|$)/, '');
  return { url, token };
}
