import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';
import { runDeviceCodeFlow } from './device-flow.js';
import type { DeviceFlowOptions } from './types.js';

function jsonResponse(obj: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  } as unknown as Response;
}

function nonJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
    text: async () => '<html>captive portal</html>',
  } as unknown as Response;
}

const baseOpts: Omit<DeviceFlowOptions, 'onPrompt'> = {
  deviceUrl: 'https://idp.example/device',
  tokenUrl: 'https://idp.example/token',
  clientId: 'client-1',
  scopes: ['openid'],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('runDeviceCodeFlow — happy path applies the poll safety margin', () => {
  it('polls only AFTER interval + DEVICE_POLL_SAFETY_MARGIN_MS (no edge-poll racing the rate limiter)', async () => {
    vi.useFakeTimers();
    const deviceAuth = {
      device_code: 'dc-1',
      user_code: 'WXYZ',
      verification_uri: 'https://idp.example/verify',
      expires_in: 600,
      interval: 5,
    };
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u === baseOpts.deviceUrl) {
          calls.push('device');
          return jsonResponse(deviceAuth);
        }
        calls.push('poll');
        return jsonResponse({ access_token: 'at-1', token_type: 'Bearer', expires_in: 3600 });
      }),
    );

    let prompted = false;
    const p = runDeviceCodeFlow({ ...baseOpts, onPrompt: () => (prompted = true) });
    // Let the device-auth request resolve.
    await vi.advanceTimersByTimeAsync(0);
    expect(prompted).toBe(true);
    expect(calls).toEqual(['device']);

    // At interval (5s) exactly, the poll must NOT have fired — the +3s margin
    // delays the first poll to 8s.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toEqual(['device']);
    await vi.advanceTimersByTimeAsync(3_000);
    // Now the first poll fires.
    const tokens = await p;
    expect(calls).toEqual(['device', 'poll']);
    expect(tokens.accessToken).toBe('at-1');
  });
});

describe('runDeviceCodeFlow — hostile / malformed input degrades, never crashes', () => {
  it('rejects a non-JSON 200 device-authorization body with a typed MoxxyError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => nonJsonResponse(200)));
    await expect(
      runDeviceCodeFlow({ ...baseOpts, onPrompt: () => {} }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN_RESPONSE' });
  });

  it('rejects a 200 device-authorization body missing required fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ user_code: 'X' /* no device_code */ })));
    const err = await runDeviceCodeFlow({ ...baseOpts, onPrompt: () => {} }).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('PROVIDER_UNKNOWN_RESPONSE');
  });

  it('surfaces a non-ok device-authorization HTTP error as a MoxxyError (no raw throw)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'invalid_client' }, 400)));
    const err = await runDeviceCodeFlow({ ...baseOpts, onPrompt: () => {} }).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
  });
});
