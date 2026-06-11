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

export function bootMobile(rawUrl: string, token?: string): void {
  const split = splitConnectUrl(rawUrl);
  const effectiveToken = token ?? split.token;
  configureTransport(
    makeWsApi({ url: split.url, ...(effectiveToken ? { token: effectiveToken } : {}) }),
  );
  configurePlatform({});
}
