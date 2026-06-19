import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';
import {
  classifyDeviceTokenResponse,
  requestDeviceAuthorization,
} from './device-flow-shared.js';

/** RFC 8628 §3.5 state machine — the throwing branches were previously
 *  untested, so a regression in the error-code mapping would ship silently. */
describe('classifyDeviceTokenResponse', () => {
  const ok = { ok: true, status: 200 };
  const bad = { ok: false, status: 400 };

  it('returns {done} with a parsed TokenSet on success', () => {
    const state = { intervalMs: 5000 };
    const outcome = classifyDeviceTokenResponse(
      ok,
      { access_token: 'at-1', refresh_token: 'rt-1', token_type: 'Bearer', expires_in: 3600 },
      state,
    );
    expect('done' in outcome).toBe(true);
    if ('done' in outcome) {
      expect(outcome.done.accessToken).toBe('at-1');
    }
  });

  it('authorization_pending → keep polling, interval unchanged', () => {
    const state = { intervalMs: 5000 };
    const outcome = classifyDeviceTokenResponse(bad, { error: 'authorization_pending' }, state);
    expect(outcome).toEqual({ pending: true });
    expect(state.intervalMs).toBe(5000);
  });

  it('slow_down → pending and bumps the interval by exactly 5000ms', () => {
    const state = { intervalMs: 5000 };
    const outcome = classifyDeviceTokenResponse(bad, { error: 'slow_down' }, state);
    expect(outcome).toEqual({ pending: true });
    expect(state.intervalMs).toBe(10000);
  });

  it('access_denied → throws OAUTH_FLOW_DENIED', () => {
    const state = { intervalMs: 5000 };
    try {
      classifyDeviceTokenResponse(bad, { error: 'access_denied' }, state);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MoxxyError);
      expect((err as MoxxyError).code).toBe('OAUTH_FLOW_DENIED');
    }
  });

  it('expired_token → throws OAUTH_FLOW_TIMEOUT', () => {
    const state = { intervalMs: 5000 };
    try {
      classifyDeviceTokenResponse(bad, { error: 'expired_token' }, state);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MoxxyError);
      expect((err as MoxxyError).code).toBe('OAUTH_FLOW_TIMEOUT');
    }
  });

  it('generic error → throws AUTH_INVALID with the provider_error in context', () => {
    const state = { intervalMs: 5000 };
    try {
      classifyDeviceTokenResponse(
        bad,
        { error: 'invalid_grant', error_description: 'bad code' },
        state,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MoxxyError);
      const e = err as MoxxyError;
      expect(e.code).toBe('AUTH_INVALID');
      expect(e.context?.provider_error).toBe('invalid_grant');
      expect(e.context?.description).toBe('bad code');
    }
  });

  it('non-ok with no error field → AUTH_INVALID keyed by the HTTP status', () => {
    const state = { intervalMs: 5000 };
    try {
      classifyDeviceTokenResponse({ ok: false, status: 503 }, {}, state);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MoxxyError);
      const e = err as MoxxyError;
      expect(e.code).toBe('AUTH_INVALID');
      expect(e.context?.provider_error).toBe('HTTP 503');
    }
  });
});

describe('requestDeviceAuthorization — malformed 2xx body', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const args = {
    deviceUrl: 'https://idp.example/device',
    clientId: 'cid',
    scopes: ['openid'],
  };

  it('maps a non-JSON 200 body to PROVIDER_UNKNOWN_RESPONSE (not a raw SyntaxError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
        text: async () => '<html>proxy error</html>',
      })),
    );
    let err: unknown;
    try {
      await requestDeviceAuthorization(args);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MoxxyError);
    expect((err as MoxxyError).code).toBe('PROVIDER_UNKNOWN_RESPONSE');
  });

  it('still rejects with PROVIDER_UNKNOWN_RESPONSE when required fields are absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ user_code: 'ABC' }), // missing device_code + verification_uri
        text: async () => '',
      })),
    );
    await expect(requestDeviceAuthorization(args)).rejects.toMatchObject({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
    });
  });
});
