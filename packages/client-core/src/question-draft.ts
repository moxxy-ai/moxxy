import type { MoxxyEvent } from '@moxxy/sdk';
import { openQuestionsFromEvents, type OpenQuestion } from '@moxxy/sdk/questions';

/**
 * The open Question a chat shows while a turn runs: the latest one asked, of
 * whichever turn asked it, so a question stays on screen for as long as it
 * waits. With no turn running nothing waits on it (a runner stopped
 * mid-question), so it is not offered for an answer.
 */
export function pendingQuestion(events: ReadonlyArray<MoxxyEvent>, activeTurnId: string | null): OpenQuestion | null {
  if (activeTurnId === null) return null;
  return openQuestionsOf(events).at(-1) ?? null;
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
