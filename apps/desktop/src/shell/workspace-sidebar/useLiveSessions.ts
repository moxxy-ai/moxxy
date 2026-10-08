import { useRef, useSyncExternalStore } from 'react';
import { chatStore } from '@moxxy/client-core';
import { turnInFlight } from '@/lib/turn-in-flight';
import { lastMessageText } from './session-preview';

/** What this window knows about its runs beyond the session list. */
export interface LiveSessions {
  /** Newest message per session, for conversations loaded in this window. */
  readonly latest: ReadonlyMap<string, string>;
  /** Sessions with a turn in flight. */
  readonly running: ReadonlySet<string>;
}

const NOTHING: LiveSessions = { latest: new Map(), running: new Set() };

/**
 * Live state for the run list, read from the chat store.
 *
 * The session list carries no last message and no run state, so a row can only
 * show them for conversations this window has open. The result keeps its
 * identity until one of those two facts changes: the store also ticks on every
 * streamed chunk, and the list must not re-render for those.
 */
export function useLiveSessions(ids: ReadonlyArray<string>): LiveSessions {
  const cache = useRef<{ key: ReadonlyArray<unknown>; value: LiveSessions }>({
    key: [],
    value: NOTHING,
  });

  const read = (): LiveSessions => {
    const key: unknown[] = [];
    for (const id of ids) {
      const chat = chatStore.getChat(id);
      key.push(id, chat.events, turnInFlight(chat));
    }
    const previous = cache.current;
    if (previous.key.length === key.length && key.every((part, i) => part === previous.key[i])) {
      return previous.value;
    }
    const latest = new Map<string, string>();
    const running = new Set<string>();
    for (const id of ids) {
      const chat = chatStore.getChat(id);
      const text = lastMessageText(chat.events);
      if (text) latest.set(id, text);
      if (turnInFlight(chat)) running.add(id);
    }
    const value = latest.size === 0 && running.size === 0 ? NOTHING : { latest, running };
    cache.current = { key, value };
    return value;
  };

  return useSyncExternalStore(chatStore.subscribe, read, read);
}
