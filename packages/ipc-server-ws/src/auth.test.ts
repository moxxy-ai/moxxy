import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { checkWsAuth } from './auth.js';

function req(headers: Record<string, string>, url = '/'): IncomingMessage {
  return { headers, url } as unknown as IncomingMessage;
}

describe('checkWsAuth', () => {
  const token = 'secret-token-abc';

  it('accepts a matching Bearer header', () => {
    expect(checkWsAuth(req({ authorization: `Bearer ${token}` }), token)).toBe(true);
  });

  it('accepts a matching ?t= query param (header-less clients)', () => {
    expect(checkWsAuth(req({}, `/?t=${token}`), token)).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(checkWsAuth(req({ authorization: 'Bearer wrong' }), token)).toBe(false);
  });

  it('rejects when no credentials are presented', () => {
    expect(checkWsAuth(req({}), token)).toBe(false);
  });

  it('never authenticates when the expected token is empty', () => {
    expect(checkWsAuth(req({ authorization: 'Bearer ' }), '')).toBe(false);
    expect(checkWsAuth(req({}, '/?t=anything'), '')).toBe(false);
  });
});
