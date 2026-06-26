import { describe, expect, it } from 'vitest';
import {
  beginHostIssuedPairing,
  createPairingState,
  handleStart,
  isAuthorized,
  submitChatCode,
} from './pairing.js';

describe('pairing protocol (host-issued QR code)', () => {
  it('starts in idle phase', () => {
    const s = createPairingState();
    expect(s.phase).toBe('idle');
    expect(s.authorizedChatId).toBeNull();
  });

  it('starts in paired phase when an authorized chat is restored', () => {
    const s = createPairingState({ authorizedChatId: 42 });
    expect(s.phase).toBe('paired');
    expect(isAuthorized(s, 42)).toBe(true);
    expect(isAuthorized(s, 99)).toBe(false);
  });

  it('beginHostIssuedPairing mints a 6-digit code up front and opens the window', () => {
    const { state, code } = beginHostIssuedPairing(createPairingState());
    expect(state.phase).toBe('awaiting-host-code');
    expect(code).toMatch(/^\d{6}$/);
    expect(state.code).toBe(code);
    // No TTL by default — the window lives as long as the channel runs unpaired.
    expect(state.expiresAt).toBeNull();
  });

  it('submitChatCode pairs the presenting chat on the correct code', () => {
    const { state, code } = beginHostIssuedPairing(createPairingState());
    const r = submitChatCode(state, 1, code);
    expect(r.action.kind).toBe('paired');
    expect(r.state.phase).toBe('paired');
    expect(r.state.authorizedChatId).toBe(1);
    expect(isAuthorized(r.state, 1)).toBe(true);
  });

  it('submitChatCode accepts the code with surrounding whitespace', () => {
    const { state, code } = beginHostIssuedPairing(createPairingState());
    const r = submitChatCode(state, 7, `  ${code} `);
    expect(r.action.kind).toBe('paired');
    expect(r.state.authorizedChatId).toBe(7);
  });

  it('submitChatCode reports a mismatch on a wrong code', () => {
    const { state, code } = beginHostIssuedPairing(createPairingState());
    const wrong = code === '000000' ? '111111' : '000000';
    const r = submitChatCode(state, 1, wrong);
    expect(r.action.kind).toBe('mismatch');
    if (r.action.kind !== 'mismatch') return;
    expect(r.action.message).toMatch(/didn't match/);
  });

  it('submitChatCode treats non-digit input as a mismatch', () => {
    const { state } = beginHostIssuedPairing(createPairingState());
    const r = submitChatCode(state, 1, 'hello!');
    expect(r.action.kind).toBe('mismatch');
  });

  it('submitChatCode reports not-pending when no window is open', () => {
    const r = submitChatCode(createPairingState(), 1, '123456');
    expect(r.action.kind).toBe('not-pending');
  });

  it('submitChatCode acknowledges the already-paired chat (idempotent)', () => {
    const r = submitChatCode(createPairingState({ authorizedChatId: 5 }), 5, '123456');
    expect(r.action.kind).toBe('still-paired');
  });

  it('submitChatCode rejects a different chat once one is paired', () => {
    const r = submitChatCode(createPairingState({ authorizedChatId: 5 }), 6, '123456');
    expect(r.action.kind).toBe('reject');
  });

  it('expires after the (optional) TTL window', () => {
    const t0 = 1_000_000;
    const { state, code } = beginHostIssuedPairing(createPairingState(), undefined, t0, 1000);
    const r = submitChatCode(state, 1, code, t0 + 2000);
    expect(r.action.kind).toBe('expired');
    expect(r.state.phase).toBe('expired');
  });
});

describe('handleStart (bare /start, no code payload)', () => {
  it('rejects with a "start pairing" nudge when no window is open', () => {
    const r = handleStart(createPairingState(), 1);
    expect(r.action.kind).toBe('reject');
    if (r.action.kind !== 'reject') return;
    expect(r.action.message).toMatch(/No pairing window/);
  });

  it('nudges to use the QR / send the code while a host window is open', () => {
    const { state } = beginHostIssuedPairing(createPairingState());
    const r = handleStart(state, 1);
    expect(r.action.kind).toBe('reject');
    if (r.action.kind !== 'reject') return;
    expect(r.action.message).toMatch(/QR|code/i);
  });

  it('acknowledges the already-paired chat', () => {
    const r = handleStart(createPairingState({ authorizedChatId: 7 }), 7);
    expect(r.action.kind).toBe('still-paired');
  });

  it('rejects a different chat when one is paired', () => {
    const r = handleStart(createPairingState({ authorizedChatId: 7 }), 999);
    expect(r.action.kind).toBe('reject');
  });
});
