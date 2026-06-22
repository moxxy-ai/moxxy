import { describe, expect, it, vi } from 'vitest';
import type { WsApiOptions } from '@moxxy/client-transport-ws';
import {
  openBridgePairingTransport,
  resolveBridgePairingTarget,
} from '../src/pairingRuntime';

const FP = 'AGENTFINGERPRINT';
const TOKEN = 'a'.repeat(64);

describe('resolveBridgePairingTarget', () => {
  it('recovers the E2E fingerprint from a relay URL `?fp=`', () => {
    const target = resolveBridgePairingTarget(
      `wss://uuid123.proxy.moxxy.ai/mobile/?t=${TOKEN}&fp=${FP}`,
    );
    expect(target.url).toBe('wss://uuid123.proxy.moxxy.ai/mobile/');
    expect(target.token).toBe(TOKEN);
    expect(target.fingerprint).toBe(FP);
  });

  it('leaves the fingerprint undefined for a plain LAN ws:// URL', () => {
    const target = resolveBridgePairingTarget(`ws://192.168.1.5:8765/?t=${TOKEN}`);
    expect(target.fingerprint).toBeUndefined();
  });

  it('prefers an explicit fingerprint over the URL', () => {
    const target = resolveBridgePairingTarget(`ws://192.168.1.5:8765/?t=${TOKEN}`, null, FP);
    expect(target.fingerprint).toBe(FP);
  });

  it('refuses a wss:// relay URL without a fingerprint (no silent plaintext downgrade)', () => {
    expect(() =>
      resolveBridgePairingTarget(`wss://uuid123.proxy.moxxy.ai/mobile/?t=${TOKEN}`),
    ).toThrow(/fingerprint/i);
  });

  it('allows cleartext ws:// only to LAN/loopback hosts', () => {
    // LAN + loopback are fine (same-Wi-Fi pairing).
    expect(resolveBridgePairingTarget(`ws://127.0.0.1:8765/?t=${TOKEN}`).url).toBe(
      'ws://127.0.0.1:8765',
    );
    expect(resolveBridgePairingTarget(`ws://10.1.2.3:8765/?t=${TOKEN}`).url).toBe(
      'ws://10.1.2.3:8765',
    );
    expect(resolveBridgePairingTarget(`ws://moxxy.local:8765/?t=${TOKEN}`).url).toBe(
      'ws://moxxy.local:8765',
    );
  });

  it('refuses cleartext ws:// to a public host (would leak the bearer in the clear)', () => {
    expect(() => resolveBridgePairingTarget(`ws://evil.example.com/?t=${TOKEN}`)).toThrow(
      /unencrypted|non-local/i,
    );
  });
});

describe('openBridgePairingTransport — E2E proxy wiring', () => {
  function fakeDeps() {
    const calls: WsApiOptions[] = [];
    return {
      calls,
      deps: {
        configurePlatform: vi.fn(),
        configureTransport: vi.fn(),
        makeWsApiHandle: (opts: WsApiOptions) => {
          calls.push(opts);
          return { api: {} as never, close: vi.fn() };
        },
      },
    };
  }

  it('pins the fingerprint via the e2e handshake for a relay QR (token NOT in subprotocol)', () => {
    const { calls, deps } = fakeDeps();
    openBridgePairingTransport(
      `wss://uuid123.proxy.moxxy.ai/mobile/?t=${TOKEN}&fp=${FP}`,
      null,
      deps,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: 'wss://uuid123.proxy.moxxy.ai/mobile/',
      token: TOKEN,
      e2e: { pinnedFingerprint: FP },
    });
  });

  it('omits e2e for a plain LAN gateway (bearer rides the subprotocol)', () => {
    const { calls, deps } = fakeDeps();
    openBridgePairingTransport(`ws://192.168.1.5:8765/?t=${TOKEN}`, null, deps);
    expect(calls[0]?.e2e).toBeUndefined();
  });

  it('threads an explicit fingerprint (the QR path strips the URL before this point)', () => {
    const { calls, deps } = fakeDeps();
    openBridgePairingTransport('ws://192.168.1.5:8765', TOKEN, deps, undefined, FP);
    expect(calls[0]).toMatchObject({ e2e: { pinnedFingerprint: FP } });
  });
});
