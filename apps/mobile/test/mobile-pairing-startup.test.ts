import { describe, expect, it } from 'vitest';
import { planPairingStartup } from '../src/pairingStartup';

describe('mobile pairing startup', () => {
  it('remembers a fully-stored gateway and restores its transport', () => {
    expect(planPairingStartup({
      storedToken: 'old-token',
      storedUrl: 'wss://relay.moxxy.ai/abc',
      expoHostUri: '192.168.1.44:8081',
    })).toEqual({
      gatewayUrl: 'wss://relay.moxxy.ai/abc',
      clearStoredToken: false,
      clearStoredUrl: false,
      restoreTransport: true,
    });
  });

  it('drops a tokenless stored gateway URL (incomplete, cannot reconnect)', () => {
    expect(planPairingStartup({
      storedToken: null,
      storedUrl: 'ws://127.0.0.1:8765',
      expoHostUri: null,
    })).toEqual({
      gatewayUrl: 'ws://127.0.0.1:8765',
      clearStoredToken: false,
      clearStoredUrl: true,
      restoreTransport: false,
    });
  });

  it('falls back to the LAN default when nothing is stored', () => {
    expect(planPairingStartup({
      storedToken: null,
      storedUrl: null,
      expoHostUri: '192.168.1.44:8081',
    })).toEqual({
      gatewayUrl: 'ws://192.168.1.44:8765',
      clearStoredToken: false,
      clearStoredUrl: false,
      restoreTransport: false,
    });
  });
});
