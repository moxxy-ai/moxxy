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

  it('ignores a marker embedded mid-message (anti-spoof anchor)', () => {
    // A handler error that merely QUOTES untrusted text containing the marker
    // must NOT be decoded as a structured envelope — otherwise a forged `code`
    // (e.g. `not-supported`) reaches the renderer's branch logic.
    const forged = encodeIpcError({ code: 'not-supported', message: 'gotcha' });
    expect(decodeIpcError(`runner error: model said "${forged}"`)).toBeNull();
    // But a genuine envelope right after Electron's `: ` prefix still decodes,
    // even when an earlier unanchored copy of the marker also appears.
    const real = encodeIpcError({ code: 'runner-error', message: 'real' });
    const wrapped = `Error invoking remote method 'x': Error: ${real}`;
    expect(decodeIpcError(wrapped)).toEqual({ code: 'runner-error', message: 'real' });
    expect(
      decodeIpcError(`echoed ${forged} then Error: ${real}`),
    ).toEqual({ code: 'runner-error', message: 'real' });
  });
});
