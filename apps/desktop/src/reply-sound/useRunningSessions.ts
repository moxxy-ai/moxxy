import { useMemo, useSyncExternalStore } from 'react';
import { chatStore } from '@moxxy/client-core';
import { turnInFlight } from '@/lib/turn-in-flight';

/** No session id holds a line break, so it can stand between them. */
const BETWEEN = '\n';

/**
 * Which of `ids` are answering. The store ticks on every streamed chunk; the
 * result changes identity only when a chat starts or stops answering.
 */
export function useRunningSessions(ids: ReadonlySet<string>): ReadonlySet<string> {
  const read = (): string => [...ids].filter((id) => turnInFlight(chatStore.getChat(id))).join(BETWEEN);
  const key = useSyncExternalStore(chatStore.subscribe, read, read);
  return useMemo(() => new Set(key === '' ? [] : key.split(BETWEEN)), [key]);
}
