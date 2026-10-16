import { useMemo, useSyncExternalStore } from 'react';
import { askStore, chatStore, pendingQuestion } from '@moxxy/client-core';
import { turnInFlight } from '@/lib/turn-in-flight';
import type { SessionActivity } from './calls-for-attention';

/** No session id holds a tab or a line break, so they can stand between the parts. */
const BETWEEN_CHATS = '\n';
const BETWEEN_PARTS = '\t';

function subscribe(listener: () => void): () => void {
  const offChats = chatStore.subscribe(listener);
  const offAsks = askStore.subscribe(listener);
  return () => {
    offChats();
    offAsks();
  };
}

/**
 * What each of `ids` is doing: working on an answer, or stopped on the person
 * (an approval it is blocked on, or a Question it asked).
 * The stores tick on every streamed chunk; the result changes identity only
 * when a chat changes what it is doing.
 */
export function useSessionActivity(ids: ReadonlySet<string>): ReadonlyMap<string, SessionActivity> {
  const read = (): string => {
    const asking = new Set(askStore.getAll().map((ask) => ask.workspaceId));
    const lines: string[] = [];
    for (const id of ids) {
      const chat = chatStore.getChat(id);
      if (asking.has(id) || pendingQuestion(chat.events, chat.activeTurnId)) lines.push(`${id}${BETWEEN_PARTS}asking`);
      else if (turnInFlight(chat)) lines.push(`${id}${BETWEEN_PARTS}working`);
    }
    return lines.join(BETWEEN_CHATS);
  };
  const key = useSyncExternalStore(subscribe, read, read);
  return useMemo(
    () =>
      new Map(
        key === ''
          ? []
          : key.split(BETWEEN_CHATS).map((line) => {
              const [id = '', activity] = line.split(BETWEEN_PARTS);
              return [id, activity === 'asking' ? 'asking' : 'working'] as const;
            }),
      ),
    [key],
  );
}
