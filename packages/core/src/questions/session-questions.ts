import { ulid } from 'ulid';
import {
  QUESTION_ASKED,
  QUESTION_PLUGIN_ID,
  QUESTION_RESOLVED,
  QUESTION_CLOSED_NEW_MESSAGE,
  openQuestionsFromEvents,
  questionAnswersProblem,
  questionCloseNote,
  questionRecord,
  asTurnId,
  waitFor,
  type QuestionAnswers,
  type QuestionAsker,
  type QuestionOutcome,
  type SessionId,
  type SessionQuestions,
  type TurnId,
} from '@moxxy/sdk';
import type { EventLog } from '../events/log.js';

/**
 * The session's Questions. Asking appends a `question_asked` record and waits
 * for the matching `question_resolved` one, so the open question is state every
 * attached surface reads from the log, and an answer from any of them is the
 * one answer. Asking needs at least one surface that can show it; with none
 * attached (a headless run) the asker is told nobody will answer.
 */
export class SessionQuestionsImpl implements SessionQuestions {
  private surfaces = 0;
  /** Questions an asker in this process still waits on; one left in the log by an earlier run is dead. */
  private readonly waiting = new Set<string>();

  constructor(private readonly deps: { readonly log: EventLog; readonly sessionId: SessionId }) {}

  get surfaceCount(): number {
    return this.surfaces;
  }

  attachSurface(): () => void {
    this.surfaces += 1;
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.surfaces -= 1;
    };
  }

  readonly ask: QuestionAsker = async ({ turnId, questions, signal }) => {
    if (signal.aborted) return { kind: 'dismissed', reason: 'cancelled' };
    if (this.surfaces === 0) return { kind: 'unanswerable' };

    const questionId = ulid();
    const { log } = this.deps;
    // Listen before asking, so an answer that lands at once is never missed.
    const outcome = waitFor<QuestionOutcome>(() => this.outcomeOf(questionId), {
      wakeOn: [(wake) => log.subscribe(wake)],
      signal,
    });
    this.waiting.add(questionId);
    try {
      await this.record(turnId, QUESTION_ASKED, { questionId, questions });
      const settled = await outcome;
      if (settled.status === 'ready') return settled.value;
      // The asker closed it for a reason of its own (the agent went on), or the turn stopped.
      const note = questionCloseNote(signal.reason);
      if (this.isOpen(questionId)) await this.record(turnId, QUESTION_RESOLVED, { questionId, dismissed: 'cancelled', ...(note ? { note } : {}) });
      return note ? { kind: 'dismissed', reason: 'cancelled', note } : { kind: 'dismissed', reason: 'cancelled' };
    } finally {
      this.waiting.delete(questionId);
    }
  };

  async answer(questionId: string, answers: QuestionAnswers): Promise<void> {
    // Check and record in one synchronous step (append pushes before it
    // awaits), so two surfaces answering at once cannot both get in.
    const open = this.waiting.has(questionId)
      ? openQuestionsFromEvents(this.deps.log.ofType('plugin_event')).find((q) => q.questionId === questionId)
      : undefined;
    if (!open) throw new Error('This question is no longer open.');
    const problem = questionAnswersProblem(open.questions, answers);
    if (problem) throw new Error(problem);
    await this.record(asTurnId(open.turnId), QUESTION_RESOLVED, { questionId, answers });
  }

  /**
   * Close every question nobody in this process waits on: on a resumed log
   * those were left open by a run that stopped mid-question. Recording the
   * close keeps the log the one answer to "is a question open" for every client.
   */
  closeLeftOver(): Promise<unknown> {
    const left = openQuestionsFromEvents(this.deps.log.ofType('plugin_event')).filter(
      (question) => !this.waiting.has(question.questionId),
    );
    return Promise.all(
      left.map((question) =>
        this.record(asTurnId(question.turnId), QUESTION_RESOLVED, { questionId: question.questionId, dismissed: 'cancelled' }),
      ),
    );
  }

  /**
   * The person sent a new message (turn `turnId`) instead of answering: close
   * the questions other turns in this process still wait on, so those turns
   * end and the new message is not left queued behind them.
   */
  closeOnNewMessage(turnId: TurnId): Promise<unknown> {
    const waited = openQuestionsFromEvents(this.deps.log.ofType('plugin_event')).filter(
      (question) => this.waiting.has(question.questionId) && question.turnId !== turnId,
    );
    return Promise.all(
      waited.map((question) =>
        this.record(asTurnId(question.turnId), QUESTION_RESOLVED, {
          questionId: question.questionId,
          dismissed: 'cancelled',
          note: QUESTION_CLOSED_NEW_MESSAGE,
        }),
      ),
    );
  }

  private isOpen(questionId: string): boolean {
    return openQuestionsFromEvents(this.deps.log.ofType('plugin_event')).some((q) => q.questionId === questionId);
  }

  private outcomeOf(questionId: string): QuestionOutcome | undefined {
    const events = this.deps.log.ofType('plugin_event');
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      const found = event ? questionRecord(event) : null;
      if (found && found.kind === 'resolved' && found.questionId === questionId) return found.outcome;
    }
    return undefined;
  }

  private record(turnId: TurnId, subtype: string, payload: unknown): Promise<unknown> {
    return this.deps.log.append({
      type: 'plugin_event',
      sessionId: this.deps.sessionId,
      turnId,
      source: 'system',
      pluginId: QUESTION_PLUGIN_ID,
      subtype,
      payload,
    });
  }
}
