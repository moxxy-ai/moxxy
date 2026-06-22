import { useCallback, useMemo } from 'react';
import type { UseScheduler } from '@moxxy/client-core';
import { normalizeScheduleForMobile, type MobileSchedule } from '../schedulerUi';

export interface MobileSchedulerActions {
  readonly refresh: () => void;
  readonly setEnabled: (id: string, enabled: boolean) => void;
  readonly deleteSchedule: (id: string) => void;
}

export interface MobileSchedulerStore extends MobileSchedulerActions {
  readonly schedules: ReadonlyArray<MobileSchedule>;
  readonly loading: boolean;
  readonly error: string | null;
}

export function normalizeMobileSchedules(
  list: UseScheduler['list'],
): ReadonlyArray<MobileSchedule> {
  return list.map((schedule, index) =>
    normalizeScheduleForMobile(schedule as unknown as Record<string, unknown>, index),
  );
}

export function buildMobileSchedulerStore(input: {
  readonly schedules: ReadonlyArray<MobileSchedule>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly actions: MobileSchedulerActions;
}): MobileSchedulerStore {
  return {
    schedules: input.schedules,
    loading: input.loading,
    error: input.error,
    refresh: input.actions.refresh,
    setEnabled: input.actions.setEnabled,
    deleteSchedule: input.actions.deleteSchedule,
  };
}

export const disconnectedMobileSchedulerStore: MobileSchedulerStore = buildMobileSchedulerStore({
  schedules: [],
  loading: false,
  error: null,
  actions: {
    refresh: () => undefined,
    setEnabled: () => undefined,
    deleteSchedule: () => undefined,
  },
});

export function useMobileScheduler(coreScheduler: UseScheduler): MobileSchedulerStore {
  const schedules = useMemo(
    () => normalizeMobileSchedules(coreScheduler.list),
    [coreScheduler.list],
  );
  const refresh = useCallback(() => {
    void coreScheduler.refresh();
  }, [coreScheduler.refresh]);
  const setEnabled = useCallback(
    (id: string, enabled: boolean) => {
      void coreScheduler.setEnabled(id, enabled);
    },
    [coreScheduler.setEnabled],
  );
  const deleteSchedule = useCallback(
    (id: string) => {
      void coreScheduler.deleteSchedule(id);
    },
    [coreScheduler.deleteSchedule],
  );

  return useMemo(
    () =>
      buildMobileSchedulerStore({
        schedules,
        loading: coreScheduler.loading,
        error: coreScheduler.error,
        actions: { refresh, setEnabled, deleteSchedule },
      }),
    [
      coreScheduler.error,
      coreScheduler.loading,
      deleteSchedule,
      refresh,
      schedules,
      setEnabled,
    ],
  );
}
