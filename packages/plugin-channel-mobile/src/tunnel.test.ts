/**
 * The QR / connect URL must never advertise an address the server isn't
 * reachable on (audit A13: the loopback default used to print the LAN IP).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:os', () => ({
  default: {
    networkInterfaces: vi.fn(() => ({
      lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
    })),
  },
}));

import os from 'node:os';
import {
  advertisedHost,
  advertisedOrigins,
  buildConnectUrl,
  connectUrlOrigin,
  expoWebOrigins,
  isLoopbackHost,
  isWildcardHost,
  lanHost,
  resolveBindHost,
} from './tunnel.js';

const ifaces = vi.mocked(os.networkInterfaces);

afterEach(() => {
  delete process.env.MOXXY_MOBILE_HOST;
});

describe('resolveBindHost', () => {
  it('defaults to loopback — LAN exposure stays an explicit opt-in', () => {
    expect(resolveBindHost(undefined)).toBe('127.0.0.1');
    expect(resolveBindHost('  ')).toBe('127.0.0.1');
  });

  it('uses the configured host when set', () => {
    expect(resolveBindHost('0.0.0.0')).toBe('0.0.0.0');
  });

  it('lets MOXXY_MOBILE_HOST override config (env → config → default)', () => {
    process.env.MOXXY_MOBILE_HOST = '192.168.1.42';
    expect(resolveBindHost('0.0.0.0')).toBe('192.168.1.42');
  });
});

describe('advertisedHost', () => {
  it('advertises loopback for the default loopback bind (NOT the LAN IP)', () => {
    expect(advertisedHost('127.0.0.1')).toBe('127.0.0.1');
    expect(advertisedHost('localhost')).toBe('localhost');
  });

  it('advertises the LAN IP for a wildcard bind (the bind string is unconnectable)', () => {
    expect(advertisedHost('0.0.0.0')).toBe('192.168.1.42');
    expect(advertisedHost('::')).toBe('192.168.1.42');
  });

  it('falls back to loopback for a wildcard bind with no external interface', () => {
    ifaces.mockReturnValueOnce({
      lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    } as never);
    expect(advertisedHost('0.0.0.0')).toBe('127.0.0.1');
  });

  it('advertises an explicitly configured host verbatim', () => {
    expect(advertisedHost('192.168.1.7')).toBe('192.168.1.7');
    expect(advertisedHost('my-laptop.local')).toBe('my-laptop.local');
  });
});

describe('host classification', () => {
  it('recognises loopback hosts', () => {
    for (const h of ['127.0.0.1', '127.0.1.1', 'localhost', 'LOCALHOST', '::1']) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    expect(isLoopbackHost('192.168.1.42')).toBe(false);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });

  it('recognises wildcard hosts', () => {
    expect(isWildcardHost('0.0.0.0')).toBe(true);
    expect(isWildcardHost('::')).toBe(true);
    expect(isWildcardHost('127.0.0.1')).toBe(false);
  });
});

describe('buildConnectUrl', () => {
  it('default config: QR host matches the (loopback) bind host', () => {
    const bindHost = resolveBindHost(undefined);
    const url = buildConnectUrl({
      tunnelUrl: null,
      localHost: advertisedHost(bindHost),
      port: 8765,
      token: 'tok',
    });
    expect(url).toBe('ws://127.0.0.1:8765/?t=tok');
  });

  it('explicit host opt-in: QR advertises exactly what is bound', () => {
    const url = buildConnectUrl({
      tunnelUrl: null,
      localHost: advertisedHost('192.168.1.7'),
      port: 8765,
      token: 'tok',
    });
    expect(url).toBe('ws://192.168.1.7:8765/?t=tok');
  });

  it('tunnel path unchanged: https tunnel → wss URL, token embedded', () => {
    const url = buildConnectUrl({
      tunnelUrl: 'https://example.trycloudflare.com',
      localHost: advertisedHost('127.0.0.1'),
      port: 8765,
      token: 't k', // must be URL-encoded
    });
    expect(url).toBe('wss://example.trycloudflare.com/?t=t%20k');
  });

  it('lanHost falls back to the given host when no external interface exists', () => {
    ifaces.mockReturnValueOnce({} as never);
    expect(lanHost('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('connectUrlOrigin (the Origin iOS RN presents for a dialed URL)', () => {
  it('maps a ws connect URL to its http origin, keeping a non-default port', () => {
    expect(connectUrlOrigin('ws://192.168.1.7:8765/?t=tok')).toBe('http://192.168.1.7:8765');
  });

  it('maps a wss tunnel connect URL to its https origin (default port elided)', () => {
    // Exactly the Origin a real iPhone sent through an ngrok tunnel.
    expect(connectUrlOrigin('wss://abcd.ngrok-free.example/?t=tok')).toBe(
      'https://abcd.ngrok-free.example',
    );
  });

  it('accepts a raw https tunnel URL (pre-wss rewrite) too', () => {
    expect(connectUrlOrigin('https://example.trycloudflare.com')).toBe(
      'https://example.trycloudflare.com',
    );
  });
});

describe('advertisedOrigins (what the bridge must allow-list for real devices)', () => {
  it('wildcard bind: the LAN advertised origin plus both loopback spellings', () => {
    expect(advertisedOrigins('0.0.0.0', 8765)).toEqual([
      'http://192.168.1.42:8765',
      'http://127.0.0.1:8765',
      'http://localhost:8765',
    ]);
  });

  it('loopback bind: dedupes to just the loopback spellings', () => {
    expect(advertisedOrigins('127.0.0.1', 8765)).toEqual([
      'http://127.0.0.1:8765',
      'http://localhost:8765',
    ]);
  });
});

describe('expoWebOrigins (the browser-hosted Expo app origin)', () => {
  it('includes localhost/loopback plus the LAN origin for Expo web smoke tests', () => {
    expect(expoWebOrigins({ enabled: true, host: 'lan', port: 8081 })).toEqual([
      'http://localhost:8081',
      'http://127.0.0.1:8081',
      'http://192.168.1.42:8081',
    ]);
  });

  it('returns no browser origins when Expo startup is disabled', () => {
    expect(expoWebOrigins({ enabled: false, host: 'lan', port: 8081 })).toEqual([]);
  });
});

describe('lanHost interface ranking (the QR must advertise a phone-reachable IP)', () => {
  it('skips a link-local iBridge IPv4 that enumerates before en0 (Intel Mac T2)', () => {
    ifaces.mockReturnValueOnce({
      lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      en5: [{ family: 'IPv4', internal: false, address: '169.254.123.4' }],
      en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
    } as never);
    expect(lanHost('127.0.0.1')).toBe('192.168.1.42');
  });

  it('prefers the physical NIC over a VPN utun with an RFC1918 address', () => {
    ifaces.mockReturnValueOnce({
      utun4: [{ family: 'IPv4', internal: false, address: '10.8.0.2' }],
      en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
    } as never);
    expect(lanHost('127.0.0.1')).toBe('192.168.1.42');
  });

  it('prefers the physical NIC over a Tailscale CGNAT overlay address', () => {
    ifaces.mockReturnValueOnce({
      utun3: [{ family: 'IPv4', internal: false, address: '100.101.102.103' }],
      en0: [{ family: 'IPv4', internal: false, address: '172.20.10.2' }],
    } as never);
    expect(lanHost('127.0.0.1')).toBe('172.20.10.2');
  });

  it('prefers the physical NIC over a VM bridge (Docker/Parallels style)', () => {
    ifaces.mockReturnValueOnce({
      bridge100: [{ family: 'IPv4', internal: false, address: '192.168.64.1' }],
      en0: [{ family: 'IPv4', internal: false, address: '10.0.1.5' }],
    } as never);
    expect(lanHost('127.0.0.1')).toBe('10.0.1.5');
  });

  it('still returns a VPN address when it is the only routable candidate', () => {
    ifaces.mockReturnValueOnce({
      utun4: [{ family: 'IPv4', internal: false, address: '10.8.0.2' }],
    } as never);
    expect(lanHost('127.0.0.1')).toBe('10.8.0.2');
  });

  it('keeps first-enumerated order between equally-ranked candidates', () => {
    ifaces.mockReturnValueOnce({
      en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
      en1: [{ family: 'IPv4', internal: false, address: '192.168.1.43' }],
    } as never);
    expect(lanHost('127.0.0.1')).toBe('192.168.1.42');
  });
});
