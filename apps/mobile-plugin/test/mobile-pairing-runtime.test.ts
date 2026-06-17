import { describe, expect, it, vi } from 'vitest';
import { openBridgePairingTransport, resolveBridgePairingTarget } from '../mobile/src/pairingRuntime';

describe('mobile bridge pairing runtime', () => {
  it('resolves PoC-style bridge URLs to a clean URL and token', () => {
    expect(resolveBridgePairingTarget('ws://127.0.0.1:8765/?t=secret')).toEqual({
      url: 'ws://127.0.0.1:8765',
      token: 'secret',
    });
    expect(resolveBridgePairingTarget('wss://mobile.example.test/socket?t=a%2Bb')).toEqual({
      url: 'wss://mobile.example.test/socket',
      token: 'a+b',
    });
  });

  it('allows manual token input while still storing the clean bridge URL', () => {
    expect(resolveBridgePairingTarget('ws://127.0.0.1:8765/', 'typed-token')).toEqual({
      url: 'ws://127.0.0.1:8765',
      token: 'typed-token',
    });
  });

  it('rejects non-bridge and tokenless pairing targets', () => {
    expect(() => resolveBridgePairingTarget('http://127.0.0.1:17902', '123456')).toThrow(
      'Paste the ws:// or wss:// URL printed by moxxy mobile.',
    );
    expect(() => resolveBridgePairingTarget('ws://127.0.0.1:8765/')).toThrow(
      'Missing mobile pairing token.',
    );
  });

  it('configures client-core through a closeable WS handle', () => {
    const api = { invoke: vi.fn(), subscribe: vi.fn() };
    const close = vi.fn();
    const makeWsApiHandle = vi.fn().mockReturnValue({ api, close });
    const configureTransport = vi.fn();
    const configurePlatform = vi.fn();

    const handle = openBridgePairingTransport('ws://127.0.0.1:8765/?t=secret', undefined, {
      configurePlatform,
      configureTransport,
      makeWsApiHandle,
    });

    expect(makeWsApiHandle).toHaveBeenCalledWith({
      url: 'ws://127.0.0.1:8765',
      token: 'secret',
      onStatus: expect.any(Function),
    });
    expect(configureTransport).toHaveBeenCalledWith(api);
    expect(configurePlatform).toHaveBeenCalledWith({});
    expect(handle.status()).toBe('connecting');
    makeWsApiHandle.mock.calls[0]?.[0].onStatus?.('open');
    expect(handle.status()).toBe('open');

    handle.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
