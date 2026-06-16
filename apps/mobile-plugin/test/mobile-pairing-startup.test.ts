import { describe, expect, it } from 'vitest';
import { planPairingStartup } from '../mobile/src/pairingStartup';

describe('mobile pairing startup', () => {
  it('starts disconnected and clears a previously stored pairing target', () => {
    expect(planPairingStartup({
      storedToken: 'old-token',
      storedUrl: 'wss://old-tunnel.ngrok-free.app',
      expoHostUri: '192.168.1.44:8081',
    })).toEqual({
      gatewayUrl: 'ws://192.168.1.44:8765',
      clearStoredToken: true,
      clearStoredUrl: true,
      restoreTransport: false,
    });
  });

  it('does not keep a tokenless stored gateway URL as the next manual pairing value', () => {
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
});
