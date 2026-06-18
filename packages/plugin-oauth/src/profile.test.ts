import { describe, expect, it, vi } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';
import {
  openaiDeviceFlow,
  pollUntil,
  readStoredCreds,
  rfc8628DeviceFlow,
  storeTokenSet,
  type OAuthVault,
  type PollOutcome,
  type TokenSet,
} from './index.js';

function newFakeVault(): OAuthVault & { dump(): Record<string, string> } {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      return store.delete(key);
    },
    dump() {
      return Object.fromEntries(store);
    },
  };
}

describe('pollUntil', () => {
  it('returns the first `done` value', async () => {
    let calls = 0;
    const result = await pollUntil<string>(
      async () => {
        calls += 1;
        if (calls < 3) return { pending: true };
        return { done: 'ok' };
      },
      { intervalMs: 1, timeoutMs: 1000, leadingWait: false },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('throws a typed OAUTH_FLOW_TIMEOUT MoxxyError when the deadline elapses', async () => {
    const err = await pollUntil<string>(
      async () => ({ pending: true }),
      { intervalMs: 1, timeoutMs: 5, leadingWait: false },
    ).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('OAUTH_FLOW_TIMEOUT');
    expect((err as MoxxyError).message).toMatch(/timed out/);
  });

  it('respects an in-flight abort signal (typed NETWORK_ABORTED MoxxyError)', async () => {
    const ctrl = new AbortController();
    const p = pollUntil<string>(
      async () => ({ pending: true }),
      { intervalMs: 100, timeoutMs: 1000, signal: ctrl.signal, leadingWait: false },
    );
    setTimeout(() => ctrl.abort(), 10);
    const err = await p.catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('NETWORK_ABORTED');
    expect((err as MoxxyError).message).toMatch(/aborted/);
  });

  it('throws a typed NETWORK_ABORTED MoxxyError when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await pollUntil<string>(
      async () => ({ pending: true }),
      { intervalMs: 1, timeoutMs: 1000, signal: ctrl.signal },
    ).catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('NETWORK_ABORTED');
  });

  it('lets the polling fn bump state.intervalMs', async () => {
    let bumpedOnce = false;
    const calls: number[] = [];
    await pollUntil<string>(
      async (state) => {
        calls.push(state.intervalMs);
        if (!bumpedOnce) {
          state.intervalMs += 50;
          bumpedOnce = true;
          return { pending: true };
        }
        return { done: 'x' };
      },
      { intervalMs: 1, timeoutMs: 1000, leadingWait: false },
    );
    expect(calls).toEqual([1, 51]);
  });
});

describe('storage extras round-trip', () => {
  it('persists + restores arbitrary string extras', async () => {
    const vault = newFakeVault();
    const tokens: TokenSet = {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: Date.now() + 60_000,
      tokenType: 'Bearer',
    };
    await storeTokenSet(vault, 'demo', tokens, {
      clientId: 'CID',
      tokenUrl: 'https://example.test/token',
      extras: { account_id: 'acct_123', team_slug: 'eng' },
    });
    const stored = await readStoredCreds(vault, 'demo');
    expect(stored).not.toBeNull();
    expect(stored!.extras).toEqual({ account_id: 'acct_123', team_slug: 'eng' });
    expect(stored!.tokenSet.accessToken).toBe('AT');
  });

  it('returns an empty extras map when none were stored', async () => {
    const vault = newFakeVault();
    await storeTokenSet(vault, 'demo', { accessToken: 'AT', tokenType: 'Bearer' }, {
      clientId: 'CID',
      tokenUrl: 'https://example.test/token',
    });
    const stored = await readStoredCreds(vault, 'demo');
    expect(stored!.extras).toEqual({});
  });
});

describe('rfc8628DeviceFlow adapter', () => {
  it('start() POSTs form-encoded client_id+scope and parses the init', async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL, init: RequestInit) => {
      expect(String(url)).toBe('https://example.test/device/code');
      expect(init.method).toBe('POST');
      const body = new URLSearchParams(String(init.body ?? ''));
      expect(body.get('client_id')).toBe('CID');
      expect(body.get('scope')).toBe('openid email');
      return new Response(
        JSON.stringify({
          device_code: 'DEV',
          user_code: 'AB-CD',
          verification_uri: 'https://example.test/device',
          interval: 3,
          expires_in: 600,
        }),
        { status: 200 },
      );
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const adapter = rfc8628DeviceFlow({
        deviceUrl: 'https://example.test/device/code',
        tokenUrl: 'https://example.test/token',
      });
      const init = await adapter.start({ clientId: 'CID', scopes: ['openid', 'email'] });
      expect(init.userCode).toBe('AB-CD');
      expect(init.verificationUri).toBe('https://example.test/device');
      expect(init.intervalMs).toBe(3000);
      expect(init.expiresInMs).toBe(600_000);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('poll() classifies authorization_pending / slow_down / done', async () => {
    const adapter = rfc8628DeviceFlow({
      deviceUrl: 'https://example.test/device/code',
      tokenUrl: 'https://example.test/token',
    });
    const init = {
      userCode: 'X',
      verificationUri: 'https://example.test/device',
      intervalMs: 5000,
      expiresInMs: 60_000,
      providerData: { deviceCode: 'DEV' },
    };

    const realFetch = globalThis.fetch;
    const responses: Array<() => Response> = [
      () =>
        new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 }),
      () => new Response(JSON.stringify({ error: 'slow_down' }), { status: 400 }),
      () =>
        new Response(
          JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
          { status: 200 },
        ),
    ];
    globalThis.fetch = (async () => responses.shift()!()) as unknown as typeof fetch;
    try {
      const state = { intervalMs: 5000 };
      const r1 = await adapter.poll(init, state);
      expect('pending' in r1 && r1.pending).toBe(true);
      const r2 = await adapter.poll(init, state);
      expect('pending' in r2 && r2.pending).toBe(true);
      expect(state.intervalMs).toBe(10_000);
      const r3 = (await adapter.poll(init, state)) as Extract<
        PollOutcome<TokenSet>,
        { done: TokenSet }
      >;
      expect(r3.done.accessToken).toBe('AT');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('openaiDeviceFlow adapter', () => {
  it('start() POSTs JSON client_id and stashes device_auth_id', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit) => {
      expect(String(url)).toBe('https://issuer.test/api/accounts/deviceauth/usercode');
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
      const parsed = JSON.parse(String(init.body ?? '{}'));
      expect(parsed.client_id).toBe('CID');
      return new Response(
        JSON.stringify({ device_auth_id: 'DA', user_code: 'XYZ', interval: 4 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    try {
      const adapter = openaiDeviceFlow({
        issuer: 'https://issuer.test',
        tokenUrl: 'https://issuer.test/oauth/token',
        verificationUri: 'https://issuer.test/codex/device',
      });
      const init = await adapter.start({ clientId: 'CID', scopes: ['openid'] });
      expect(init.userCode).toBe('XYZ');
      expect(init.verificationUri).toBe('https://issuer.test/codex/device');
      expect(init.intervalMs).toBe(4000);
      expect((init.providerData as { deviceAuthId: string }).deviceAuthId).toBe('DA');
      expect((init.providerData as { clientId: string }).clientId).toBe('CID');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('poll() returns pending on 403/404 and exchanges authorization_code on success', async () => {
    const adapter = openaiDeviceFlow({
      issuer: 'https://issuer.test',
      tokenUrl: 'https://issuer.test/oauth/token',
      verificationUri: 'https://issuer.test/codex/device',
    });
    const init = {
      userCode: 'XYZ',
      verificationUri: 'https://issuer.test/codex/device',
      intervalMs: 4000,
      expiresInMs: 600_000,
      providerData: { deviceAuthId: 'DA', userCode: 'XYZ', clientId: 'CID' },
    };

    const realFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        expect(String(url)).toBe('https://issuer.test/api/accounts/deviceauth/token');
        return new Response('', { status: 403 });
      }
      if (call === 2) {
        return new Response(
          JSON.stringify({ authorization_code: 'CODE', code_verifier: 'V' }),
          { status: 200 },
        );
      }
      // Third call: exchange via /oauth/token
      expect(String(url)).toBe('https://issuer.test/oauth/token');
      const body = new URLSearchParams(String(init?.body ?? ''));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('CODE');
      expect(body.get('code_verifier')).toBe('V');
      expect(body.get('client_id')).toBe('CID');
      expect(body.get('redirect_uri')).toBe('https://issuer.test/deviceauth/callback');
      return new Response(
        JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    try {
      const state = { intervalMs: 4000 };
      const pending = await adapter.poll(init, state);
      expect('pending' in pending && pending.pending).toBe(true);
      const done = (await adapter.poll(init, state)) as Extract<
        PollOutcome<TokenSet>,
        { done: TokenSet }
      >;
      expect(done.done.accessToken).toBe('AT');
      expect(done.done.refreshToken).toBe('RT');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('poll() surfaces a classified MoxxyError when the shared exchange returns non-ok', async () => {
    const adapter = openaiDeviceFlow({
      issuer: 'https://issuer.test',
      tokenUrl: 'https://issuer.test/oauth/token',
      verificationUri: 'https://issuer.test/codex/device',
    });
    const init = {
      userCode: 'XYZ',
      verificationUri: 'https://issuer.test/codex/device',
      intervalMs: 4000,
      expiresInMs: 600_000,
      providerData: { deviceAuthId: 'DA', userCode: 'XYZ', clientId: 'CID' },
    };

    const realFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      // 1st: poll returns the authorization_code; 2nd: the exchange rejects.
      if (call === 1) {
        return new Response(
          JSON.stringify({ authorization_code: 'CODE', code_verifier: 'V' }),
          { status: 200 },
        );
      }
      return new Response('bad request', { status: 400 });
    }) as unknown as typeof fetch;
    try {
      const state = { intervalMs: 4000 };
      const err = await adapter.poll(init, state).catch((e) => e);
      expect(MoxxyError.isMoxxyError(err)).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
