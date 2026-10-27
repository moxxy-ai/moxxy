import {
  categorizeVoiceOperation,
  toVoiceConversationText,
  type VoiceActiveOperation,
} from '@moxxy/client-core';
import {
  isStepListDisplay,
  isToolDisplayResult,
  stepListProgress,
} from '@moxxy/sdk/tool-display';
import type { MoxxyEvent } from '@moxxy/sdk';
import { describeAgentStatus, operationDetail, type AgentTaskStatus } from './gpt-live-status';

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
  readonly itemId: string | null;
  reply: string;
  status: AgentTaskStatus;
  /** The last status line sent, so an unchanged one is not repeated. */
  lastSaid: string | null;
}

export interface GptLiveDelegationsOptions {
  readonly now?: () => number;
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
 * 3. While it runs, its tool calls and plan become a concrete status (task,
 *    time, step, command or file, plan progress), so GPT-Live can answer "how
 *    is it going?" itself instead of delegating the question.
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
  private readonly operations = new Map<string, VoiceActiveOperation & { readonly turnId: string; readonly detail?: string }>();
  private operationOrdinal = 0;
  private lastStatus = 'The Moxxy agent has no running task.';
  private readonly now: () => number;

  constructor(options: GptLiveDelegationsOptions = {}) {
    this.now = options.now ?? Date.now;
  }

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
      if (index < 0 && (event.origin?.kind === 'voice' || event.origin?.kind === 'checkpoint')) return null;
      const dispatch = index >= 0 ? this.dispatches.splice(index, 1)[0] : undefined;
      if (!this.agentTurns.has(event.turnId)) {
        this.agentTurns.set(event.turnId, {
          itemId: dispatch?.itemId ?? null,
          reply: '',
          status: { task: event.text, startedAt: this.now(), steps: 0, done: [] },
          lastSaid: null,
        });
      }
      return null;
    }
    const turn = this.agentTurns.get(event.turnId);
    if (!turn) return null;
    if (event.type === 'assistant_message' && event.content.trim()) turn.reply = event.content;
    if (event.type === 'tool_result') {
      const finished = this.operations.get(event.callId);
      this.operations.delete(event.callId);
      const operation = [...this.operations.values()].filter(operation => operation.turnId === event.turnId).at(-1);
      turn.status = {
        ...turn.status,
        current: operation ? { kind: operation.kind, detail: operation.detail } : undefined,
        done: finished && !turn.status.done.includes(finished.kind) ? [...turn.status.done, finished.kind] : turn.status.done,
      };
      const output = event.output;
      if (!isToolDisplayResult(output) || !isStepListDisplay(output.display)) return null;
      const { done, total, current } = stepListProgress(output.display);
      turn.status = { ...turn.status, plan: { done, total, ...(current ? { current: current.text } : {}) } };
      return this.say(turn);
    }
    if (event.type !== 'tool_call_requested') return null;
    const kind = categorizeVoiceOperation(event.name, event.input);
    const detail = operationDetail(event.input);
    this.operationOrdinal += 1;
    this.operations.set(event.callId, {
      callId: event.callId,
      kind,
      ordinal: this.operationOrdinal,
      ...(detail ? { detail } : {}),
      turnId: event.turnId,
    });
    const previous = turn.status.current;
    turn.status = {
      ...turn.status,
      steps: turn.status.steps + 1,
      current: { kind, ...(detail ? { detail } : {}) },
      done: previous && previous.kind !== kind && !turn.status.done.includes(previous.kind)
        ? [...turn.status.done, previous.kind]
        : turn.status.done,
    };
    if (previous?.kind === kind && previous.detail === detail) return null;
    return this.say(turn);
  }

  /** Reuse the chat's existing event projection when a call starts mid-task. */
  restore(events: ReadonlyArray<MoxxyEvent>, activeTurnId: string): void {
    const current = events.filter(event => event.turnId === activeTurnId);
    for (const event of current) this.observe(event);
    const turn = this.agentTurns.get(activeTurnId);
    const first = current[0];
    if (turn && first) turn.status = { ...turn.status, startedAt: first.ts };
  }

  /** Read the same task projection on demand, including tasks typed in chat. */
  status(waitingForInput = false): string {
    const turn = [...this.agentTurns.values()].at(-1);
    if (!turn) return this.lastStatus;
    if (waitingForInput) return 'The Moxxy agent is waiting for you to approve a step or answer a question in the chat.';
    return describeAgentStatus(turn.status, this.now());
  }

  /** The turn's status line, unless it says nothing new. */
  private say(turn: AgentTurn): string | null {
    const text = describeAgentStatus(turn.status, this.now());
    if (text === turn.lastSaid) return null;
    turn.lastSaid = text;
    return text;
  }

  complete(turnId: string, error: string | null): GptLiveDelegationResult | null {
    const turn = this.agentTurns.get(turnId);
    if (!turn) return null;
    this.agentTurns.delete(turnId);
    for (const [callId, operation] of this.operations) {
      if (operation.turnId === turnId) this.operations.delete(callId);
    }
    this.lastStatus = error
      ? `The Moxxy agent could not finish the task: ${error.slice(0, 200)}`
      : 'The Moxxy agent finished its task.';
    if (turn.itemId === null) return null;
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
