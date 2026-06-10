import { describe, expect, it } from 'vitest';
import { isTunnelCliAvailable, startTunnel, webhookTunnelProviders } from './tunnel.js';

describe('webhookTunnelProviders', () => {
  it('exposes cloudflared + ngrok as TunnelProviderDefs', () => {
    for (const kind of ['cloudflared', 'ngrok'] as const) {
      const p = webhookTunnelProviders[kind];
      expect(p.name).toBe(kind);
      expect(typeof p.open).toBe('function');
      expect(typeof p.isAvailable).toBe('function');
    }
  });
});

describe('isTunnelCliAvailable', () => {
  it('delegates to the provider gate and returns a boolean', async () => {
    // Neither CLI is installed in CI; the contract is a boolean either way.
    expect(typeof (await isTunnelCliAvailable('cloudflared'))).toBe('boolean');
    expect(typeof (await isTunnelCliAvailable('ngrok'))).toBe('boolean');
  });
});

describe('startTunnel', () => {
  it('rejects (rather than hanging) when the tunnel CLI is absent', async () => {
    // cloudflared/ngrok are not installed in the test env → spawn error / exit.
    await expect(
      startTunnel({ kind: 'cloudflared', port: 65535, host: '127.0.0.1', urlTimeoutMs: 1_000 }),
    ).rejects.toBeDefined();
  });
});
