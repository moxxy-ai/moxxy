import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { useScheduler } from './useScheduler.js';
import type { MoxxyApi, ScheduleSummary } from '@moxxy/desktop-ipc-contract';

function fakeApi(invoke: MoxxyApi['invoke']): MoxxyApi {
  return { invoke, subscribe: () => () => {} };
}

afterEach(() => __setApiOverride(null));

const sample: ScheduleSummary = {
  id: 'sched-daily',
  name: 'daily-summary',
  enabled: true,
  cron: '0 8 * * *',
  runAt: null,
  timeZone: 'Europe/Warsaw',
  channel: 'inbox',
  model: 'openai-codex/gpt-5.4',
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

describe('useScheduler', () => {
  it('loads schedules on mount', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'scheduler.list') return [sample];
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useScheduler());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.list).toEqual([sample]);
    expect(invoke).toHaveBeenCalledWith('scheduler.list');
  });

  it('refreshes after toggling an existing schedule', async () => {
    let enabled = true;
    const invoke = vi.fn(async (cmd: string, args?: unknown) => {
      if (cmd === 'scheduler.list') return [{ ...sample, enabled }];
      if (cmd === 'scheduler.setEnabled') {
        enabled = (args as { enabled: boolean }).enabled;
        return { ...sample, enabled };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useScheduler());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setEnabled('sched-daily', false);
    });

    expect(result.current.list[0]?.enabled).toBe(false);
    expect(invoke).toHaveBeenCalledWith('scheduler.setEnabled', {
      id: 'sched-daily',
      enabled: false,
    });
  });

  it('removes a deleted schedule after the host confirms deletion', async () => {
    let deleted = false;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'scheduler.list') return deleted ? [] : [sample];
      if (cmd === 'scheduler.delete') {
        deleted = true;
        return { deleted: true };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useScheduler());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteSchedule('sched-daily');
    });

    expect(result.current.list).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('scheduler.delete', { id: 'sched-daily' });
  });
});
