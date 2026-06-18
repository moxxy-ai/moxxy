import { afterEach, describe, expect, it, vi } from 'vitest';
import { openaiDeviceFlow } from './openai-device-flow.js';

const opts = {
  issuer: 'https://auth.example.com',
  tokenUrl: 'https://auth.example.com/oauth/token',
  verificationUri: 'https://auth.example.com/codex/device',
};

/** Stub a single init-endpoint response body. */
function stubInit(body: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ device_auth_id: 'd1', user_code: 'CODE-1', ...body }),
      text: async () => '',
    })),
  );
}

describe('openaiDeviceFlow.start — interval/expires_in coercion (u89-2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to defaults (never NaN) on malformed string values', async () => {
    stubInit({ interval: '', expires_in: 'oops' });
    const init = await openaiDeviceFlow(opts).start({ clientId: 'c1', scopes: [] });
    expect(init.intervalMs).toBe(5000);
    expect(init.expiresInMs).toBe(600000);
    expect(Number.isNaN(init.intervalMs)).toBe(false);
    expect(Number.isNaN(init.expiresInMs)).toBe(false);
  });

  it('parses valid numeric strings', async () => {
    stubInit({ interval: '7', expires_in: '900' });
    const init = await openaiDeviceFlow(opts).start({ clientId: 'c1', scopes: [] });
    expect(init.intervalMs).toBe(7000);
    expect(init.expiresInMs).toBe(900000);
  });

  it('accepts numeric values and clamps interval to >= 1s', async () => {
    stubInit({ interval: 0, expires_in: 1200 });
    const init = await openaiDeviceFlow(opts).start({ clientId: 'c1', scopes: [] });
    expect(init.intervalMs).toBe(1000); // Math.max(0,1) * 1000
    expect(init.expiresInMs).toBe(1200000);
  });

  it('uses defaults when the fields are absent', async () => {
    stubInit({});
    const init = await openaiDeviceFlow(opts).start({ clientId: 'c1', scopes: [] });
    expect(init.intervalMs).toBe(5000);
    expect(init.expiresInMs).toBe(600000);
  });
});
