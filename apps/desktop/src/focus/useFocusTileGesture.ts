import {
  useCallback,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
} from 'react';
import { api } from '@moxxy/client-core';

export type FocusTileHorizontalAnchor = 'left' | 'right';

export interface FocusTileGestureProps {
  readonly onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerMove?: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerUp?: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerCancel?: PointerEventHandler<HTMLButtonElement>;
  readonly onMouseDown?: MouseEventHandler<HTMLButtonElement>;
  readonly onMouseMove?: MouseEventHandler<HTMLButtonElement>;
  readonly onMouseUp?: MouseEventHandler<HTMLButtonElement>;
  readonly onMouseLeave?: MouseEventHandler<HTMLButtonElement>;
  readonly onClick: MouseEventHandler<HTMLButtonElement>;
}

export interface UseFocusTileGestureResult {
  readonly dragging: boolean;
  readonly gestureProps: FocusTileGestureProps;
}

const DRAG_THRESHOLD_PX = 5;

interface PointerPoint {
  readonly pointerId: number;
  readonly screenX: number;
  readonly screenY: number;
}

export function useFocusTileGesture({
  onClick,
  onPlacement,
}: {
  readonly onClick: () => void;
  readonly onPlacement: (anchor: FocusTileHorizontalAnchor) => void;
}): UseFocusTileGestureResult {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<PointerPoint | null>(null);
  const pendingMoveRef = useRef<PointerPoint | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragStartPromiseRef = useRef<Promise<unknown> | null>(null);
  const didDragRef = useRef(false);
  const suppressClickRef = useRef(false);
  const usePointerEvents =
    typeof window !== 'undefined' && 'PointerEvent' in window;

  const reset = useCallback(() => {
    startRef.current = null;
    pendingMoveRef.current = null;
    if (rafRef.current !== null) {
      const cancel =
        typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
          ? window.cancelAnimationFrame
          : clearTimeout;
      cancel(rafRef.current);
      rafRef.current = null;
    }
    dragStartPromiseRef.current = null;
    didDragRef.current = false;
    setDragging(false);
  }, []);

  const updatePlacement = useCallback(
    (placement: { horizontalAnchor?: FocusTileHorizontalAnchor } | null | undefined) => {
      if (placement?.horizontalAnchor) onPlacement(placement.horizontalAnchor);
    },
    [onPlacement],
  );

  const startHostDrag = useCallback(
    (point: PointerPoint) => {
      dragStartPromiseRef.current = api()
        .invoke('focus.dragStart', { screenX: point.screenX, screenY: point.screenY })
        .then((placement) => {
          updatePlacement(placement);
        })
        .catch(() => undefined);
    },
    [updatePlacement],
  );

  const sendHostDragMove = useCallback(
    (point: PointerPoint) => {
      const start = dragStartPromiseRef.current ?? Promise.resolve();
      void start
        .then(() =>
          api().invoke('focus.dragMove', {
            screenX: point.screenX,
            screenY: point.screenY,
          }),
        )
        .then(updatePlacement)
        .catch(() => undefined);
    },
    [updatePlacement],
  );

  const scheduleHostDragMove = useCallback(
    (point: PointerPoint) => {
      pendingMoveRef.current = point;
      if (rafRef.current !== null) return;
      const schedule =
        typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame
          : (cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 16);
      rafRef.current = schedule(() => {
        rafRef.current = null;
        const next = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (next) sendHostDragMove(next);
      });
    },
    [sendHostDragMove],
  );

  const finishHostDrag = useCallback(
    (point: PointerPoint) => {
      if (rafRef.current !== null) {
        const cancel =
          typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
            ? window.cancelAnimationFrame
            : clearTimeout;
        cancel(rafRef.current);
        rafRef.current = null;
      }
      pendingMoveRef.current = null;
      const start = dragStartPromiseRef.current ?? Promise.resolve();
      void start
        .then(() =>
          api().invoke('focus.dragMove', {
            screenX: point.screenX,
            screenY: point.screenY,
          }),
        )
        .then(updatePlacement)
        .catch(() => undefined)
        .finally(() => {
          void api().invoke('focus.dragEnd').catch(() => undefined);
        });
    },
    [updatePlacement],
  );

  const startGesture = useCallback((pointerId: number, button: number, screenX: number, screenY: number) => {
    if (button !== 0) return;
    const point = {
      pointerId,
      screenX,
      screenY,
    };
    startRef.current = point;
    didDragRef.current = false;
  }, []);

  const moveGesture = useCallback(
    (pointerId: number, screenX: number, screenY: number, preventDefault: () => void) => {
      const start = startRef.current;
      if (!start || pointerId !== start.pointerId) return;

      const point = { pointerId, screenX, screenY };
      const totalDx = screenX - start.screenX;
      const totalDy = screenY - start.screenY;
      if (!didDragRef.current && Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD_PX) {
        return;
      }

      if (!didDragRef.current) {
        didDragRef.current = true;
        startHostDrag(start);
      }
      suppressClickRef.current = true;
      setDragging(true);
      preventDefault();
      scheduleHostDragMove(point);
    },
    [scheduleHostDragMove, startHostDrag],
  );

  const endGesture = useCallback(
    (pointerId: number, screenX: number, screenY: number, preventDefault: () => void) => {
      const start = startRef.current;
      if (!start || pointerId !== start.pointerId) return;
      if (didDragRef.current) {
        preventDefault();
        finishHostDrag({ pointerId, screenX, screenY });
      }
      reset();
    },
    [finishHostDrag, reset],
  );

  const onPointerDown = useCallback<PointerEventHandler<HTMLButtonElement>>((event) => {
    if (event.button !== 0) return;
    startGesture(event.pointerId, event.button, event.screenX, event.screenY);
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }, [startGesture]);

  const onPointerMove = useCallback<PointerEventHandler<HTMLButtonElement>>(
    (event) => {
      moveGesture(event.pointerId, event.screenX, event.screenY, () => event.preventDefault());
    },
    [moveGesture],
  );

  const onPointerUp = useCallback<PointerEventHandler<HTMLButtonElement>>(
    (event) => {
      endGesture(event.pointerId, event.screenX, event.screenY, () => event.preventDefault());
    },
    [endGesture],
  );

  const onPointerCancel = useCallback<PointerEventHandler<HTMLButtonElement>>(() => {
    if (didDragRef.current) void api().invoke('focus.dragEnd').catch(() => undefined);
    suppressClickRef.current = didDragRef.current;
    reset();
  }, [reset]);

  const onMouseDown = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      if (event.button !== 0) return;
      startGesture(-1, event.button, event.screenX, event.screenY);
    },
    [startGesture],
  );

  const onMouseMove = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      moveGesture(-1, event.screenX, event.screenY, () => event.preventDefault());
    },
    [moveGesture],
  );

  const onMouseUp = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      endGesture(-1, event.screenX, event.screenY, () => event.preventDefault());
    },
    [endGesture],
  );

  const onMouseLeave = useCallback<MouseEventHandler<HTMLButtonElement>>(() => {
    if (!startRef.current) return;
    if (didDragRef.current) void api().invoke('focus.dragEnd').catch(() => undefined);
    suppressClickRef.current = didDragRef.current;
    reset();
  }, [reset]);

  const onButtonClick = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClick();
    },
    [onClick],
  );

  return {
    dragging,
    gestureProps: usePointerEvents
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel,
          onClick: onButtonClick,
        }
      : {
          onMouseDown,
          onMouseMove,
          onMouseUp,
          onMouseLeave,
          onClick: onButtonClick,
        },
  };
}
