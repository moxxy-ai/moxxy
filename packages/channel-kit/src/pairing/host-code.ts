/**
 * Host-issued-code pairing — the pure state machine behind Telegram's QR /
 * deep-link chat pairing, generic over the peer identifier (a Telegram chat id,
 * a Discord DM channel, a WhatsApp JID, ...).
 *
 * A control surface (desktop Channels panel, `moxxy channels <name> pair` in a
 * terminal) opens a window with {@link openHostCodeWindow}: the code is minted
 * UP FRONT by the caller so the surface can embed it in a deep link and render
 * that as a QR. The user scans / opens the link (the messenger round-trips the
 * code back to the bot) or simply sends the code as a message; the channel
 * calls {@link submitPeerCode}, and on match that peer is authorized.
 *
 * Security property: "prove you can see the host's screen" — the code only ever
 * lives on the surface. No TTL by default: the window's lifetime is the channel
 * process's lifetime while unpaired; a caller may still bound it with `ttlMs`.
 *
 * Decisions carry semantic `kind`s only — user-facing messages (and their
 * channel-specific wording, e.g. "run `moxxy channels telegram pair`") are
 * mapped by each channel.
 */

export type HostCodePhase =
  | 'idle'
  // Host generated a code and is waiting for a peer to present it.
  | 'awaiting-host-code'
  | 'paired'
  | 'expired';

export interface HostCodeState<P> {
  readonly phase: HostCodePhase;
  readonly code: string | null;
  readonly expiresAt: number | null;
  readonly authorizedPeer: P | null;
}

export type HostCodeAction<P> =
  /** The presented code matched — the peer is now authorized. */
  | { readonly kind: 'paired'; readonly peer: P }
  /** The already-authorized peer showed up again (idempotent; greet it). */
  | { readonly kind: 'still-paired'; readonly peer: P }
  /** A DIFFERENT peer while one is authorized — access denied. */
  | { readonly kind: 'rejected-foreign-peer' }
  /** Bare hello while a window is open — nudge toward the QR / code. */
  | { readonly kind: 'window-open-hint' }
  /** Bare hello with no window open — nudge toward starting pairing. */
  | { readonly kind: 'no-window' }
  /** A code was presented but no window is open. */
  | { readonly kind: 'not-pending' }
  /** The window's optional TTL elapsed. */
  | { readonly kind: 'expired' }
  /** The presented code didn't match. */
  | { readonly kind: 'mismatch' };

export interface HostCodeDecision<P> {
  readonly state: HostCodeState<P>;
  readonly action: HostCodeAction<P>;
}

export function createHostCodeState<P>(
  opts: { authorizedPeer?: P | null } = {},
): HostCodeState<P> {
  return {
    phase: opts.authorizedPeer != null ? 'paired' : 'idle',
    code: null,
    expiresAt: null,
    authorizedPeer: opts.authorizedPeer ?? null,
  };
}

/**
 * Open a host-issued pairing window with a pre-minted code (the caller mints it
 * so it can embed the code in the deep link / QR it shows the user).
 */
export function openHostCodeWindow<P>(
  state: HostCodeState<P>,
  opts: { code: string; now?: number; ttlMs?: number | null },
): { state: HostCodeState<P>; code: string } {
  const ttlMs = opts.ttlMs ?? null;
  const now = opts.now ?? Date.now();
  return {
    state: {
      ...state,
      phase: 'awaiting-host-code',
      code: opts.code,
      expiresAt: ttlMs == null ? null : now + ttlMs,
    },
    code: opts.code,
  };
}

/**
 * A peer said hello WITHOUT presenting a code (e.g. a bare Telegram `/start` —
 * the user opened the chat manually rather than via the pairing deep link).
 */
export function greetPeer<P>(state: HostCodeState<P>, peer: P): HostCodeDecision<P> {
  if (state.authorizedPeer === peer && state.phase === 'paired') {
    return { state, action: { kind: 'still-paired', peer } };
  }
  if (state.authorizedPeer !== null && state.authorizedPeer !== peer) {
    return { state, action: { kind: 'rejected-foreign-peer' } };
  }
  if (state.phase === 'awaiting-host-code') {
    return { state, action: { kind: 'window-open-hint' } };
  }
  return { state, action: { kind: 'no-window' } };
}

/**
 * A peer PRESENTED a code (deep-link payload or a plain message). Whitespace is
 * stripped before comparing; on match the peer is authorized.
 */
export function submitPeerCode<P>(
  state: HostCodeState<P>,
  peer: P,
  rawCode: string,
  now: number = Date.now(),
): HostCodeDecision<P> {
  if (state.phase === 'paired' && state.authorizedPeer === peer) {
    return { state, action: { kind: 'still-paired', peer } };
  }
  if (state.authorizedPeer !== null && state.authorizedPeer !== peer) {
    return { state, action: { kind: 'rejected-foreign-peer' } };
  }
  if (state.phase !== 'awaiting-host-code') {
    return { state, action: { kind: 'not-pending' } };
  }
  if (state.expiresAt !== null && now > state.expiresAt) {
    return {
      state: { ...state, phase: 'expired', code: null, expiresAt: null },
      action: { kind: 'expired' },
    };
  }
  const normalized = rawCode.replace(/\s+/g, '');
  if (!normalized || normalized !== state.code) {
    return { state, action: { kind: 'mismatch' } };
  }
  return {
    state: {
      phase: 'paired',
      code: null,
      expiresAt: null,
      authorizedPeer: peer,
    },
    action: { kind: 'paired', peer },
  };
}

export function isPeerAuthorized<P>(state: HostCodeState<P>, peer: P): boolean {
  return state.phase === 'paired' && state.authorizedPeer === peer;
}

export function clearHostCodePairing<P>(_state: HostCodeState<P>): HostCodeState<P> {
  return {
    phase: 'idle',
    code: null,
    expiresAt: null,
    authorizedPeer: null,
  };
}
