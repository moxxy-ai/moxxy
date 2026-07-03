import { randomCode } from '@moxxy/plugin-vault';
import {
  clearHostCodePairing,
  createHostCodeState,
  greetPeer,
  isPeerAuthorized,
  openHostCodeWindow,
  submitPeerCode,
  type HostCodeAction,
  type HostCodeState,
} from '@moxxy/channel-kit';

/**
 * Discord pairing — the kit's host-code machine, driven over DM in the
 * "bot replies with a code, operator pastes it in the terminal" direction.
 *
 * Flow (the wizard/`moxxy discord pair` arms it):
 *   1. The channel starts with a pairing window ARMED (no code yet).
 *   2. An unauthorized user DMs the bot → we mint a one-time code bound to
 *      THAT user ({@link mintCodeForPeer} = `openHostCodeWindow` with the
 *      DM-ing user recorded as the pending peer) and DM the code back.
 *   3. The operator pastes the code into the terminal wizard →
 *      {@link confirmPendingCode} (`submitPeerCode` against the pending peer).
 *      On match the DM-ing user becomes the authorized principal.
 *
 * Security property: the code only ever lives in the candidate's DM, so
 * pasting it in the terminal proves the operator controls (or trusts) that
 * Discord account. A different user DM-ing while armed re-mints the window
 * for themselves — which STALES the earlier code, so the operator's paste of
 * the legitimate code then mismatches and pairing simply retries; an attacker
 * can never be authorized unless the operator pastes the ATTACKER's code
 * (which only exists in the attacker's DM).
 *
 * The transitions live in `@moxxy/channel-kit` (generic over the peer id —
 * a Discord user id string here); this module keeps the Discord-shaped state
 * (armed flag + pending peer) and maps the kit's semantic action kinds to
 * Discord-worded messages.
 */

export type DiscordPairingPhase = 'idle' | 'armed' | 'awaiting-host-code' | 'paired' | 'expired';

export interface DiscordPairingState {
  /** Kit machine state; peer = Discord user id. */
  readonly kit: HostCodeState<string>;
  /** A pairing window is armed (codes will be minted for DM-ing users). */
  readonly armed: boolean;
  /** The user the CURRENT code was minted for (null when none outstanding). */
  readonly pendingUserId: string | null;
}

export interface DiscordPairingDecision {
  readonly state: DiscordPairingState;
  readonly action:
    | { kind: 'code-minted'; userId: string; code: string }
    | { kind: 'paired'; userId: string }
    | { kind: 'still-paired'; userId: string }
    | { kind: 'reject'; message: string }
    | { kind: 'mismatch'; message: string }
    | { kind: 'not-pending'; message: string }
    | { kind: 'expired'; message: string };
}

const MSG_FOREIGN_USER = 'This bot is paired with a different Discord account. Access denied.';
const MSG_NOT_ARMED =
  'No pairing window is open. Run `moxxy discord pair` in the moxxy terminal first, then DM me again.';
const MSG_NOT_PENDING = 'No pairing code is outstanding. DM the bot first — it replies with a code.';
const MSG_MISMATCH =
  "That code didn't match. Check the code in the bot's most recent DM reply and try again.";
const MSG_EXPIRED = 'The pairing code expired. DM the bot again for a fresh one.';

export function createDiscordPairingState(
  opts: { authorizedUserId?: string | null } = {},
): DiscordPairingState {
  return {
    kit: createHostCodeState<string>({ authorizedPeer: opts.authorizedUserId ?? null }),
    armed: false,
    pendingUserId: null,
  };
}

export function pairingPhase(state: DiscordPairingState): DiscordPairingPhase {
  if (state.kit.phase === 'paired') return 'paired';
  if (state.kit.phase === 'awaiting-host-code') return 'awaiting-host-code';
  if (state.kit.phase === 'expired') return 'expired';
  return state.armed ? 'armed' : 'idle';
}

/** Arm the pairing window: DM-ing users will now be issued one-time codes. */
export function armPairing(state: DiscordPairingState): DiscordPairingState {
  return { ...state, armed: true };
}

export function isUserAuthorized(state: DiscordPairingState, userId: string): boolean {
  return isPeerAuthorized(state.kit, userId);
}

export function clearDiscordPairing(state: DiscordPairingState): DiscordPairingState {
  return {
    kit: clearHostCodePairing(state.kit),
    armed: state.armed,
    pendingUserId: null,
  };
}

/**
 * An unauthorized user DMed the bot while a window may be armed. Mints a
 * one-time code bound to that user (re-arming replaces any earlier pending
 * code — see the module doc for why that fails safe) or rejects with the
 * appropriate wording.
 */
export function mintCodeForPeer(
  state: DiscordPairingState,
  userId: string,
  code: string = randomCode(6),
): DiscordPairingDecision {
  const greeted = greetPeer(state.kit, userId);
  if (greeted.action.kind === 'still-paired') {
    return { state, action: { kind: 'still-paired', userId } };
  }
  if (greeted.action.kind === 'rejected-foreign-peer') {
    return { state, action: { kind: 'reject', message: MSG_FOREIGN_USER } };
  }
  if (!state.armed) {
    return { state, action: { kind: 'reject', message: MSG_NOT_ARMED } };
  }
  const opened = openHostCodeWindow(state.kit, { code });
  return {
    state: { kit: opened.state, armed: true, pendingUserId: userId },
    action: { kind: 'code-minted', userId, code: opened.code },
  };
}

/** Map a kit action to the Discord-worded decision, reusing `state` when the
 *  machine didn't transition. */
function mapConfirmAction(
  state: DiscordPairingState,
  kitState: HostCodeState<string>,
  action: HostCodeAction<string>,
): DiscordPairingDecision {
  switch (action.kind) {
    case 'paired':
      return {
        state: { kit: kitState, armed: false, pendingUserId: null },
        action: { kind: 'paired', userId: action.peer },
      };
    case 'still-paired':
      return { state, action: { kind: 'still-paired', userId: action.peer } };
    case 'rejected-foreign-peer':
      return { state, action: { kind: 'reject', message: MSG_FOREIGN_USER } };
    case 'window-open-hint':
    case 'no-window':
    case 'not-pending':
      return { state, action: { kind: 'not-pending', message: MSG_NOT_PENDING } };
    case 'expired':
      return {
        state: { kit: kitState, armed: state.armed, pendingUserId: null },
        action: { kind: 'expired', message: MSG_EXPIRED },
      };
    case 'mismatch':
      return { state, action: { kind: 'mismatch', message: MSG_MISMATCH } };
  }
}

/**
 * The operator pasted a code into the terminal wizard. Compared against the
 * code minted for the CURRENT pending user; on match that user is authorized.
 */
export function confirmPendingCode(
  state: DiscordPairingState,
  rawCode: string,
  now: number = Date.now(),
): DiscordPairingDecision {
  if (state.pendingUserId == null) {
    return { state, action: { kind: 'not-pending', message: MSG_NOT_PENDING } };
  }
  const decision = submitPeerCode(state.kit, state.pendingUserId, rawCode, now);
  return mapConfirmAction(state, decision.state, decision.action);
}
