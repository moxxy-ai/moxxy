import {
  categorizeVoiceOperation,
  toVoiceConversationText,
  type VoiceActiveOperation,
  type VoiceOperationKind,
} from '@moxxy/client-core';
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
  lastProgress: VoiceOperationKind | null;
}

const PROGRESS: Readonly<Record<VoiceOperationKind, string>> = {
  'web-search': 'searching the web',
  'project-read': 'reading the project',
  editing: 'editing files',
  verification: 'running checks or tests',
  command: 'running a command',
  application: 'using an app on screen',
  delegation: 'working with a sub-agent',
  generic: 'using a tool',
};

/** Waits keyed by user turn; `ANY_TURN` takes whichever user turn ends next. */
const ANY_TURN = Symbol('any user turn');

/**
 * Tracks GPT-Live delegations from request to result:
 *
 * 1. GPT-Live asks to delegate a user turn — often before that turn's
 *    transcript is final — so the delegation waits for the user's own words.
 * 2. Those exact words run as an ordinary agent turn; the turn is recognised
 *    when its `user_prompt` reaches the chat.
 * 3. While it runs, its tool calls become progress context, so GPT-Live can
 *    answer "how is it going?" itself instead of delegating the question.
 * 4. When that turn completes, its final reply (or failure) becomes the result
 *    GPT-Live reads back. Nothing is reported before the agent has finished.
 *
 * One task runs at a time: a task asked for while the agent is busy is refused,
 * never queued, so the agent always finishes what it is working on.
 */
export class GptLiveDelegations {
  private readonly waiting = new Map<string | typeof ANY_TURN, string>();
  private readonly dispatches: Dispatch[] = [];
  private readonly agentTurns = new Map<string, AgentTurn>();
  private readonly operations = new Map<string, VoiceActiveOperation & { readonly turnId: string }>();
  private operationOrdinal = 0;

  get inFlight(): number {
    return this.dispatches.length + this.agentTurns.size;
  }

  get activeOperations(): ReadonlyArray<VoiceActiveOperation> {
    return [...this.operations.values()].map(({ callId, kind, ordinal }) => ({ callId, kind, ordinal }));
  }

  refuseWhileBusy(itemId: string): GptLiveDelegationResult {
    return {
      itemId,
      text: 'Not started: the Moxxy agent is still working on another task and must finish it first. If this was a question you can answer from the conversation or the progress you were given, answer it yourself; otherwise tell the user it was not started and they can ask again once the current task is done.',
    };
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

  /** Follow the runner log; returns new progress context for GPT-Live, if any. */
  observe(event: MoxxyEvent): string | null {
    if (event.type === 'user_prompt') {
      const index = this.dispatches.findIndex((dispatch) => dispatch.prompt === event.text);
      if (index < 0) return null;
      const [dispatch] = this.dispatches.splice(index, 1);
      if (dispatch) {
        this.agentTurns.set(event.turnId, { itemId: dispatch.itemId, reply: '', lastProgress: null });
      }
      return null;
    }
    const turn = this.agentTurns.get(event.turnId);
    if (!turn) return null;
    if (event.type === 'assistant_message' && event.content.trim()) turn.reply = event.content;
    if (event.type === 'tool_result') this.operations.delete(event.callId);
    if (event.type !== 'tool_call_requested') return null;
    const kind = categorizeVoiceOperation(event.name, event.input);
    this.operationOrdinal += 1;
    this.operations.set(event.callId, {
      callId: event.callId,
      kind,
      ordinal: this.operationOrdinal,
      turnId: event.turnId,
    });
    if (turn.lastProgress === kind) return null;
    turn.lastProgress = kind;
    return `Progress of the running Moxxy task: the agent is ${PROGRESS[kind]}.`;
  }

  complete(turnId: string, error: string | null): GptLiveDelegationResult | null {
    const turn = this.agentTurns.get(turnId);
    if (!turn) return null;
    this.agentTurns.delete(turnId);
    for (const [callId, operation] of this.operations) {
      if (operation.turnId === turnId) this.operations.delete(callId);
    }
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
