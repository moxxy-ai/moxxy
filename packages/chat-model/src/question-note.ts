import type { MoxxyEvent } from '@moxxy/sdk';
import { QUESTION_CLOSED_AGENT_WENT_ON, QUESTION_CLOSED_NEW_MESSAGE, questionRecord } from '@moxxy/sdk/questions';

/** Why a question disappeared without an answer, kept in the conversation. */
export function questionClosedText(event: MoxxyEvent): string | null {
  const record = questionRecord(event);
  if (!record || record.kind !== 'resolved' || record.outcome.kind !== 'dismissed') return null;
  if (record.outcome.note === QUESTION_CLOSED_AGENT_WENT_ON) return 'Question closed: the agent went on without an answer.';
  if (record.outcome.note === QUESTION_CLOSED_NEW_MESSAGE) return 'Question closed: you sent a new message instead.';
  return null;
}
