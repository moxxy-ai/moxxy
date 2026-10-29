/**
 * Everything the Schedules screen does, so the screen itself only draws: the
 * list (read again every 30 s, as often as the scheduler checks), the two
 * groups it is split into, the New schedule dialog and the delete that asks first.
 */

import { useCallback, useState } from 'react';
import { useScheduler, type UseScheduler } from '@moxxy/client-core';
import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { nextFireSummary } from './schedule-labels';

const REFRESH_EVERY_MS = 30_000;

export interface SchedulesPanelState {
  readonly scheduler: UseScheduler;
  /** Made here, by the person or the agent: these can be edited and deleted. */
  readonly yours: ReadonlyArray<ScheduleSummary>;
  /** Kept in step with a workflow or a skill, which is where they change. */
  readonly linked: ReadonlyArray<ScheduleSummary>;
  readonly nextRun: string;
  readonly creating: boolean;
  readonly openCreate: () => void;
  readonly closeCreate: () => void;
  readonly pendingDelete: ScheduleSummary | null;
  readonly askDelete: (schedule: ScheduleSummary) => void;
  readonly cancelDelete: () => void;
  readonly confirmDelete: () => void;
}

export function useSchedulesPanel(): SchedulesPanelState {
  const scheduler = useScheduler({ refreshEveryMs: REFRESH_EVERY_MS });
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScheduleSummary | null>(null);
  const { deleteSchedule } = scheduler;

  const confirmDelete = useCallback(() => {
    if (pendingDelete) void deleteSchedule(pendingDelete.id);
    setPendingDelete(null);
  }, [pendingDelete, deleteSchedule]);

  return {
    scheduler,
    yours: scheduler.list.filter((s) => s.source === 'manual'),
    linked: scheduler.list.filter((s) => s.source !== 'manual'),
    nextRun: nextFireSummary(scheduler.list),
    creating,
    openCreate: useCallback(() => setCreating(true), []),
    closeCreate: useCallback(() => setCreating(false), []),
    pendingDelete,
    askDelete: setPendingDelete,
    cancelDelete: useCallback(() => setPendingDelete(null), []),
    confirmDelete,
  };
}
