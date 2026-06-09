/**
 * Wire the shared client layer to React Native: a WebSocket transport pointed at
 * the desktop host's bridge.
 *
 * Platform capabilities stay EMPTY (`configurePlatform({})`) by design, not as
 * a stub: this app follows the reference architecture where the platform
 * surface lives in the app's own hooks, which call the Expo SDKs directly —
 * `useAttachments` (expo-image-picker / document-picker / clipboard),
 * `useVoiceRecorder` (expo-audio), `useQrScanner` (expo-camera),
 * `useMessageCopy` (expo-clipboard), `storage` (expo-secure-store). None of
 * them read client-core's `getPlatform()`, and the registry's contracts are
 * web-shaped where they overlap (e.g. `AudioCapture` demands a PCM16@24kHz
 * pipeline, while mobile ships the platform-native compressed clip to the
 * runner's transcriber). client-core's optional-capability design means the
 * few shared hooks that do consult the registry (TTS, legacy KV migration)
 * degrade to their "unsupported" branch — exactly right for mobile today.
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
import { installConsoleFilters } from './consoleFilters';

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
  installConsoleFilters();
  const split = splitConnectUrl(rawUrl);
  const effectiveToken = token ?? split.token;
  configureTransport(
    makeWsApi({ url: split.url, ...(effectiveToken ? { token: effectiveToken } : {}) }),
  );
  configurePlatform({});
}
