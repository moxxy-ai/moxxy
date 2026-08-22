import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRegionSelect } from './useRegionSelect.js';

/**
 * Dragging a rectangle over the page to crop a screenshot to it.
 *
 * The maths is small and the mistakes are not: a drag that starts bottom-right
 * and ends top-left is the same rectangle, a stray click is not a rectangle at
 * all, and the numbers have to come out in the page's own coordinates rather
 * than the screen's or the crop lands somewhere else entirely.
 */
const at = (x: number, y: number): PointerEvent =>
  ({ clientX: x, clientY: y, pointerId: 1, preventDefault: () => {} }) as unknown as PointerEvent;

/** The overlay sits over the page; its top-left is where page coordinates start. */
const box = (left = 100, top = 50) =>
  ({ current: { getBoundingClientRect: () => ({ left, top, width: 800, height: 600 }) } }) as never;

describe('useRegionSelect', () => {
  it('reports the rectangle in the page\'s coordinates, not the screen\'s', () => {
    const onPick = vi.fn();
    const { result } = renderHook(() => useRegionSelect({ active: true, surface: box(), onPick }));

    act(() => result.current.handlers.onPointerDown(at(150, 100)));
    act(() => result.current.handlers.onPointerMove(at(250, 300)));
    act(() => result.current.handlers.onPointerUp(at(250, 300)));

    // 150-100 = 50 across, 100-50 = 50 down, 100 wide, 200 tall.
    expect(onPick).toHaveBeenCalledWith({ x: 50, y: 50, width: 100, height: 200 });
  });

  it('does not care which corner the drag started from', () => {
    const onPick = vi.fn();
    const { result } = renderHook(() => useRegionSelect({ active: true, surface: box(), onPick }));

    act(() => result.current.handlers.onPointerDown(at(250, 300)));
    act(() => result.current.handlers.onPointerUp(at(150, 100)));

    expect(onPick).toHaveBeenCalledWith({ x: 50, y: 50, width: 100, height: 200 });
  });

  it('treats a click with no drag as a cancel, not an empty crop', () => {
    const onPick = vi.fn();
    const { result } = renderHook(() => useRegionSelect({ active: true, surface: box(), onPick }));

    act(() => result.current.handlers.onPointerDown(at(150, 100)));
    act(() => result.current.handlers.onPointerUp(at(152, 101)));

    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('offers the rectangle while it is being drawn, so it can be shown', () => {
    const { result } = renderHook(() => useRegionSelect({ active: true, surface: box(), onPick: vi.fn() }));

    act(() => result.current.handlers.onPointerDown(at(150, 100)));
    act(() => result.current.handlers.onPointerMove(at(250, 300)));

    expect(result.current.rect).toEqual({ x: 50, y: 50, width: 100, height: 200 });
  });

  it('forgets the rectangle once the drag is over', () => {
    const { result } = renderHook(() => useRegionSelect({ active: true, surface: box(), onPick: vi.fn() }));

    act(() => result.current.handlers.onPointerDown(at(150, 100)));
    act(() => result.current.handlers.onPointerMove(at(250, 300)));
    act(() => result.current.handlers.onPointerUp(at(250, 300)));

    expect(result.current.rect).toBeNull();
  });

  it('keeps a drag that runs off the top-left on the page', () => {
    const onPick = vi.fn();
    const { result } = renderHook(() => useRegionSelect({ active: true, surface: box(), onPick }));

    act(() => result.current.handlers.onPointerDown(at(150, 100)));
    // Pointer capture keeps delivering once the drag leaves the overlay, so a
    // person overshooting the top edge produced a negative origin — which the
    // capture command rejects outright: "clip.y: Number must be >= 0".
    act(() => result.current.handlers.onPointerUp(at(60, 20)));

    expect(onPick).toHaveBeenCalledWith({ x: 0, y: 0, width: 50, height: 50 });
  });

  it('stops a drag that runs off the bottom-right at the page edge', () => {
    const onPick = vi.fn();
    const { result } = renderHook(() => useRegionSelect({ active: true, surface: box(), onPick }));

    act(() => result.current.handlers.onPointerDown(at(150, 100)));
    act(() => result.current.handlers.onPointerUp(at(2000, 2000)));

    // The page is 800 x 600, so a crop can reach its corner and no further.
    expect(onPick).toHaveBeenCalledWith({ x: 50, y: 50, width: 750, height: 550 });
  });

  it('does nothing at all while it is not turned on', () => {
    const onPick = vi.fn();
    const { result } = renderHook(() => useRegionSelect({ active: false, surface: box(), onPick }));

    act(() => result.current.handlers.onPointerDown(at(150, 100)));
    act(() => result.current.handlers.onPointerUp(at(250, 300)));

    expect(onPick).not.toHaveBeenCalled();
    expect(result.current.rect).toBeNull();
  });

  it('cancels on Escape rather than trapping the person in selection mode', () => {
    const onPick = vi.fn();
    const { result } = renderHook(() => useRegionSelect({ active: true, surface: box(), onPick }));

    act(() => result.current.handlers.onPointerDown(at(150, 100)));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onPick).toHaveBeenCalledWith(null);
    expect(result.current.rect).toBeNull();
  });
});
