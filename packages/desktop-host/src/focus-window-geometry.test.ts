import { describe, expect, it } from 'vitest';
import {
  moveFocusBounds,
  moveFocusBoundsFromPointer,
  resizeFocusBounds,
} from './focus-window-geometry';

const workArea = { x: 0, y: 0, width: 1000, height: 800 };

describe('focus-window geometry', () => {
  it('resizes from the right edge when the widget is on the right half', () => {
    const result = resizeFocusBounds({
      current: { x: 932, y: 700, width: 44, height: 44 },
      nextSize: { width: 220, height: 52 },
      workArea,
    });

    expect(result.horizontalAnchor).toBe('right');
    expect(result.bounds).toEqual({ x: 756, y: 696, width: 220, height: 52 });
  });

  it('resizes from the left edge when the widget is on the left half', () => {
    const result = resizeFocusBounds({
      current: { x: 24, y: 700, width: 44, height: 44 },
      nextSize: { width: 220, height: 52 },
      workArea,
    });

    expect(result.horizontalAnchor).toBe('left');
    expect(result.bounds).toEqual({ x: 24, y: 696, width: 220, height: 52 });
  });

  it('clamps moved bounds to the work area and reports the final anchor', () => {
    const result = moveFocusBounds({
      current: { x: 960, y: 780, width: 44, height: 44 },
      delta: { dx: 200, dy: 200 },
      workArea,
    });

    expect(result.horizontalAnchor).toBe('right');
    expect(result.bounds).toEqual({ x: 952, y: 752, width: 44, height: 44 });
  });

  it('keeps the left anchor when a moved widget ends on the left half', () => {
    const result = moveFocusBounds({
      current: { x: 300, y: 300, width: 44, height: 44 },
      delta: { dx: -500, dy: -500 },
      workArea,
    });

    expect(result.horizontalAnchor).toBe('left');
    expect(result.bounds).toEqual({ x: 4, y: 4, width: 44, height: 44 });
  });

  it('moves from the drag origin to the latest screen pointer instead of accumulating stale deltas', () => {
    const result = moveFocusBoundsFromPointer({
      dragStart: {
        bounds: { x: 600, y: 400, width: 44, height: 44 },
        pointer: { screenX: 620, screenY: 420 },
      },
      pointer: { screenX: 700, screenY: 480 },
      workArea,
    });

    expect(result.horizontalAnchor).toBe('right');
    expect(result.bounds).toEqual({ x: 680, y: 460, width: 44, height: 44 });
  });
});
