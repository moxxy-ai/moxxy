import { randomCode } from '@moxxy/plugin-vault';

/**
 * Pairing state machine — one mechanism, host-issued QR code.
 *
 * A control surface (the desktop "Channels" panel, or `moxxy channels telegram
 * pair` in a terminal) opens a window with `beginHostIssuedPairing`: the 6-digit
 * code is generated UP FRONT so the surface can embed it in a
 * `t.me/<bot>?start=<code>` deep link and render that as a QR. The user scans /
 * opens the link and taps START — the bot receives `/start <code>` — or simply
 * sends the 6 digits as a message. `submitChatCode` matches the presented code
 * and authorizes that chat.
 *
 * Why this single direction (it replaced an older bot-issues-a-code /
 * paste-in-the-terminal flow): it works identically whether the surface is a GUI
 * with no terminal (the desktop) or a terminal (the `pair` command renders the
 * QR inline) — one affordance everywhere, zero manual code entry — while keeping
 * the "prove you can see the host's screen" security property (the code only
 * ever lived on the surface).
 */

export type PairingPhase =
  | 'idle'
  // Host generated a code and is waiting for a chat to present it (via a
  // `?start=<code>` deep link or a plain message). See `beginHostIssuedPairing`.
  | 'awaiting-host-code'
  | 'paired'
  | 'expired';

export interface PairingState {
  phase: PairingPhase;
  code: string | null;
  pendingChatId: number | null;
  expiresAt: number | null;
  authorizedChatId: number | null;
}

export interface PairingDecision {
  readonly state: PairingState;
  readonly action:
    | { kind: 'reject'; message: string }
    | { kind: 'paired'; chatId: number }
    | { kind: 'still-paired'; chatId: number }
    | { kind: 'mismatch'; message: string }
    | { kind: 'expired'; message: string }
    | { kind: 'not-pending'; message: string };
}

export function createPairingState(opts: { authorizedChatId?: number | null } = {}): PairingState {
  return {
    phase: opts.authorizedChatId ? 'paired' : 'idle',
    code: null,
    pendingChatId: null,
    expiresAt: null,
    authorizedChatId: opts.authorizedChatId ?? null,
  };
}

/**
 * Open a host-issued pairing window. The code is generated immediately so the
 * surface can embed it in the deep link / QR it shows the user.
 *
 * No TTL by default: the window's lifetime is the channel process's lifetime
 * while unpaired (the surface tears it down by stopping the channel), and the
 * security boundary is "could see the host's screen", not a clock. A caller may
 * still pass a `ttlMs` to bound it.
 */
export function beginHostIssuedPairing(
  state: PairingState,
  code: string = randomCode(6),
  now: number = Date.now(),
  ttlMs: number | null = null,
): { state: PairingState; code: string } {
  return {
    state: {
      ...state,
      phase: 'awaiting-host-code',
      code,
      pendingChatId: null,
      expiresAt: ttlMs == null ? null : now + ttlMs,
    },
    code,
  };
}

/**
 * Called when the bot receives a BARE `/start` (no code payload) — i.e. the user
 * opened the chat manually rather than via the pairing deep link. The code path
 * for a `/start <code>` payload (and plain-message codes) is `submitChatCode`.
 *
 * Behavior depends on phase:
 *   - paired (same chat)   → still-paired (already authorized; greet)
 *   - paired (other chat)  → reject (the bot is owned by someone else)
 *   - awaiting-host-code   → reject with a nudge to use the QR / send the code
 *   - idle / expired       → reject with a nudge to start pairing
 */
export function handleStart(state: PairingState, chatId: number): PairingDecision {
  if (state.authorizedChatId === chatId && state.phase === 'paired') {
    return { state, action: { kind: 'still-paired', chatId } };
  }
  if (state.authorizedChatId !== null && state.authorizedChatId !== chatId) {
    return {
      state,
      action: { kind: 'reject', message: 'This bot is paired with a different chat. Access denied.' },
    };
  }
  if (state.phase === 'awaiting-host-code') {
    return {
      state,
      action: {
        kind: 'reject',
        message:
          'Scan the QR (or open the link) shown in moxxy, or send the 6-digit code it shows, to finish pairing.',
      },
    };
  }
  return {
    state,
    action: {
      kind: 'reject',
      message:
        'No pairing window is open. Start pairing from the moxxy desktop Channels panel, or run `moxxy channels telegram pair`.',
    },
  };
}

/**
 * Called when a chat PRESENTS a host-issued code — either as the payload of a
 * `/start <code>` deep link or as a plain 6-digit message. On match the chat is
 * authorized.
 */
export function submitChatCode(
  state: PairingState,
  chatId: number,
  rawCode: string,
  now: number = Date.now(),
): PairingDecision {
  if (state.phase === 'paired' && state.authorizedChatId === chatId) {
    return { state, action: { kind: 'still-paired', chatId } };
  }
  if (state.authorizedChatId !== null && state.authorizedChatId !== chatId) {
    return {
      state,
      action: { kind: 'reject', message: 'This bot is paired with a different chat. Access denied.' },
    };
  }
  if (state.phase !== 'awaiting-host-code') {
    return { state, action: { kind: 'not-pending', message: 'No pairing window is open.' } };
  }
  if (state.expiresAt !== null && now > state.expiresAt) {
    return {
      state: { ...state, phase: 'expired', code: null, pendingChatId: null, expiresAt: null },
      action: { kind: 'expired', message: 'Pairing window expired. Start the channel again to retry.' },
    };
  }
  const normalized = rawCode.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized) || normalized !== state.code) {
    return {
      state,
      action: { kind: 'mismatch', message: "Code didn't match. Check the digits shown in moxxy and try again." },
    };
  }
  return {
    state: {
      phase: 'paired',
      code: null,
      pendingChatId: null,
      expiresAt: null,
      authorizedChatId: chatId,
    },
    action: { kind: 'paired', chatId },
  };
}

export function isAuthorized(state: PairingState, chatId: number): boolean {
  return state.phase === 'paired' && state.authorizedChatId === chatId;
}

export function clearPairing(_state: PairingState): PairingState {
  return {
    phase: 'idle',
    code: null,
    pendingChatId: null,
    expiresAt: null,
    authorizedChatId: null,
  };
}
