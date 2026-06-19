import { describe, expect, it } from 'vitest';
import type { UseScheduler } from '@moxxy/client-core';
import {
  buildMobileSchedulerStore,
  normalizeMobileSchedules,
} from '../mobile/src/hooks/useMobileScheduler';

const sample: UseScheduler['list'][number] = {
  id: 'sched-daily',
  name: 'daily-summary',
  enabled: true,
  cron: '0 8 * * *',
  runAt: null,
  timeZone: 'Europe/Warsaw',
  channel: null,
  model: null,
  promptPreview: 'Prepare the daily summary',
  source: 'manual',
  skillName: null,
  workflowName: null,
  createdAt: 1_780_000_000_000,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  nextFireAt: 1_780_010_000_000,
  nextFireIso: '2026-06-19T08:00:00.000Z',
};

describe('useMobileScheduler', () => {
  it('keeps action callbacks stable when refreshed schedule data changes', () => {
    let refreshCalls = 0;
    let toggleArgs: { id: string; enabled: boolean } | null = null;
    let deletedId: string | null = null;
    const refresh = () => {
      refreshCalls += 1;
    };
    const setEnabled = (id: string, enabled: boolean) => {
      toggleArgs = { id, enabled };
    };
    const deleteSchedule = (id: string) => {
      deletedId = id;
    };
    const actions = { refresh, setEnabled, deleteSchedule };

    const first = buildMobileSchedulerStore({
      schedules: normalizeMobileSchedules([sample]),
      loading: false,
      error: null,
      actions,
    });
    const second = buildMobileSchedulerStore({
      schedules: normalizeMobileSchedules([{ ...sample, enabled: false }]),
      loading: false,
      error: null,
      actions,
    });

    expect(second.refresh).toBe(first.refresh);
    expect(second.setEnabled).toBe(first.setEnabled);
    expect(second.deleteSchedule).toBe(first.deleteSchedule);

    second.refresh();
    second.setEnabled('sched-daily', true);
    second.deleteSchedule('sched-daily');

    expect(refreshCalls).toBe(1);
    expect(toggleArgs).toEqual({ id: 'sched-daily', enabled: true });
    expect(deletedId).toBe('sched-daily');
  });
});
