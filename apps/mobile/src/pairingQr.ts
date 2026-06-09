/**
 * QR-payload parsing, adapted to OUR pairing format. The reference app's
 * gateway printed a JSON payload (`{type:'moxxy-mobile-gateway',…}`); moxxy's
 * `plugin-channel-mobile` prints a QR whose payload is the connect URL itself
 * with the pairing token embedded as `?t=` (one scan carries everything):
 *
 *   ws://192.168.1.7:8765/?t=<token>     (LAN)
 *   wss://xyz.trycloudflare.com/?t=<token>  (tunnel)
 *
 * The parse splits that into the bare gateway URL + the token — mirroring
 * `boot.splitConnectUrl`, which performs the same split right before the
 * transport is configured (the token must never ride the live WS URL).
 */

import { normalizeGatewayUrl } from './pairingUrl';

export interface PairingQrTarget {
  readonly gatewayUrl: string;
  readonly token: string | null;
}

export function parsePairingQrPayload(raw: string): PairingQrTarget {
  const scanned = raw.trim();
  // Not a URL (someone scanned a random QR, or an old JSON-payload QR).
  if (!/^(?:wss?|https?):\/\/[^\s/?#]+/i.test(scanned)) {
    throw new Error('Invalid Moxxy pairing QR code');
  }

  const match = /[?&]t=([^&#]+)/.exec(scanned);
  let token: string | null = null;
  if (match) {
    try {
      token = decodeURIComponent(match[1]!);
    } catch {
      token = match[1]!; // malformed escape — keep the raw value
    }
  }

  return {
    gatewayUrl: normalizeGatewayUrl(scanned),
    token,
  };
}
