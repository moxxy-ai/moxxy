import { normalizeGatewayUrl } from './pairingUrl';

export interface PairingQrTarget {
  readonly gatewayUrl: string;
  readonly code: string;
}

export function parsePairingQrPayload(raw: string): PairingQrTarget {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('Invalid Moxxy pairing QR code');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid Moxxy pairing QR code');
  }
  const value = payload as Record<string, unknown>;
  if (value.type !== 'moxxy-mobile-gateway') {
    throw new Error('Invalid Moxxy pairing QR code');
  }
  if (value.version !== 1) {
    throw new Error('Unsupported Moxxy pairing QR code');
  }
  if (typeof value.url !== 'string' || typeof value.code !== 'string' || value.code.trim().length === 0) {
    throw new Error('Invalid Moxxy pairing QR code');
  }

  return {
    gatewayUrl: normalizeGatewayUrl(value.url),
    code: value.code,
  };
}
