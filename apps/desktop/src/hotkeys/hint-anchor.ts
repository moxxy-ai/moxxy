export interface HintBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The closest a hint's centre comes to the window's sides, and to its top and bottom. */
const SIDE = 28;
const EDGE = 12;

/**
 * Where a control's shortcut is written: centred on the middle of its lower
 * edge, so it reads as belonging to the control without covering its icon.
 * Null for a control that is outside the window.
 */
export function hintAnchor(
  control: HintBox,
  viewport: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } | null {
  const outside =
    control.left + control.width < 0 ||
    control.top + control.height < 0 ||
    control.left > viewport.width ||
    control.top > viewport.height;
  if (outside) return null;
  const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
  return {
    left: clamp(control.left + control.width / 2, SIDE, viewport.width - SIDE),
    top: clamp(control.top + control.height, EDGE, viewport.height - EDGE),
  };
}
