/**
 * Wire the shared client layer to React Native: a WebSocket transport pointed
 * at the bridge `moxxy mobile` (or the desktop gateway) listens on.
 *
 * The QR `moxxy mobile` prints embeds the pairing token as `?t=` (one scan
 * carries everything), but the token must NOT ride the live WS URL — query
 * strings leak through tunnel/proxy logs. So the scanned URL is split here:
 * `?t=` is stripped and handed to the transport, which presents it via the
 * `Sec-WebSocket-Protocol` bearer entry instead.
 *
 * Platform capabilities stay EMPTY (`configurePlatform({})`): this PoC has no
 * voice/attachments/TTS surface, and client-core's optional-capability design
 * makes the shared hooks degrade to their "unsupported" branch.
 */

import { configureTransport } from '@moxxy/client-core/transport';
import { configurePlatform } from '@moxxy/client-core/platform';
import { makeWsApi, splitConnectUrl } from '@moxxy/client-transport-ws';

// `makeWsApi` constructs a live WebSocket + reconnect timers and does NOT expose
// a disposer, so each call layers a new client over the last. StrictMode /
// Fast-Refresh remounts re-run the env-boot effect with the SAME url; without a
// guard that orphans a socket+timers every remount. Dedupe on the booted url so
// a repeat boot for an already-active endpoint is a no-op. (A genuine re-pair to
// a DIFFERENT host still reconfigures — the prior socket can't be force-closed
// until `makeWsApi` returns a disposer; see needsFollowup.)
let bootedUrl: string | null = null;

export function bootMobile(rawUrl: string, token?: string): void {
  const split = splitConnectUrl(rawUrl);
  if (bootedUrl === split.url) return;
  const effectiveToken = token ?? split.token;
  configureTransport(
    makeWsApi({ url: split.url, ...(effectiveToken ? { token: effectiveToken } : {}) }),
  );
  configurePlatform({});
  bootedUrl = split.url;
}
