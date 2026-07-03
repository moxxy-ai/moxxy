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
 *
 * The transitions live in `@moxxy/channel-kit` (host-code pairing, generic over
 * the peer id — shared with future channels); this module keeps the
 * Telegram-shaped state/decision surface and maps the kit's semantic action
 * kinds to Telegram's user-facing messages.
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

const MSG_FOREIGN_CHAT = 'This bot is paired with a different chat. Access denied.';
const MSG_WINDOW_OPEN_HINT =
  'Scan the QR (or open the link) shown in moxxy, or send the 6-digit code it shows, to finish pairing.';
const MSG_NO_WINDOW =
  'No pairing window is open. Start pairing from the moxxy desktop Channels panel, or run `moxxy channels telegram pair`.';
const MSG_NOT_PENDING = 'No pairing window is open.';
const MSG_EXPIRED = 'Pairing window expired. Start the channel again to retry.';
const MSG_MISMATCH = "Code didn't match. Check the digits shown in moxxy and try again.";

function toKit(state: PairingState): HostCodeState<number> {
  return {
    phase: state.phase,
    code: state.code,
    expiresAt: state.expiresAt,
    authorizedPeer: state.authorizedChatId,
  };
}

function fromKit(state: HostCodeState<number>): PairingState {
  return {
    phase: state.phase,
    code: state.code,
    pendingChatId: null,
    expiresAt: state.expiresAt,
    authorizedChatId: state.authorizedPeer,
  };
}

export function createPairingState(opts: { authorizedChatId?: number | null } = {}): PairingState {
  return fromKit(
    createHostCodeState<number>({
      // Preserve the historical truthy check (a 0 chat id is not a real chat).
      authorizedPeer: opts.authorizedChatId ? opts.authorizedChatId : null,
    }),
  );
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
  const opened = openHostCodeWindow(toKit(state), { code, now, ttlMs });
  return { state: fromKit(opened.state), code: opened.code };
}

/** Map a kit action to the Telegram-worded decision, reusing `state` when the
 *  machine didn't transition. */
function mapAction(
  state: PairingState,
  kitState: HostCodeState<number>,
  action: HostCodeAction<number>,
): PairingDecision {
  switch (action.kind) {
    case 'paired':
      return { state: fromKit(kitState), action: { kind: 'paired', chatId: action.peer } };
    case 'still-paired':
      return { state, action: { kind: 'still-paired', chatId: action.peer } };
    case 'rejected-foreign-peer':
      return { state, action: { kind: 'reject', message: MSG_FOREIGN_CHAT } };
    case 'window-open-hint':
      return { state, action: { kind: 'reject', message: MSG_WINDOW_OPEN_HINT } };
    case 'no-window':
      return { state, action: { kind: 'reject', message: MSG_NO_WINDOW } };
    case 'not-pending':
      return { state, action: { kind: 'not-pending', message: MSG_NOT_PENDING } };
    case 'expired':
      return { state: fromKit(kitState), action: { kind: 'expired', message: MSG_EXPIRED } };
    case 'mismatch':
      return { state, action: { kind: 'mismatch', message: MSG_MISMATCH } };
  }
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
  const decision = greetPeer(toKit(state), chatId);
  return mapAction(state, decision.state, decision.action);
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
  const decision = submitPeerCode(toKit(state), chatId, rawCode, now);
  return mapAction(state, decision.state, decision.action);
}

export function isAuthorized(state: PairingState, chatId: number): boolean {
  return isPeerAuthorized(toKit(state), chatId);
}

export function clearPairing(state: PairingState): PairingState {
  return fromKit(clearHostCodePairing(toKit(state)));
}
