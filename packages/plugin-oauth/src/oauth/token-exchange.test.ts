import { MoxxyError } from '@moxxy/sdk';
import { describe, expect, it, vi } from 'vitest';
import { parseTokenResponse, refreshAccessToken } from './token-exchange.js';

describe('parseTokenResponse', () => {
  it('throws PROVIDER_UNKNOWN_RESPONSE when access_token is missing', () => {
    let err: unknown;
    try {
      parseTokenResponse({ token_type: 'Bearer' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MoxxyError);
    expect((err as MoxxyError).code).toBe('PROVIDER_UNKNOWN_RESPONSE');
  });

  it('throws when access_token is present but not a string', () => {
    expect(() => parseTokenResponse({ access_token: 12345 })).toThrow(MoxxyError);
  });

  it('maps every field of a full response', () => {
    const before = Date.now();
    const set = parseTokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'a b',
      token_type: 'MAC',
      id_token: 'idt',
    });
    expect(set.accessToken).toBe('at');
    expect(set.refreshToken).toBe('rt');
    expect(set.scope).toBe('a b');
    expect(set.tokenType).toBe('MAC');
    expect(set.idToken).toBe('idt');
    // expiresAt = now + expires_in*1000 (allow for the small wall-clock delta).
    expect(set.expiresAt!).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(set.expiresAt!).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
  });

  it('omits expiresAt when expires_in is absent', () => {
    const set = parseTokenResponse({ access_token: 'at' });
    expect('expiresAt' in set).toBe(false);
  });

  it('omits refreshToken/scope/idToken when absent', () => {
    const set = parseTokenResponse({ access_token: 'at', expires_in: 10 });
    expect('refreshToken' in set).toBe(false);
    expect('scope' in set).toBe(false);
    expect('idToken' in set).toBe(false);
  });

  it("defaults token_type to 'Bearer' when absent or non-string", () => {
    expect(parseTokenResponse({ access_token: 'at' }).tokenType).toBe('Bearer');
    expect(parseTokenResponse({ access_token: 'at', token_type: 7 }).tokenType).toBe('Bearer');
  });
});

describe('refreshAccessToken', () => {
  const baseInput = {
    tokenUrl: 'https://idp.example/token',
    clientId: 'cid',
    refreshToken: 'old-rt',
  };

  function fakeFetch(status: number, body: unknown): typeof fetch {
    return (async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      })) as unknown as typeof fetch;
  }

  it('preserves no refresh_token in the result when the provider omits one', async () => {
    // RFC 6749 §6: a refresh response MAY omit refresh_token. The caller is
    // documented to preserve the prior token, so the returned set must NOT
    // carry a refreshToken key in that case.
    const set = await refreshAccessToken(
      baseInput,
      fakeFetch(200, { access_token: 'new-at', expires_in: 3600 }),
    );
    expect(set.accessToken).toBe('new-at');
    expect('refreshToken' in set).toBe(false);
  });

  it('returns the rotated refresh_token when the provider supplies one', async () => {
    const set = await refreshAccessToken(
      baseInput,
      fakeFetch(200, { access_token: 'new-at', refresh_token: 'rotated' }),
    );
    expect(set.refreshToken).toBe('rotated');
  });

  it('throws a MoxxyError on a non-ok status', async () => {
    await expect(
      refreshAccessToken(baseInput, fakeFetch(400, { error: 'invalid_grant' })),
    ).rejects.toBeInstanceOf(MoxxyError);
  });

  it('sends grant_type=refresh_token with the refresh token in the body', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'x' }),
      text: async () => '',
    }));
    await refreshAccessToken(baseInput, spy as unknown as typeof fetch);
    const body = (spy.mock.calls[0]![1] as RequestInit).body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=old-rt');
    expect(body).toContain('client_id=cid');
  });
});
