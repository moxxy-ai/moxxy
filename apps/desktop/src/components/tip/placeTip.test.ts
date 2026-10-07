import { describe, expect, it } from 'vitest';
import { placeTip } from './placeTip';

/**
 * Where a tooltip sits. It is drawn over the whole window, so the only thing
 * that may move it off its preferred side is the window's own edge.
 */

const VIEWPORT = { width: 800, height: 600 };
const BUBBLE = { width: 100, height: 24 };

describe('placeTip', () => {
  it('sits beside the control on the side asked for, centred on it', () => {
    const anchor = { left: 100, top: 100, width: 30, height: 30 };
    expect(placeTip(anchor, BUBBLE, VIEWPORT, 'right')).toEqual({ left: 138, top: 103, side: 'right' });
    expect(placeTip(anchor, BUBBLE, VIEWPORT, 'bottom')).toEqual({ left: 65, top: 138, side: 'bottom' });
  });

  it('flips to the other side when the window edge is in the way', () => {
    const nearRightEdge = { left: 760, top: 100, width: 30, height: 30 };
    expect(placeTip(nearRightEdge, BUBBLE, VIEWPORT, 'right')).toMatchObject({ left: 652, side: 'left' });
    const nearBottomEdge = { left: 300, top: 570, width: 30, height: 24 };
    expect(placeTip(nearBottomEdge, BUBBLE, VIEWPORT, 'bottom')).toMatchObject({ top: 538, side: 'top' });
  });

  it('slides along the edge instead of leaving the window', () => {
    // Centred under a control in the corner it would hang off the right edge.
    const corner = { left: 770, top: 10, width: 24, height: 24 };
    const placed = placeTip(corner, BUBBLE, VIEWPORT, 'bottom');
    expect(placed.side).toBe('bottom');
    expect(placed.left).toBe(692);
    expect(placed.left + BUBBLE.width).toBeLessThanOrEqual(VIEWPORT.width - 8);
  });

  it('never leaves the window, even when no side has room', () => {
    const wide = { width: 780, height: 24 };
    const placed = placeTip({ left: 400, top: 300, width: 20, height: 20 }, wide, VIEWPORT, 'right');
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + wide.width).toBeLessThanOrEqual(VIEWPORT.width - 8);
  });
});
