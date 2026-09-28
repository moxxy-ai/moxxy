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

export interface GptLiveHoldResult {
  /** False when another task already waits; the notice then is the final result. */
  readonly held: boolean;
  readonly notice: string;
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
 * A task asked for while the agent is busy waits in a single visible slot and
 * starts when the agent is free; a second one is refused rather than queued
 * out of sight.
 */
export class GptLiveDelegations {
  private readonly waiting = new Map<string | typeof ANY_TURN, string>();
  private readonly dispatches: Dispatch[] = [];
  private readonly agentTurns = new Map<string, AgentTurn>();
  private readonly operations = new Map<string, VoiceActiveOperation & { readonly turnId: string }>();
  private operationOrdinal = 0;
  private held: Dispatch | null = null;

  get inFlight(): number {
    return this.dispatches.length + this.agentTurns.size;
  }

  get heldPrompt(): string | null {
    return this.held ? this.held.prompt : null;
  }

  get activeOperations(): ReadonlyArray<VoiceActiveOperation> {
    return [...this.operations.values()].map(({ callId, kind, ordinal }) => ({ callId, kind, ordinal }));
  }

  hold(itemId: string, prompt: string): GptLiveHoldResult {
    if (this.held) {
      return {
        held: false,
        notice: `Not started: the Moxxy agent is busy and another voice task is already waiting ("${this.held.prompt}"). Tell the user this one was not queued and they can ask again when the agent is free.`,
      };
    }
    this.held = { itemId, prompt };
    return {
      held: true,
      notice: 'Queued: the Moxxy agent is busy with another task. This task is waiting and will start automatically when the current task finishes. It has not started yet.',
    };
  }

  takeHeld(): Dispatch | null {
    const held = this.held;
    this.held = null;
    return held;
  }

  cancelHeld(reason: string): { readonly prompt: string; readonly result: GptLiveDelegationResult } | null {
    const held = this.takeHeld();
    if (!held) return null;
    return {
      prompt: held.prompt,
      result: { itemId: held.itemId, text: `The waiting task was not run: ${reason}.` },
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
