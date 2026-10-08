import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopy } from './useCopy';

/**
 * Copying, and saying so for a moment. The system clipboard is the one thing
 * replaced here: jsdom has none.
 */

const writeText = vi.fn(async (_text: string) => undefined);

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useCopy', () => {
  it('puts the text on the clipboard and says so for a moment', async () => {
    const { result } = renderHook(() => useCopy());
    expect(result.current.copied).toBe(false);
    await act(() => result.current.copy('hello'));
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.copied).toBe(false);
  });

  it('does not claim a copy the clipboard refused', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const { result } = renderHook(() => useCopy());
    await act(() => result.current.copy('hello'));
    expect(result.current.copied).toBe(false);
  });

  it('leaves no timer behind when its owner goes away', async () => {
    const { result, unmount } = renderHook(() => useCopy());
    await act(() => result.current.copy('hello'));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
