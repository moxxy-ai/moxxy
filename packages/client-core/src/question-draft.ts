import type { MoxxyEvent } from '@moxxy/sdk';
import { openQuestionsFromEvents, type OpenQuestion } from '@moxxy/sdk/questions';

/**
 * The open Question a chat shows: the latest one of the turn running now. A
 * question whose turn is not running was left behind by a runner that stopped
 * mid-question; nothing waits on it, so it is not offered for an answer.
 */
export function pendingQuestion(events: ReadonlyArray<MoxxyEvent>, activeTurnId: string | null): OpenQuestion | null {
  if (activeTurnId === null) return null;
  const open = openQuestionsOf(events).filter((question) => question.turnId === activeTurnId);
  return open.at(-1) ?? null;
}

// Read on every streamed chunk (the sidebar asks each chat what it is doing);
// a chat's events array changes identity only when an event lands.
const openByEvents = new WeakMap<ReadonlyArray<MoxxyEvent>, ReadonlyArray<OpenQuestion>>();

function openQuestionsOf(events: ReadonlyArray<MoxxyEvent>): ReadonlyArray<OpenQuestion> {
  const known = openByEvents.get(events);
  if (known) return known;
  const open = openQuestionsFromEvents(events);
  openByEvents.set(events, open);
  return open;
}
