import { describe, expect, it } from 'vitest';
import {
  clearHostCodePairing,
  createHostCodeState,
  greetPeer,
  isPeerAuthorized,
  openHostCodeWindow,
  submitPeerCode,
} from './host-code.js';

describe('host-code pairing machine', () => {
  it('starts idle', () => {
    const s = createHostCodeState<number>();
    expect(s.phase).toBe('idle');
    expect(s.authorizedPeer).toBeNull();
  });

  it('starts paired when an authorized peer is restored', () => {
    const s = createHostCodeState({ authorizedPeer: 42 });
    expect(s.phase).toBe('paired');
    expect(isPeerAuthorized(s, 42)).toBe(true);
    expect(isPeerAuthorized(s, 99)).toBe(false);
  });

  it('openHostCodeWindow arms the window with the caller-minted code', () => {
    const { state, code } = openHostCodeWindow(createHostCodeState<number>(), { code: '123456' });
    expect(state.phase).toBe('awaiting-host-code');
    expect(code).toBe('123456');
    expect(state.code).toBe('123456');
    // No TTL by default — the window lives as long as the channel runs unpaired.
    expect(state.expiresAt).toBeNull();
  });

  it('submitPeerCode pairs the presenting peer on the correct code', () => {
    const { state } = openHostCodeWindow(createHostCodeState<number>(), { code: '123456' });
    const r = submitPeerCode(state, 1, '123456');
    expect(r.action.kind).toBe('paired');
    expect(r.state.phase).toBe('paired');
    expect(r.state.authorizedPeer).toBe(1);
    expect(isPeerAuthorized(r.state, 1)).toBe(true);
  });

  it('accepts the code with surrounding whitespace', () => {
    const { state } = openHostCodeWindow(createHostCodeState<number>(), { code: '123456' });
    const r = submitPeerCode(state, 7, '  123 456 ');
    expect(r.action.kind).toBe('paired');
    expect(r.state.authorizedPeer).toBe(7);
  });

  it('reports a mismatch on a wrong or non-code message', () => {
    const { state } = openHostCodeWindow(createHostCodeState<number>(), { code: '123456' });
    expect(submitPeerCode(state, 1, '654321').action.kind).toBe('mismatch');
    expect(submitPeerCode(state, 1, 'hello!').action.kind).toBe('mismatch');
    expect(submitPeerCode(state, 1, '').action.kind).toBe('mismatch');
  });

  it('reports not-pending when no window is open', () => {
    const r = submitPeerCode(createHostCodeState<number>(), 1, '123456');
    expect(r.action.kind).toBe('not-pending');
  });

  it('acknowledges the already-paired peer (idempotent)', () => {
    const r = submitPeerCode(createHostCodeState({ authorizedPeer: 5 }), 5, '123456');
    expect(r.action.kind).toBe('still-paired');
  });

  it('rejects a different peer once one is paired', () => {
    const r = submitPeerCode(createHostCodeState({ authorizedPeer: 5 }), 6, '123456');
    expect(r.action.kind).toBe('rejected-foreign-peer');
  });

  it('expires after the optional TTL window', () => {
    const t0 = 1_000_000;
    const { state } = openHostCodeWindow(createHostCodeState<number>(), {
      code: '123456',
      now: t0,
      ttlMs: 1000,
    });
    const r = submitPeerCode(state, 1, '123456', t0 + 2000);
    expect(r.action.kind).toBe('expired');
    expect(r.state.phase).toBe('expired');
  });

  it('works with string peers (thread / JID style ids)', () => {
    const { state } = openHostCodeWindow(createHostCodeState<string>(), { code: '987654' });
    const r = submitPeerCode(state, 'chat:abc', '987654');
    expect(r.action.kind).toBe('paired');
    expect(isPeerAuthorized(r.state, 'chat:abc')).toBe(true);
    expect(isPeerAuthorized(r.state, 'chat:zzz')).toBe(false);
  });

  it('clearHostCodePairing forgets everything', () => {
    const s = clearHostCodePairing(createHostCodeState({ authorizedPeer: 5 }));
    expect(s.phase).toBe('idle');
    expect(s.authorizedPeer).toBeNull();
    expect(s.code).toBeNull();
  });
});

describe('greetPeer (bare hello, no code presented)', () => {
  it('nudges toward starting pairing when no window is open', () => {
    expect(greetPeer(createHostCodeState<number>(), 1).action.kind).toBe('no-window');
  });

  it('nudges toward the QR / code while a window is open', () => {
    const { state } = openHostCodeWindow(createHostCodeState<number>(), { code: '123456' });
    expect(greetPeer(state, 1).action.kind).toBe('window-open-hint');
  });

  it('acknowledges the already-paired peer', () => {
    expect(greetPeer(createHostCodeState({ authorizedPeer: 7 }), 7).action.kind).toBe(
      'still-paired',
    );
  });

  it('rejects a different peer when one is paired', () => {
    expect(greetPeer(createHostCodeState({ authorizedPeer: 7 }), 999).action.kind).toBe(
      'rejected-foreign-peer',
    );
  });
});
