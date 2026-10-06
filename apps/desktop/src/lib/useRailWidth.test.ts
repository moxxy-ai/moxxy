import { describe, expect, it } from 'vitest';
import { CHAT_MIN_WIDTH, RAIL_MIN_WIDTH, benchWidthLimit, setRailWidth, useRailWidth } from './useRailWidth';
import { renderHook } from '@testing-library/react';

/**
 * The workbench used to keep whatever width it was dragged to, up to a fixed
 * 860 px, with nothing to say the chat beside it needed room too. On a window
 * a little over 1100 px wide that left the chat 26 px — its header painted over
 * the workbench tabs — and on a wide screen it stopped the browser short of the
 * space that was there.
 */
describe('benchWidthLimit', () => {
  it('lets the workbench take everything the chat can spare', () => {
    expect(benchWidthLimit(600, 1000)).toBe(600 + 1000 - CHAT_MIN_WIDTH);
  });

  it('never asks the workbench to be narrower than its own minimum', () => {
    expect(benchWidthLimit(RAIL_MIN_WIDTH, 100)).toBe(RAIL_MIN_WIDTH);
  });
});

describe('setRailWidth', () => {
  it('keeps a width past the old 860 px cap, so a wide window can give the browser its room', () => {
    const { result, rerender } = renderHook(() => useRailWidth());
    setRailWidth(1400);
    rerender();
    expect(result.current).toBe(1400);
  });

  it('still refuses a width below the minimum', () => {
    const { result, rerender } = renderHook(() => useRailWidth());
    setRailWidth(10);
    rerender();
    expect(result.current).toBe(RAIL_MIN_WIDTH);
  });
});
