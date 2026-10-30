import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { __resetSchedulerStoreForTests, useScheduler } from './useScheduler.js';
import type { MoxxyApi, ScheduleSummary } from '@moxxy/desktop-ipc-contract';

function fakeApi(invoke: MoxxyApi['invoke']): MoxxyApi {
  return { invoke, subscribe: () => () => {} };
}

afterEach(() => {
  __setApiOverride(null);
  __resetSchedulerStoreForTests();
});

const sample: ScheduleSummary = {
  id: 'sched-daily',
  name: 'daily-summary',
  enabled: true,
  cron: '0 8 * * *',
  runAt: null,
  timeZone: 'Europe/Warsaw',
  channel: 'inbox',
  model: 'codex-agent/gpt-5.4',
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

  it('adds a created schedule and hands it back to the form', async () => {
    const created: ScheduleSummary = { ...sample, id: 'sched-new', name: 'book-night' };
    let saved = false;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'scheduler.list') return saved ? [sample, created] : [sample];
      if (cmd === 'scheduler.create') {
        saved = true;
        return created;
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useScheduler());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const input = { name: 'book-night', prompt: 'Continue the book', cron: '*/30 * * * *' };
    let outcome: Awaited<ReturnType<typeof result.current.create>> | undefined;
    await act(async () => {
      outcome = await result.current.create(input);
    });

    expect(outcome).toEqual({ ok: true, schedule: created });
    expect(invoke).toHaveBeenCalledWith('scheduler.create', input);
    expect(result.current.list.map((s) => s.id)).toEqual(['sched-daily', 'sched-new']);
    expect(result.current.error).toBeNull();
  });

  it('gives the form the reason a schedule was refused, without breaking the list', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'scheduler.list') return [sample];
      if (cmd === 'scheduler.create') {
        throw new Error(
          'Error invoking remote method: Error: MOXXY_IPC_ERR:{"code":"invalid-payload","message":"this time window already ended"}',
        );
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useScheduler());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.create>> | undefined;
    await act(async () => {
      outcome = await result.current.create({ name: 'late', prompt: 'p', cron: '* * * * *', endAt: 1 });
    });

    expect(outcome).toEqual({ ok: false, error: 'this time window already ended' });
    expect(result.current.list).toEqual([sample]);
    expect(result.current.error).toBeNull();
  });

  it('reads the list again on its own, so runs and changes made elsewhere show up', async () => {
    let calls = 0;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'scheduler.list') return calls++ === 0 ? [] : [sample];
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result, unmount } = renderHook(() => useScheduler({ refreshEveryMs: 20 }));

    await waitFor(() => expect(result.current.list).toEqual([sample]));
    unmount();
    const after = invoke.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(invoke.mock.calls.length).toBe(after);
  });

  it('keeps one list for every place that shows schedules (the sidebar and the screen)', async () => {
    const created: ScheduleSummary = { ...sample, id: 'sched-new', name: 'book-night' };
    let saved = false;
    let enabled = true;
    const invoke = vi.fn(async (cmd: string, args?: unknown) => {
      if (cmd === 'scheduler.list') return saved ? [{ ...sample, enabled }, created] : [{ ...sample, enabled }];
      if (cmd === 'scheduler.create') {
        saved = true;
        return created;
      }
      if (cmd === 'scheduler.setEnabled') {
        enabled = (args as { enabled: boolean }).enabled;
        return { ...sample, enabled };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const sidebar = renderHook(() => useScheduler());
    const screen = renderHook(() => useScheduler());
    await waitFor(() => expect(sidebar.result.current.loading).toBe(false));

    await act(async () => {
      await screen.result.current.create({ name: 'book-night', prompt: 'p', cron: '* * * * *' });
    });
    expect(sidebar.result.current.list.map((s) => s.id)).toEqual(['sched-daily', 'sched-new']);

    await act(async () => {
      await screen.result.current.setEnabled('sched-daily', false);
    });
    expect(sidebar.result.current.list[0]?.enabled).toBe(false);
  });
});
