import { toVoiceConversationText } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';

/** A read-back result stays short enough for GPT-Live to say in one breath. */
export const GPT_LIVE_RESULT_MAX_CHARS = 4_000;

export interface GptLiveDelegationResult {
  readonly itemId: string;
  readonly text: string;
}

interface Dispatch {
  readonly itemId: string;
  readonly prompt: string;
}

interface AgentTurn {
  readonly itemId: string;
  reply: string;
}

/** Waits keyed by user turn; `ANY_TURN` takes whichever user turn ends next. */
const ANY_TURN = Symbol('any user turn');

/**
 * Tracks GPT-Live delegations from request to result:
 *
 * 1. GPT-Live asks to delegate a user turn — often before that turn's
 *    transcript is final — so the delegation waits for the user's own words.
 * 2. Those exact words run as an ordinary agent turn; the turn is recognised
 *    when its `user_prompt` reaches the chat.
 * 3. When that turn completes, its final reply (or failure) becomes the result
 *    GPT-Live reads back. Nothing is reported before the agent has finished.
 */
export class GptLiveDelegations {
  private readonly waiting = new Map<string | typeof ANY_TURN, string>();
  private readonly dispatches: Dispatch[] = [];
  private readonly agentTurns = new Map<string, AgentTurn>();

  get inFlight(): number {
    return this.dispatches.length + this.agentTurns.size;
  }

  waitForUserTurn(itemId: string, userTurnId: string | null): void {
    this.waiting.set(userTurnId ?? ANY_TURN, itemId);
  }

  /** The delegation waiting for this finished user turn, if any. */
  takeWaitingFor(userTurnId: string): string | null {
    for (const key of [userTurnId, ANY_TURN] as const) {
      const itemId = this.waiting.get(key);
      if (itemId !== undefined) {
        this.waiting.delete(key);
        return itemId;
      }
    }
    return null;
  }

  dispatched(itemId: string, prompt: string): void {
    this.dispatches.push({ itemId, prompt });
  }

  observe(event: MoxxyEvent): void {
    if (event.type === 'user_prompt') {
      const index = this.dispatches.findIndex((dispatch) => dispatch.prompt === event.text);
      if (index < 0) return;
      const [dispatch] = this.dispatches.splice(index, 1);
      if (dispatch) this.agentTurns.set(event.turnId, { itemId: dispatch.itemId, reply: '' });
      return;
    }
    if (event.type === 'assistant_message') {
      const turn = this.agentTurns.get(event.turnId);
      if (turn && event.content.trim()) turn.reply = event.content;
    }
  }

  complete(turnId: string, error: string | null): GptLiveDelegationResult | null {
    const turn = this.agentTurns.get(turnId);
    if (!turn) return null;
    this.agentTurns.delete(turnId);
    if (error) return failure(turn.itemId, error);
    const reply = toVoiceConversationText(turn.reply).trim();
    return {
      itemId: turn.itemId,
      text: reply
        ? bound(`The Moxxy agent finished. Its reply: ${reply}`)
        : 'The Moxxy agent finished without a reply.',
    };
  }

  failDispatch(itemId: string, error: string): GptLiveDelegationResult {
    const index = this.dispatches.findIndex((dispatch) => dispatch.itemId === itemId);
    if (index >= 0) this.dispatches.splice(index, 1);
    return failure(itemId, error);
  }
}

function failure(itemId: string, error: string): GptLiveDelegationResult {
  return { itemId, text: bound(`The Moxxy agent could not finish the task: ${error}`) };
}

function bound(text: string): string {
  return text.length <= GPT_LIVE_RESULT_MAX_CHARS
    ? text
    : `${text.slice(0, GPT_LIVE_RESULT_MAX_CHARS - 1)}…`;
}
