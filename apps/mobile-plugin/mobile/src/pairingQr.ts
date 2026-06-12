import { splitConnectUrl } from '@moxxy/client-transport-ws';

export interface PairingQrTarget {
  readonly gatewayUrl: string;
  readonly code: string;
}

export function parsePairingQrPayload(raw: string): PairingQrTarget {
  const bridgeTarget = parseBridgeConnectUrl(raw);
  if (bridgeTarget) return bridgeTarget;
  throw new Error('Invalid Moxxy pairing QR code');
}

function parseBridgeConnectUrl(raw: string): PairingQrTarget | null {
  if (!/^wss?:\/\//i.test(raw.trim())) return null;
  const split = splitConnectUrl(raw);
  if (!split.token?.trim()) {
    throw new Error('Invalid Moxxy pairing QR code');
  }
  return {
    gatewayUrl: split.url.replace(/\/$/, ''),
    code: split.token.trim(),
  };
}
