import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseGatewayUrlForPairing, deriveGatewayUrlFromExpoHost, normalizeGatewayUrl } from '../src/pairingUrl';
import { parsePairingQrPayload } from '../src/pairingQr';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mobile pairing gateway url', () => {
  it('derives the gateway URL from the Expo Metro LAN host', () => {
    expect(deriveGatewayUrlFromExpoHost('192.168.1.44:8081')).toBe('ws://192.168.1.44:8765');
    expect(deriveGatewayUrlFromExpoHost('exp://10.0.0.8:8081')).toBe('ws://10.0.0.8:8765');
  });

  it('falls back to localhost only when Expo host is unavailable', () => {
    expect(deriveGatewayUrlFromExpoHost(null)).toBe('ws://127.0.0.1:8765');
  });

  it('normalizes manually entered gateway URLs', () => {
    expect(normalizeGatewayUrl('192.168.1.44:8765')).toBe('ws://192.168.1.44:8765');
    expect(normalizeGatewayUrl('ws://192.168.1.44:8765/?t=secret-token')).toBe('ws://192.168.1.44:8765');
    expect(normalizeGatewayUrl('wss://mobile.example.test/socket?t=secret-token')).toBe('wss://mobile.example.test/socket');
  });

  it('recovers the latest valid URL from a duplicated manual entry', () => {
    expect(normalizeGatewayUrl('ws://ws127.0.0.1:8764ws://127.0.0.1:8765?t=secret')).toBe('ws://127.0.0.1:8765');
  });

  it('replaces any stored legacy HTTP gateway when Expo exposes a WS bridge target', () => {
    expect(chooseGatewayUrlForPairing('http://127.0.0.1:17902', '192.168.1.44:8081')).toBe('ws://192.168.1.44:8765');
    expect(chooseGatewayUrlForPairing('http://localhost:17902', '192.168.1.44:8081')).toBe('ws://192.168.1.44:8765');
    expect(chooseGatewayUrlForPairing('http://10.0.0.2:17902', '192.168.1.44:8081')).toBe('ws://192.168.1.44:8765');
  });

  it('rejects the legacy HTTP gateway QR payload', () => {
    expect(() => parsePairingQrPayload(JSON.stringify({
      type: 'moxxy-mobile-gateway',
      version: 1,
      url: 'http://192.168.1.44:17902/mobile/v1',
      code: '123456',
    }))).toThrow('Invalid Moxxy pairing QR code');
  });

  it('parses the working moxxy mobile bridge QR payload into a clean connect target', () => {
    expect(parsePairingQrPayload('wss://mobile.example.test/socket?t=secret-token')).toEqual({
      gatewayUrl: 'wss://mobile.example.test/socket',
      code: 'secret-token',
    });
  });

  it('parses bridge QR payloads without relying on the runtime URL implementation', () => {
    vi.stubGlobal('URL', class BrokenUrl {
      constructor() {
        throw new Error('URL unavailable');
      }
    });

    expect(parsePairingQrPayload('ws://127.0.0.1:8765/?t=secret-token')).toEqual({
      gatewayUrl: 'ws://127.0.0.1:8765',
      code: 'secret-token',
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
    }))).toThrow('Invalid Moxxy pairing QR code');
    expect(() => parsePairingQrPayload('ws://127.0.0.1:8765/')).toThrow('Invalid Moxxy pairing QR code');
  });
});
