import type { GptLiveRole } from './gpt-live-protocol';

/**
 * Pairs finished GPT-Live turns into the exchanges moxxy records in the chat.
 * The call is full-duplex, so a reply can start before the user's turn closes;
 * pairing on `turn.done` keeps each exchange in the order it was spoken.
 *
 * Only conversation GPT-Live answered itself is recorded here. A user turn it
 * delegates is claimed for the agent (the agent turn records it), and speech
 * with no user turn behind it — acknowledgements, read-back task results — is
 * already represented in the chat by the agent's own reply.
 */
interface PendingUserTurn {
  readonly turnId: string;
  readonly text: string;
}

export interface GptLiveExchangeState {
  readonly pendingUserTurns: ReadonlyArray<PendingUserTurn>;
}

export interface GptLiveExchange {
  readonly userText?: string;
  readonly assistantText?: string;
}

export interface GptLiveTurn {
  readonly role: GptLiveRole;
  readonly turnId: string;
  readonly text: string;
}

export const EMPTY_GPT_LIVE_EXCHANGE: GptLiveExchangeState = Object.freeze({ pendingUserTurns: [] });

export function acceptGptLiveTurn(
  state: GptLiveExchangeState,
  turn: GptLiveTurn,
): { readonly state: GptLiveExchangeState; readonly exchange: GptLiveExchange | null } {
  const text = turn.text.trim();
  if (!text) return { state, exchange: null };
  if (turn.role === 'user') {
    return {
      state: { pendingUserTurns: [...state.pendingUserTurns, { turnId: turn.turnId, text }] },
      exchange: null,
    };
  }
  const userText = joinUserText(state);
  return {
    state: EMPTY_GPT_LIVE_EXCHANGE,
    exchange: userText ? { userText, assistantText: text } : null,
  };
}

/** Take a finished user turn out of the voice record so the agent can run it. */
export function claimGptLiveUserTurn(
  state: GptLiveExchangeState,
  turnId: string,
): { readonly state: GptLiveExchangeState; readonly text: string | null } {
  const claimed = state.pendingUserTurns.find((turn) => turn.turnId === turnId);
  if (!claimed) return { state, text: null };
  return {
    state: { pendingUserTurns: state.pendingUserTurns.filter((turn) => turn !== claimed) },
    text: claimed.text,
  };
}

/** Speech the model never answered is still part of the conversation. */
export function flushGptLiveExchange(state: GptLiveExchangeState): GptLiveExchange | null {
  const userText = joinUserText(state);
  return userText ? { userText } : null;
}

function joinUserText(state: GptLiveExchangeState): string {
  return state.pendingUserTurns.map((turn) => turn.text).join(' ');
}
