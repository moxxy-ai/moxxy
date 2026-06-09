import { describe, expect, it } from 'vitest';
import { chooseGatewayUrlForPairing, deriveGatewayUrlFromExpoHost, normalizeGatewayUrl } from '../mobile/src/pairingUrl';
import { parsePairingQrPayload } from '../mobile/src/pairingQr';

describe('mobile pairing gateway url', () => {
  it('derives the gateway URL from the Expo Metro LAN host', () => {
    expect(deriveGatewayUrlFromExpoHost('192.168.1.44:8081')).toBe('http://192.168.1.44:17902');
    expect(deriveGatewayUrlFromExpoHost('exp://10.0.0.8:8081')).toBe('http://10.0.0.8:17902');
  });

  it('falls back to localhost only when Expo host is unavailable', () => {
    expect(deriveGatewayUrlFromExpoHost(null)).toBe('http://127.0.0.1:17902');
  });

  it('normalizes manually entered gateway URLs', () => {
    expect(normalizeGatewayUrl('192.168.1.44:17902')).toBe('http://192.168.1.44:17902');
    expect(normalizeGatewayUrl('http://192.168.1.44:17902/mobile/v1')).toBe('http://192.168.1.44:17902');
    expect(normalizeGatewayUrl('http://192.168.1.44:17902/mobile/v1/pairing')).toBe('http://192.168.1.44:17902');
  });

  it('recovers the latest valid URL from a duplicated manual entry', () => {
    expect(normalizeGatewayUrl('http://hthttp127.0.0.1:17903http://127.0.0.1:17902')).toBe('http://127.0.0.1:17902');
  });

  it('replaces a stored loopback URL when Expo exposes a LAN host', () => {
    expect(chooseGatewayUrlForPairing('http://127.0.0.1:17902', '192.168.1.44:8081')).toBe('http://192.168.1.44:17902');
    expect(chooseGatewayUrlForPairing('http://localhost:17902', '192.168.1.44:8081')).toBe('http://192.168.1.44:17902');
    expect(chooseGatewayUrlForPairing('http://10.0.0.2:17902', '192.168.1.44:8081')).toBe('http://10.0.0.2:17902');
  });

  it('parses the gateway QR payload into a normalized pairing target', () => {
    expect(parsePairingQrPayload(JSON.stringify({
      type: 'moxxy-mobile-gateway',
      version: 1,
      url: 'http://192.168.1.44:17902/mobile/v1',
      code: '123456',
    }))).toEqual({
      gatewayUrl: 'http://192.168.1.44:17902',
      code: '123456',
    });
  });

  it('rejects QR payloads that are not Moxxy mobile pairing payloads', () => {
    expect(() => parsePairingQrPayload('not-json')).toThrow('Invalid Moxxy pairing QR code');
    expect(() => parsePairingQrPayload(JSON.stringify({
      type: 'other',
      version: 1,
      url: 'http://192.168.1.44:17902/mobile/v1',
      code: '123456',
    }))).toThrow('Invalid Moxxy pairing QR code');
    expect(() => parsePairingQrPayload(JSON.stringify({
      type: 'moxxy-mobile-gateway',
      version: 2,
      url: 'http://192.168.1.44:17902/mobile/v1',
      code: '123456',
    }))).toThrow('Unsupported Moxxy pairing QR code');
  });
});
