/**
 * Wire the shared client layer to React Native: a WebSocket transport pointed at
 * the desktop host's bridge, and (for this PoC) no platform capabilities — voice
 * capture, TTS, the legacy KV migration, and the event bus all degrade to
 * no-ops, exactly as the optional capability design intends. A real mobile build
 * would register Expo-backed implementations here instead.
 *
 * The QR `moxxy mobile` prints embeds the pairing token as `?t=` (one scan
 * carries everything), but the token must NOT ride the live WS URL — query
 * strings leak through tunnel/proxy logs. So the scanned URL is split here:
 * `?t=` is stripped and handed to the transport, which presents it via the
 * `Sec-WebSocket-Protocol` bearer entry instead.
 */

import { configureTransport } from '@moxxy/client-core/transport';
import { configurePlatform } from '@moxxy/client-core/platform';
import { makeWsApi } from '@moxxy/client-transport-ws';

/** Split a scanned pairing URL into the bare WS URL + the embedded `?t=` token
 *  (regex, not `new URL` — Hermes' URL support is unreliable). */
export function splitConnectUrl(scanned: string): { url: string; token?: string } {
  const match = /[?&]t=([^&#]+)/.exec(scanned);
  if (!match) return { url: scanned };
  let token: string;
  try {
    token = decodeURIComponent(match[1]!);
  } catch {
    return { url: scanned }; // malformed escape — connect as-is
  }
  const url = scanned
    .replace(/([?&])t=[^&#]*&?/, '$1')
    .replace(/[?&]$/, '');
  return { url, token };
}

export function bootMobile(rawUrl: string, token?: string): void {
  const split = splitConnectUrl(rawUrl);
  const effectiveToken = token ?? split.token;
  configureTransport(
    makeWsApi({ url: split.url, ...(effectiveToken ? { token: effectiveToken } : {}) }),
  );
  configurePlatform({});
}
