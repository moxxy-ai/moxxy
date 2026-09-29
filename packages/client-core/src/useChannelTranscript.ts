import { useCallback, useEffect, useRef, useState } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';

export interface UseChannelTranscript {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly hasOlder: boolean;
  readonly loadOlder: () => Promise<void>;
}

const DEFAULT_PAGE_SIZE = 200;

/** Replace the tail with the freshly read latest page; keep older loaded pages. */
function mergeLatest(current: ReadonlyArray<MoxxyEvent>, latest: ReadonlyArray<MoxxyEvent>): MoxxyEvent[] {
  const first = latest[0];
  if (!first) return [...current];
  return [...current.filter((e) => e.seq < first.seq), ...latest];
}

/**
 * A channel bot's conversation, read-only (`channels.history`): the latest page
 * on open, re-read whenever the host reports the log changed
 * (`channels.historyChanged`), older pages on demand. The bot lives in its own
 * process, so this never sends — it mirrors what the bot has persisted.
 */
export function useChannelTranscript(
  channelId: string,
  opts: { readonly pageSize?: number } = {},
): UseChannelTranscript {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const [events, setEvents] = useState<ReadonlyArray<MoxxyEvent>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cursor of the OLDEST loaded page; refreshing the tail must not reset it.
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const loadedAny = useRef(false);

  const refreshLatest = useCallback(async (): Promise<void> => {
    try {
      const page = await api().invoke('channels.history', { channelId, before: null, limit: pageSize });
      setEvents((cur) => mergeLatest(cur, page?.events ?? []));
      if (!loadedAny.current) {
        loadedAny.current = true;
        setOlderCursor(page?.prevCursor ?? null);
      }
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [channelId, pageSize]);

  useEffect(() => {
    void refreshLatest();
  }, [refreshLatest]);

  useEffect(
    () =>
      api().subscribe('channels.historyChanged', (p) => {
        if (p.channelId === channelId) void refreshLatest();
      }),
    [channelId, refreshLatest],
  );

  const loadOlder = useCallback(async (): Promise<void> => {
    if (olderCursor === null) return;
    try {
      const page = await api().invoke('channels.history', { channelId, before: olderCursor, limit: pageSize });
      setEvents((cur) => [...(page?.events ?? []), ...cur]);
      setOlderCursor(page?.prevCursor ?? null);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, [channelId, olderCursor, pageSize]);

  return { events, loading, error, hasOlder: olderCursor !== null, loadOlder };
}
