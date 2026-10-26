import {
  openQuestionsFromEvents,
  type ClientSession as Session,
  type MoxxyEvent,
  type OpenQuestion,
  type QuestionAnswers,
} from '@moxxy/sdk';

/**
 * Tell the session the terminal shows Questions, so tools may ask. A session
 * without Questions (a runner older than protocol 26) gets nothing attached
 * and its tools are told nobody will answer.
 */
export function attachQuestions(session: Session): () => void {
  return session.questions ? session.questions.attachSurface() : () => undefined;
}

/** The latest open Question in the conversation's events, or null. */
export function openQuestionIn(events: ReadonlyArray<MoxxyEvent>): OpenQuestion | null {
  return openQuestionsFromEvents(events).at(-1) ?? null;
}

/** Answer through the session; resolves to why it did not go through, or null. */
export async function sendAnswer(session: Session, questionId: string, answers: QuestionAnswers): Promise<string | null> {
  if (!session.questions) return 'This session cannot take answers to questions.';
  try {
    await session.questions.answer(questionId, answers);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
