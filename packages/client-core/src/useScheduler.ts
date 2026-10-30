import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import { createPatchStore } from './externalStore.js';
import type { ScheduleCreateInput, ScheduleSummary } from '@moxxy/desktop-ipc-contract';

/** What the New schedule form gets back: the saved schedule, or why it was refused. */
export type ScheduleCreateOutcome =
  | { readonly ok: true; readonly schedule: ScheduleSummary }
  | { readonly ok: false; readonly error: string };

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
  /** Save a new schedule. A refusal comes back as the outcome (for the form to
   *  show), not as the list-wide `error`. */
  readonly create: (input: ScheduleCreateInput) => Promise<ScheduleCreateOutcome>;
}

export interface UseSchedulerOptions {
  /** Read the list again this often while mounted, so a run that finished or a
   *  change made in another window or the CLI shows up. Off when left out. */
  readonly refreshEveryMs?: number;
}

interface SchedulerState {
  readonly list: ReadonlyArray<ScheduleSummary>;
  readonly loading: boolean;
  readonly error: string | null;
}

const INITIAL: SchedulerState = { list: [], loading: true, error: null };

/**
 * One list for the whole window. The Automations sidebar and the Schedules
 * screen each call `useScheduler`; with state of their own, a schedule created,
 * paused or deleted on the screen stayed missing or stale in the sidebar.
 */
const schedulerStore = createPatchStore<SchedulerState>(INITIAL);

function setList(update: (cur: ReadonlyArray<ScheduleSummary>) => ReadonlyArray<ScheduleSummary>): void {
  schedulerStore.set({ list: update(schedulerStore.getSnapshot().list) });
}

export function __resetSchedulerStoreForTests(): void {
  schedulerStore.replace(INITIAL);
}

export function useScheduler({ refreshEveryMs }: UseSchedulerOptions = {}): UseScheduler {
  const { list, loading, error } = useSyncExternalStore(schedulerStore.subscribe, schedulerStore.getSnapshot);
  const setError = useCallback((message: string | null) => schedulerStore.set({ error: message }), []);

  const refresh = useCallback(async (): Promise<void> => {
    schedulerStore.set({ loading: true });
    try {
      const next = await api().invoke('scheduler.list');
      schedulerStore.set({ list: next, error: null });
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      schedulerStore.set({ loading: false });
    }
  }, [setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!refreshEveryMs) return undefined;
    const timer = setInterval(() => void refresh(), refreshEveryMs);
    return () => clearInterval(timer);
  }, [refresh, refreshEveryMs]);

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
    [refresh, setError],
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
    [refresh, setError],
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
    [refresh, setError],
  );

  const create = useCallback(
    async (input: ScheduleCreateInput): Promise<ScheduleCreateOutcome> => {
      let schedule: ScheduleSummary;
      try {
        schedule = await api().invoke('scheduler.create', input);
      } catch (e) {
        return { ok: false, error: toErrorMessage(e) };
      }
      setList((cur) => [...cur.filter((s) => s.id !== schedule.id), schedule]);
      await refresh();
      return { ok: true, schedule };
    },
    [refresh, setError],
  );

  return { list, loading, error, refresh, setEnabled, setTargetSession, deleteSchedule, create };
}
