/**
 * Manual-entry helpers for the bridge ("gateway") URL.
 *
 * Adapted from the reference app's HTTP pairing-gateway helpers to OUR pairing
 * transport: `moxxy mobile` / the desktop bridge listen on a plain WebSocket
 * (default port 8765) and the QR payload is the connect URL itself with the
 * pairing token riding as `?t=` (see `plugin-channel-mobile/src/tunnel.ts
 * buildConnectUrl`). These helpers normalize whatever the user types or scans
 * into a BARE `ws(s)://host[:port]` URL — token extraction is
 * `parsePairingQrPayload` / `boot.splitConnectUrl`'s job.
 *
 * Parsing is regex-based, not `new URL` — Hermes' URL support is unreliable
 * (same rationale as `boot.ts`).
 */

export const DEFAULT_BRIDGE_PORT = 8765;
const LOCAL_BRIDGE_URL = `ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`;

export function deriveGatewayUrlFromExpoHost(hostUri?: string | null): string {
  const host = extractHost(hostUri);
  return host ? `ws://${host}:${DEFAULT_BRIDGE_PORT}` : LOCAL_BRIDGE_URL;
}

export function chooseGatewayUrlForPairing(storedUrl: string | null | undefined, expoHostUri?: string | null): string {
  const derivedUrl = deriveGatewayUrlFromExpoHost(expoHostUri);
  if (!storedUrl) return derivedUrl;

  const normalizedStored = normalizeGatewayUrl(storedUrl);
  if (isLoopbackUrl(normalizedStored) && !isLoopbackUrl(derivedUrl)) return derivedUrl;
  return normalizedStored;
}

/**
 * Normalize a manually entered / scanned bridge URL to a bare `ws(s)://host[:port]`:
 *   - `http(s)` schemes map to `ws(s)` (a tunnel URL pasted from the browser);
 *   - a bare `host[:port]` gets `ws://` prepended;
 *   - a bare `ws` host without a port gets the default bridge port (a `wss`
 *     tunnel host stays portless — 443 is implied);
 *   - path, query (incl. a stray `?t=` token), and hash are stripped;
 *   - a garbled double-paste recovers the LAST valid absolute URL.
 */
export function normalizeGatewayUrl(value: string): string {
  const recovered = recoverLatestAbsoluteUrl(value.trim());
  if (!recovered) return LOCAL_BRIDGE_URL;

  const withScheme = /^(?:wss?|https?):\/\//i.test(recovered) ? recovered : `ws://${recovered}`;
  const match = /^(wss?|https?):\/\/([^\s/?#]+)/i.exec(withScheme);
  if (!match) return LOCAL_BRIDGE_URL;

  const scheme = mapScheme(match[1]!);
  let host = match[2]!;
  if (scheme === 'ws' && !/:\d+$/.test(host)) host = `${host}:${DEFAULT_BRIDGE_PORT}`;
  return `${scheme}://${host}`;
}

function mapScheme(raw: string): 'ws' | 'wss' {
  const lower = raw.toLowerCase();
  return lower === 'https' || lower === 'wss' ? 'wss' : 'ws';
}

function recoverLatestAbsoluteUrl(value: string): string {
  const matches = [...value.matchAll(/(?:wss?|https?):\/\//gi)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const start = matches[index]!.index;
    if (typeof start !== 'number') continue;
    const candidate = value.slice(start).trim();
    if (/^(?:wss?|https?):\/\/[^\s/?#]+/i.test(candidate)) return candidate;
    // Keep scanning older candidates.
  }
  return value;
}

export function isLoopbackUrl(value: string): boolean {
  const host = hostOf(value);
  if (!host) return false;
  const bare = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return bare === 'localhost' || bare === '::1' || bare.startsWith('127.');
}

function hostOf(value: string): string | null {
  const match = /^(?:wss?|https?):\/\/([^\s/?#]+)/i.exec(value.trim());
  return match ? match[1]! : null;
}

function extractHost(hostUri?: string | null): string | null {
  if (!hostUri) return null;
  const withoutProtocol = hostUri.replace(/^[a-z]+:\/\//i, '');
  const hostWithPort = withoutProtocol.split('/')[0] ?? '';
  const host = hostWithPort.split(':')[0]!;
  return host.length > 0 ? host : null;
}
