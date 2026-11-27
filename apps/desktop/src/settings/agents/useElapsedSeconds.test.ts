import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatElapsed, useElapsedSeconds } from './useElapsedSeconds';

describe('useElapsedSeconds', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts whole seconds while active and nothing while not', () => {
    const { result, rerender } = renderHook(({ on }) => useElapsedSeconds(on), { initialProps: { on: false } });
    expect(result.current).toBeNull();
    rerender({ on: true });
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(3);
    rerender({ on: false });
    expect(result.current).toBeNull();
  });

  it('starts again from zero on the next run', () => {
    const { result, rerender } = renderHook(({ on }) => useElapsedSeconds(on), { initialProps: { on: true } });
    act(() => vi.advanceTimersByTime(5_000));
    rerender({ on: false });
    rerender({ on: true });
    expect(result.current).toBe(0);
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [75, '1:15'],
    [600, '10:00'],
  ])('%i s reads %s', (s, text) => expect(formatElapsed(s)).toBe(text));
});
