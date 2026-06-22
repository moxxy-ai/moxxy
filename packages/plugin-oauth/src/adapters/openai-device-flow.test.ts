import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';
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

describe('openaiDeviceFlow.start — malformed response rejection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Stub an init response whose JSON body is exactly `body` (no auto-fields). */
  function stubRawInit(body: Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => body, text: async () => '' })),
    );
  }

  it('rejects with PROVIDER_UNKNOWN_RESPONSE when device_auth_id is missing', async () => {
    stubRawInit({ user_code: 'CODE-1' });
    let err: unknown;
    try {
      await openaiDeviceFlow(opts).start({ clientId: 'c1', scopes: [] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MoxxyError);
    expect((err as MoxxyError).code).toBe('PROVIDER_UNKNOWN_RESPONSE');
  });

  it('rejects with PROVIDER_UNKNOWN_RESPONSE when user_code is missing', async () => {
    stubRawInit({ device_auth_id: 'd1' });
    await expect(openaiDeviceFlow(opts).start({ clientId: 'c1', scopes: [] })).rejects.toMatchObject({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
    });
  });

  it('rejects with PROVIDER_UNKNOWN_RESPONSE on a non-JSON 200 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('not json');
        },
        text: async () => '<html/>',
      })),
    );
    await expect(openaiDeviceFlow(opts).start({ clientId: 'c1', scopes: [] })).rejects.toMatchObject({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
    });
  });
});

describe('openaiDeviceFlow.poll — malformed success response rejection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const init = {
    userCode: 'CODE-1',
    verificationUri: opts.verificationUri,
    intervalMs: 5000,
    expiresInMs: 600000,
    providerData: { deviceAuthId: 'd1', userCode: 'CODE-1', clientId: 'c1' },
  };

  it('rejects when a 200 success body omits authorization_code/code_verifier (never exchanges undefined)', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}), // missing both fields
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchSpy);
    let err: unknown;
    try {
      await openaiDeviceFlow(opts).poll(init, { intervalMs: 5000 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MoxxyError);
    expect((err as MoxxyError).code).toBe('PROVIDER_UNKNOWN_RESPONSE');
    // It must NOT have proceeded to a second fetch (the token exchange).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects with PROVIDER_UNKNOWN_RESPONSE on a non-JSON 200 poll body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('not json');
        },
        text: async () => 'oops',
      })),
    );
    await expect(openaiDeviceFlow(opts).poll(init, { intervalMs: 5000 })).rejects.toMatchObject({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
    });
  });
});

describe('openaiDeviceFlow.poll — abort-responsive fetch (u89-3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('threads PollState.signal into the in-flight poll fetch', async () => {
    const seen: Array<AbortSignal | undefined> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, reqInit?: RequestInit) => {
        seen.push(reqInit?.signal ?? undefined);
        // 403 = OpenAI's "still pending" signal — keeps poll() from exchanging.
        return { ok: false, status: 403, json: async () => ({}), text: async () => '' };
      }),
    );
    const controller = new AbortController();
    const init = {
      userCode: 'CODE-1',
      verificationUri: opts.verificationUri,
      intervalMs: 5000,
      expiresInMs: 600000,
      providerData: { deviceAuthId: 'd1', userCode: 'CODE-1', clientId: 'c1' },
    };
    const outcome = await openaiDeviceFlow(opts).poll(init, {
      intervalMs: 5000,
      signal: controller.signal,
    });
    expect(outcome).toEqual({ pending: true });
    expect(seen[0]).toBe(controller.signal);
  });
});
