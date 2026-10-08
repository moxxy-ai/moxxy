export type TipSide = 'right' | 'left' | 'bottom' | 'top';

export interface TipBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface TipSize {
  readonly width: number;
  readonly height: number;
}

export interface TipPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: TipSide;
}

/** Space between the control and its bubble. */
const GAP = 8;
/** The closest the bubble comes to the window's edge. */
const MARGIN = 8;

const OPPOSITE: Record<TipSide, TipSide> = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' };

function onSide(anchor: TipBox, bubble: TipSize, side: TipSide): { left: number; top: number } {
  const centredLeft = anchor.left + (anchor.width - bubble.width) / 2;
  const centredTop = anchor.top + (anchor.height - bubble.height) / 2;
  if (side === 'right') return { left: anchor.left + anchor.width + GAP, top: centredTop };
  if (side === 'left') return { left: anchor.left - GAP - bubble.width, top: centredTop };
  if (side === 'bottom') return { left: centredLeft, top: anchor.top + anchor.height + GAP };
  return { left: centredLeft, top: anchor.top - GAP - bubble.height };
}

/** Whether the bubble fits between the window's edges on the axis it leaves the control by. */
function fits(at: { left: number; top: number }, bubble: TipSize, viewport: TipSize, side: TipSide): boolean {
  if (side === 'right' || side === 'left') {
    return at.left >= MARGIN && at.left + bubble.width <= viewport.width - MARGIN;
  }
  return at.top >= MARGIN && at.top + bubble.height <= viewport.height - MARGIN;
}

function clamp(value: number, size: number, limit: number): number {
  return Math.max(MARGIN, Math.min(value, limit - size - MARGIN));
}

/**
 * Where a tooltip goes: on the side asked for, on the opposite one when the
 * window's edge is in the way, and always inside the window.
 */
export function placeTip(anchor: TipBox, bubble: TipSize, viewport: TipSize, preferred: TipSide): TipPlacement {
  const side = fits(onSide(anchor, bubble, preferred), bubble, viewport, preferred)
    ? preferred
    : fits(onSide(anchor, bubble, OPPOSITE[preferred]), bubble, viewport, OPPOSITE[preferred])
      ? OPPOSITE[preferred]
      : preferred;
  const at = onSide(anchor, bubble, side);
  return {
    left: Math.round(clamp(at.left, bubble.width, viewport.width)),
    top: Math.round(clamp(at.top, bubble.height, viewport.height)),
    side,
  };
}
