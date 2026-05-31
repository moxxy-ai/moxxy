import { describe, it, expect } from 'vitest';
import { encodeIpcError, decodeIpcError } from './index.js';

describe('IPC error envelope', () => {
  it('round-trips code + message', () => {
    const enc = encodeIpcError({ code: 'not-connected', message: 'not connected to a runner' });
    expect(decodeIpcError(enc)).toEqual({
      code: 'not-connected',
      message: 'not connected to a runner',
    });
  });

  it('recovers the envelope from an Electron-prefixed message', () => {
    const enc = encodeIpcError({ code: 'invalid-payload', message: 'bad' });
    const wrapped = `Error invoking remote method 'desks.rename': Error: ${enc}`;
    expect(decodeIpcError(wrapped)).toEqual({ code: 'invalid-payload', message: 'bad' });
  });

  it('returns null for a non-envelope message', () => {
    expect(decodeIpcError('some unrelated error')).toBeNull();
    expect(decodeIpcError('')).toBeNull();
  });

  it('returns null for a marker followed by junk', () => {
    expect(decodeIpcError('MOXXY_IPC_ERR:not json')).toBeNull();
  });
});
