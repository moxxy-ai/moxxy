import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Desk, DesksOverview } from '@shared/ipc';

export interface UseDesks {
  readonly desks: ReadonlyArray<Desk>;
  readonly activeId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly create: (name: string) => Promise<Desk | null>;
  readonly remove: (id: string) => Promise<void>;
  readonly setActive: (id: string) => Promise<void>;
  readonly pickFolder: () => Promise<string | null>;
}

const EMPTY: DesksOverview = { desks: [], activeId: null };

export function useDesks(): UseDesks {
  const [overview, setOverview] = useState<DesksOverview>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const next = await api().invoke('desks.list');
      setOverview(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pickFolder = useCallback(
    async (): Promise<string | null> => api().invoke('desks.pickFolder'),
    [],
  );

  const create = useCallback(
    async (name: string): Promise<Desk | null> => {
      const cwd = await pickFolder();
      if (!cwd) return null;
      try {
        const desk = await api().invoke('desks.create', { name, cwd });
        await refresh();
        return desk;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [pickFolder, refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        await api().invoke('desks.remove', { id });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh],
  );

  const setActive = useCallback(
    async (id: string): Promise<void> => {
      // Optimistic: flip the active id immediately so the sidebar
      // highlight follows the click without waiting for the IPC + the
      // supervisor's full re-resolve. We still refresh after — the IPC
      // is the source of truth and corrects any drift.
      const prev = overview.activeId;
      setOverview((o) => ({ ...o, activeId: id }));
      try {
        await api().invoke('desks.setActive', { id });
        await refresh();
      } catch (e) {
        setOverview((o) => ({ ...o, activeId: prev }));
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [overview.activeId, refresh],
  );

  return {
    desks: overview.desks,
    activeId: overview.activeId,
    loading,
    error,
    refresh,
    create,
    remove,
    setActive,
    pickFolder,
  };
}
