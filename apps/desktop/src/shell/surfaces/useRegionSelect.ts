import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Dragging a rectangle over the page to crop a screenshot to it.
 *
 * The maths is small and the mistakes are not. A drag that starts bottom-right
 * describes the same rectangle as one that starts top-left. A click with no drag
 * is somebody changing their mind, not a zero-width crop. And the numbers have
 * to come out in the page's own coordinates — the overlay lies exactly over the
 * view, so its top-left is where the page begins, and subtracting it is the
 * whole conversion.
 *
 * Kept out of the pane so it can be driven without a `<webview>`, which a test
 * has no way to create.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Below this, a drag was a click. Two pixels of hand tremor is not a crop. */
const MIN_DRAG = 4;

export function useRegionSelect(opts: {
  readonly active: boolean;
  /** The element lying over the page; its box is the page's origin and its extent. */
  readonly surface: RefObject<{
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  } | null>;
  /** The rectangle in page coordinates, or null when the person changed their mind. */
  readonly onPick: (rect: Rect | null) => void;
}): {
  readonly rect: Rect | null;
  readonly handlers: {
    readonly onPointerDown: (e: PointerEvent) => void;
    readonly onPointerMove: (e: PointerEvent) => void;
    readonly onPointerUp: (e: PointerEvent) => void;
  };
} {
  const { active, surface } = opts;
  const [rect, setRect] = useState<Rect | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  // Read through a ref so a caller passing an inline arrow cannot restart the
  // key listener on every render.
  const onPick = useRef(opts.onPick);
  onPick.current = opts.onPick;

  /**
   * Where a screen point falls on the page, never off it.
   *
   * The clamp is not tidiness. Pointer capture keeps delivering moves after the
   * drag leaves the overlay, so overshooting the top or left edge gives a
   * negative coordinate — and the capture command refuses one outright
   * ("clip.y: Number must be greater than or equal to 0"), which reaches the
   * person as a failure in the middle of an ordinary drag. Running past an edge
   * means "select up to it", so that is what it now describes.
   */
  const toPage = useCallback(
    (e: PointerEvent): { x: number; y: number } => {
      const box = surface.current?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      };
      const onto = (value: number, start: number, extent: number): number =>
        Math.max(0, Math.min(value - start, extent));
      return { x: onto(e.clientX, box.left, box.width), y: onto(e.clientY, box.top, box.height) };
    },
    [surface],
  );

  const between = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  });

  const onPointerDown = useCallback(
    (e: PointerEvent): void => {
      if (!active) return;
      e.preventDefault?.();
      from.current = toPage(e);
      setRect(null);
    },
    [active, toPage],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent): void => {
      if (!active || !from.current) return;
      setRect(between(from.current, toPage(e)));
    },
    [active, toPage],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent): void => {
      if (!active || !from.current) return;
      const drawn = between(from.current, toPage(e));
      from.current = null;
      setRect(null);
      // A click is somebody changing their mind. Cropping to nothing would send
      // an empty picture and look like the feature is broken.
      onPick.current(drawn.width >= MIN_DRAG && drawn.height >= MIN_DRAG ? drawn : null);
    },
    [active, toPage],
  );

  // Escape gets out. A mode with no way back is a trap.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      from.current = null;
      setRect(null);
      onPick.current(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  return { rect, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}
