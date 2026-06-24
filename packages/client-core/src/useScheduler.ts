import { useCallback, useEffect, useState } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';

export interface UseScheduler {
  readonly list: ReadonlyArray<ScheduleSummary>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Reassign which session a schedule fires in (where its run runs +
   *  display), or pass `null` to clear the binding. */
  readonly setTargetSession: (id: string, sessionId: string | null) => Promise<void>;
  readonly deleteSchedule: (id: string) => Promise<void>;
}

export function useScheduler(): UseScheduler {
  const [list, setList] = useState<ReadonlyArray<ScheduleSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const next = await api().invoke('scheduler.list');
      setList(next);
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      setList((cur) => cur.map((schedule) => (schedule.id === id ? { ...schedule, enabled } : schedule)));
      try {
        const updated = await api().invoke('scheduler.setEnabled', { id, enabled });
        if (updated) {
          setList((cur) => cur.map((schedule) => (schedule.id === id ? updated : schedule)));
        }
        await refresh();
      } catch (e) {
        setList((cur) => cur.map((schedule) => (schedule.id === id ? { ...schedule, enabled: !enabled } : schedule)));
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  const setTargetSession = useCallback(
    async (id: string, sessionId: string | null): Promise<void> => {
      try {
        const updated = await api().invoke('scheduler.setTargetSession', { id, sessionId });
        if (updated) setList((cur) => cur.map((s) => (s.id === id ? updated : s)));
        await refresh();
      } catch (e) {
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  const deleteSchedule = useCallback(
    async (id: string): Promise<void> => {
      try {
        const result = await api().invoke('scheduler.delete', { id });
        if (result.deleted) {
          setList((cur) => cur.filter((schedule) => schedule.id !== id));
        }
        await refresh();
      } catch (e) {
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  return { list, loading, error, refresh, setEnabled, setTargetSession, deleteSchedule };
}
