import { describe, expect, it } from 'vitest';
import { disconnectStatusCode, WA_DISCONNECT } from './socket.js';

describe('disconnectStatusCode', () => {
  it('extracts a Boom-style statusCode', () => {
    expect(disconnectStatusCode({ output: { statusCode: WA_DISCONNECT.loggedOut } })).toBe(401);
    expect(disconnectStatusCode({ output: { statusCode: 515 } })).toBe(515);
  });

  it('returns null when no code is present', () => {
    expect(disconnectStatusCode(undefined)).toBeNull();
    expect(disconnectStatusCode(null)).toBeNull();
    expect(disconnectStatusCode(new Error('boom'))).toBeNull();
    expect(disconnectStatusCode({ output: {} })).toBeNull();
    expect(disconnectStatusCode({ output: { statusCode: 'nope' } })).toBeNull();
  });
});
