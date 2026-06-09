import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { encodeWsBearerProtocol, MOXXY_WS_SUBPROTOCOL } from '@moxxy/sdk';
import { checkWsAuth, checkWsOrigin } from './auth.js';

function req(headers: Record<string, string>, url = '/'): IncomingMessage {
  return { headers, url } as unknown as IncomingMessage;
}

describe('checkWsAuth', () => {
  const token = 'secret-token-abc';

  it('accepts a matching Bearer header', () => {
    expect(checkWsAuth(req({ authorization: `Bearer ${token}` }), token)).toBe(true);
  });

  it('accepts the token via the Sec-WebSocket-Protocol bearer entry', () => {
    const header = `${MOXXY_WS_SUBPROTOCOL}, ${encodeWsBearerProtocol(token)}`;
    expect(checkWsAuth(req({ 'sec-websocket-protocol': header }), token)).toBe(true);
  });

  it('round-trips a token with reserved characters through the protocol entry', () => {
    const weird = "a+b/c=d !'()*&%";
    const header = encodeWsBearerProtocol(weird);
    // Every char of the entry must be a valid HTTP token char (no separators).
    expect(header).toMatch(/^[A-Za-z0-9._~%-]+$/);
    expect(checkWsAuth(req({ 'sec-websocket-protocol': header }), weird)).toBe(true);
  });

  it('rejects a ?t= query param by default (legacy transport is opt-in)', () => {
    expect(checkWsAuth(req({}, `/?t=${token}`), token)).toBe(false);
  });

  it('accepts a matching ?t= query param when explicitly enabled', () => {
    expect(checkWsAuth(req({}, `/?t=${token}`), token, { allowQueryToken: true })).toBe(true);
  });

  it('rejects a wrong token on every presentation', () => {
    expect(checkWsAuth(req({ authorization: 'Bearer wrong' }), token)).toBe(false);
    expect(
      checkWsAuth(req({ 'sec-websocket-protocol': encodeWsBearerProtocol('wrong') }), token),
    ).toBe(false);
    expect(checkWsAuth(req({}, '/?t=wrong'), token, { allowQueryToken: true })).toBe(false);
  });

  it('rejects when no credentials are presented', () => {
    expect(checkWsAuth(req({}), token)).toBe(false);
  });

  it('never authenticates when the expected token is empty', () => {
    expect(checkWsAuth(req({ authorization: 'Bearer ' }), '')).toBe(false);
    expect(checkWsAuth(req({}, '/?t=anything'), '', { allowQueryToken: true })).toBe(false);
  });
});

describe('checkWsOrigin', () => {
  it('passes requests without an Origin header (native clients)', () => {
    expect(checkWsOrigin(req({}))).toBe(true);
    expect(checkWsOrigin(req({}), ['http://app.example'])).toBe(true);
  });

  it('rejects any Origin by default (browser pages cannot omit it)', () => {
    expect(checkWsOrigin(req({ origin: 'http://evil.example' }))).toBe(false);
    expect(checkWsOrigin(req({ origin: 'http://localhost:5173' }))).toBe(false);
  });

  it('accepts an allow-listed Origin (case-insensitive), rejects others', () => {
    const allowed = ['http://localhost:5173'];
    expect(checkWsOrigin(req({ origin: 'http://localhost:5173' }), allowed)).toBe(true);
    expect(checkWsOrigin(req({ origin: 'HTTP://LOCALHOST:5173' }), allowed)).toBe(true);
    expect(checkWsOrigin(req({ origin: 'http://evil.example' }), allowed)).toBe(false);
  });
});
