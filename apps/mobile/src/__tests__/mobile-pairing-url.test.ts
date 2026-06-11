import { describe, expect, it } from 'vitest';
import { chooseGatewayUrlForPairing, deriveGatewayUrlFromExpoHost, normalizeGatewayUrl } from '../pairingUrl';
import { parsePairingQrPayload } from '../pairingQr';
import { splitConnectUrl } from '../boot';

describe('mobile pairing bridge url', () => {
  it('derives the bridge URL from the Expo Metro LAN host', () => {
    expect(deriveGatewayUrlFromExpoHost('192.168.1.44:8081')).toBe('ws://192.168.1.44:8765');
    expect(deriveGatewayUrlFromExpoHost('exp://10.0.0.8:8081')).toBe('ws://10.0.0.8:8765');
  });

  it('falls back to localhost only when the Expo host is unavailable', () => {
    expect(deriveGatewayUrlFromExpoHost(null)).toBe('ws://127.0.0.1:8765');
  });

  it('normalizes manually entered bridge URLs to bare ws:// targets', () => {
    expect(normalizeGatewayUrl('192.168.1.44:8765')).toBe('ws://192.168.1.44:8765');
    expect(normalizeGatewayUrl('192.168.1.44')).toBe('ws://192.168.1.44:8765');
    expect(normalizeGatewayUrl('ws://192.168.1.44:8765/')).toBe('ws://192.168.1.44:8765');
    expect(normalizeGatewayUrl('ws://192.168.1.44:8765/?t=secret')).toBe('ws://192.168.1.44:8765');
  });

  it('maps pasted http(s) tunnel URLs onto the WebSocket schemes', () => {
    expect(normalizeGatewayUrl('https://abc.trycloudflare.com')).toBe('wss://abc.trycloudflare.com');
    expect(normalizeGatewayUrl('http://192.168.1.44:8765')).toBe('ws://192.168.1.44:8765');
    expect(normalizeGatewayUrl('wss://abc.trycloudflare.com/?t=tok')).toBe('wss://abc.trycloudflare.com');
  });

  it('recovers the latest valid URL from a duplicated manual entry', () => {
    expect(normalizeGatewayUrl('ws://wsws127.0.0.1:9999ws://127.0.0.1:8765')).toBe('ws://127.0.0.1:8765');
  });

  it('replaces a stored loopback URL when Expo exposes a LAN host', () => {
    expect(chooseGatewayUrlForPairing('ws://127.0.0.1:8765', '192.168.1.44:8081')).toBe('ws://192.168.1.44:8765');
    expect(chooseGatewayUrlForPairing('ws://localhost:8765', '192.168.1.44:8081')).toBe('ws://192.168.1.44:8765');
    expect(chooseGatewayUrlForPairing('ws://10.0.0.2:8765', '192.168.1.44:8081')).toBe('ws://10.0.0.2:8765');
  });

  it('never rewrites a scanned desktop-gateway LAN URL (built app, no Expo dev host)', () => {
    // The desktop QR advertises the machine's LAN IP; the app must dial it
    // verbatim — in a built app there is no Expo host to "improve" it with,
    // and even in dev the non-loopback host wins (previous case).
    expect(chooseGatewayUrlForPairing('ws://172.20.10.2:8765', null)).toBe('ws://172.20.10.2:8765');
    expect(chooseGatewayUrlForPairing('ws://192.168.1.7:8765', undefined)).toBe('ws://192.168.1.7:8765');
  });
});

describe('mobile pairing QR payload', () => {
  it('parses the channel QR (connect URL with an embedded ?t= token)', () => {
    expect(parsePairingQrPayload('ws://192.168.1.7:8765/?t=s3cret')).toEqual({
      gatewayUrl: 'ws://192.168.1.7:8765',
      token: 's3cret',
    });
    expect(parsePairingQrPayload('wss://abc.trycloudflare.com/?t=tok%2Bx')).toEqual({
      gatewayUrl: 'wss://abc.trycloudflare.com',
      token: 'tok+x',
    });
  });

  it('parses a tokenless connect URL (manual token entry follows)', () => {
    expect(parsePairingQrPayload('ws://192.168.1.7:8765')).toEqual({
      gatewayUrl: 'ws://192.168.1.7:8765',
      token: null,
    });
  });

  it('rejects QR payloads that are not Moxxy connect URLs', () => {
    expect(() => parsePairingQrPayload('not-a-url')).toThrow('Invalid Moxxy pairing QR code');
    expect(() => parsePairingQrPayload(JSON.stringify({
      type: 'moxxy-mobile-gateway',
      version: 1,
      url: 'http://192.168.1.44:17902/mobile/v1',
      code: '123456',
    }))).toThrow('Invalid Moxxy pairing QR code');
  });

  it('agrees with the boot-time splitter on what the live WS URL is', () => {
    const scanned = 'ws://192.168.1.7:8765/?t=s3cret';
    const parsed = parsePairingQrPayload(scanned);
    const split = splitConnectUrl(scanned);
    expect(parsed.token).toBe(split.token);
    expect(normalizeGatewayUrl(split.url)).toBe(parsed.gatewayUrl);
  });
});
