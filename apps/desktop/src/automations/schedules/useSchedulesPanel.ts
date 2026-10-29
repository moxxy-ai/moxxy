/**
 * Everything the Schedules screen does, so the screen itself only draws: the
 * list (read again every 30 s, as often as the scheduler checks, and just
 * after the soonest run starts), the two
 * groups it is split into, the New schedule dialog and the delete that asks first.
 */

import { useCallback, useState } from 'react';
import { useDesks, useScheduler, type UseScheduler } from '@moxxy/client-core';
import type { Desk, ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { nextFireSummary, soonestFireAt } from './schedule-labels';
import { useRefreshAfterNextRun } from './useRefreshAfterNextRun';

const REFRESH_EVERY_MS = 30_000;

export interface SchedulesPanelState {
  readonly scheduler: UseScheduler;
  /** Made here, by the person or the agent: these can be edited and deleted. */
  readonly yours: ReadonlyArray<ScheduleSummary>;
  /** Kept in step with a workflow or a skill, which is where they change. */
  readonly linked: ReadonlyArray<ScheduleSummary>;
  readonly nextRun: string;
  /** The chat the person is in: where a new schedule runs unless they pick another. */
  readonly currentChatId: string | null;
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
  const { desks, activeId } = useDesks();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScheduleSummary | null>(null);
  const { deleteSchedule } = scheduler;
  useRefreshAfterNextRun(soonestFireAt(scheduler.list), scheduler.refresh);

  const confirmDelete = useCallback(() => {
    if (pendingDelete) void deleteSchedule(pendingDelete.id);
    setPendingDelete(null);
  }, [pendingDelete, deleteSchedule]);

  return {
    scheduler,
    yours: scheduler.list.filter((s) => s.source === 'manual'),
    linked: scheduler.list.filter((s) => s.source !== 'manual'),
    nextRun: nextFireSummary(scheduler.list),
    currentChatId: currentChatId(desks, activeId),
    creating,
    openCreate: useCallback(() => setCreating(true), []),
    closeCreate: useCallback(() => setCreating(false), []),
    pendingDelete,
    askDelete: setPendingDelete,
    cancelDelete: useCallback(() => setPendingDelete(null), []),
    confirmDelete,
  };
}

/** The session the active desk shows, when it is still one of its sessions. */
function currentChatId(desks: ReadonlyArray<Desk>, activeDeskId: string | null): string | null {
  const desk = desks.find((d) => d.id === activeDeskId);
  const id = desk?.activeSessionId ?? null;
  return id !== null && desk!.sessions.some((s) => s.id === id) ? id : null;
}
