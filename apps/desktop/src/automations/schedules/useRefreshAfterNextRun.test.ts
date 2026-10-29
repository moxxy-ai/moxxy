import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { LATE_RUN_WATCH_MS, RUN_SETTLE_MS, useRefreshAfterNextRun } from './useRefreshAfterNextRun';

const now = new Date(2026, 9, 29, 12, 0).getTime();

describe('useRefreshAfterNextRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it('reads the list again a few seconds after the soonest run starts', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshAfterNextRun(now + 7_000, refresh));
    vi.advanceTimersByTime(7_000 + RUN_SETTLE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('waits only the settle time for a run whose moment just came, and leaves an old one to the poll', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshAfterNextRun(now - 20_000, refresh));
    vi.advanceTimersByTime(RUN_SETTLE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    const stale = vi.fn();
    renderHook(() => useRefreshAfterNextRun(Date.now() - LATE_RUN_WATCH_MS - 1, stale));
    vi.advanceTimersByTime(60_000);
    expect(stale).not.toHaveBeenCalled();
  });

  it('keeps reading every few seconds while the run is late, for as long as one scheduler check', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshAfterNextRun(now, refresh));
    vi.advanceTimersByTime(RUN_SETTLE_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(LATE_RUN_WATCH_MS);
    const calls = refresh.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(Math.ceil(LATE_RUN_WATCH_MS / RUN_SETTLE_MS) + 1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(calls);
  });

  it('does nothing when no run is planned, and forgets a run that changed', () => {
    const refresh = vi.fn();
    const hook = renderHook(({ at }) => useRefreshAfterNextRun(at, refresh), {
      initialProps: { at: null as number | null },
    });
    vi.advanceTimersByTime(60 * 60_000);
    expect(refresh).not.toHaveBeenCalled();

    hook.rerender({ at: now + 60 * 60_000 + 5_000 });
    hook.rerender({ at: null });
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    hook.unmount();
  });
});
