/**
 * The canvas' pan/zoom camera as a focused hook.
 *
 * Owns the world↔client coordinate transform (`surfacePoint`), the
 * cursor-anchored zoom (`applyZoom`), zoom-to-fit, the native non-passive wheel
 * listener (pan on plain wheel, zoom on ctrl/cmd+wheel), and the background
 * drag-to-pan gesture (last-pointer deltas applied incrementally to the
 * viewport, with the "a still pan is a click" deselect distinction).
 *
 * The transform itself lives in the builder state's persisted `viewport`
 * (passed in as `view` + `setView`), so a saved workflow reopens at the same
 * view — this hook doesn't own that state, only the gestures that mutate it.
 * Extracted from `WorkflowCanvas.tsx` verbatim; behavior is unchanged.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { BuilderState } from '@moxxy/workflows-builder';
import { NODE_W, NODE_H } from './canvas-graph';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** Base spacing of the dotted background grid at 100% zoom. */
export const GRID_SIZE = 24;
/** Viewport padding around the graph for zoom-to-fit. */
const FIT_PAD = 60;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

type Viewport = BuilderState['viewport'];

export interface CanvasCamera {
  /** Pointer position in WORLD coords (node space, pre-transform). */
  readonly surfacePoint: (e: { clientX: number; clientY: number }) => { x: number; y: number };
  /** Zoom to `next`, keeping `anchor` (client coords; defaults to centre) fixed. */
  readonly applyZoom: (next: number, anchor?: { x: number; y: number }) => void;
  /** Frame all nodes in the viewport (centered, padded, capped at 100%). */
  readonly zoomToFit: () => void;
  /** True while a background drag-to-pan is in progress (drives the cursor). */
  readonly panning: boolean;
  /** Begin a background pan from this pointerdown (empty-canvas only). */
  readonly beginPan: (e: { clientX: number; clientY: number }) => void;
  /** Apply a pan move if one is active; returns true if it consumed the move. */
  readonly movePan: (e: { clientX: number; clientY: number }) => boolean;
  /** End an active pan, recording whether it actually moved (suppresses the
   *  synthetic click's deselect). Returns true if a pan was active. */
  readonly endPan: () => boolean;
  /** Cancel an active pan (pointer left the surface). Returns true if active. */
  readonly cancelPan: () => boolean;
  /** True while an active pan exists (priority gate in pointer handlers). */
  readonly panActive: () => boolean;
  /** Set on pan end so the synthetic click that follows doesn't deselect. */
  readonly suppressClick: MutableRefObject<boolean>;
}

export function useCanvasCamera(
  surfaceRef: RefObject<HTMLDivElement>,
  view: Viewport,
  setView: (viewport: Viewport) => void,
  nodes: BuilderState['nodes'],
): CanvasCamera {
  /** Background drag-to-pan: last pointer position (deltas apply incrementally
   *  to the viewport), cumulative travel, and whether it actually moved (a
   *  still pan is a click and must keep deselecting). */
  const pan = useRef<{ lx: number; ly: number; dist: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  /** Set on pan end so the synthetic click that follows doesn't deselect. */
  const suppressClick = useRef(false);

  /** Pointer position in WORLD coords (node space, pre-transform). */
  const surfacePoint = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const cx = rect ? e.clientX - rect.left : e.clientX;
      const cy = rect ? e.clientY - rect.top : e.clientY;
      return { x: (cx - view.x) / view.zoom, y: (cy - view.y) / view.zoom };
    },
    [surfaceRef, view],
  );

  /** Zoom to `next`, keeping `anchor` (client coords; defaults to the
   *  viewport centre) over the same world point: solve the pan from
   *  anchor = world·z + pan. */
  const applyZoom = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const z = clampZoom(next);
      if (z === view.zoom) return;
      const rect = surfaceRef.current?.getBoundingClientRect();
      const ax = anchor ? anchor.x - (rect?.left ?? 0) : (rect?.width ?? 0) / 2;
      const ay = anchor ? anchor.y - (rect?.top ?? 0) : (rect?.height ?? 0) / 2;
      setView({
        x: ax - ((ax - view.x) / view.zoom) * z,
        y: ay - ((ay - view.y) / view.zoom) * z,
        zoom: z,
      });
    },
    [surfaceRef, setView, view],
  );

  /** Frame all nodes in the viewport (centered, padded, capped at 100%). */
  const zoomToFit = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 || nodes.length === 0) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...nodes.map((n) => n.y + NODE_H));
    const z = clampZoom(
      Math.min(
        (rect.width - FIT_PAD * 2) / Math.max(1, maxX - minX),
        (rect.height - FIT_PAD * 2) / Math.max(1, maxY - minY),
        1, // frame, don't magnify — a lone node shouldn't fill the screen
      ),
    );
    setView({
      x: (rect.width - (maxX - minX) * z) / 2 - minX * z,
      y: (rect.height - (maxY - minY) * z) / 2 - minY * z,
      zoom: z,
    });
  }, [surfaceRef, setView, nodes]);

  // Wheel: plain wheel / two-finger trackpad scroll PANS both axes;
  // ctrl/cmd+wheel (macOS pinch arrives as ctrl+wheel) ZOOMS at the cursor.
  // Native non-passive listener — React's root wheel listener is passive, so
  // a synthetic onWheel can't preventDefault (and the page would scroll).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        applyZoom(view.zoom * Math.exp(-e.deltaY * 0.0018), { x: e.clientX, y: e.clientY });
      } else {
        setView({ x: view.x - e.deltaX, y: view.y - e.deltaY, zoom: view.zoom });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [surfaceRef, applyZoom, setView, view]);

  const beginPan = useCallback((e: { clientX: number; clientY: number }) => {
    pan.current = { lx: e.clientX, ly: e.clientY, dist: 0, moved: false };
    setPanning(true);
  }, []);

  const movePan = useCallback(
    (e: { clientX: number; clientY: number }): boolean => {
      if (!pan.current) return false;
      const dx = e.clientX - pan.current.lx;
      const dy = e.clientY - pan.current.ly;
      pan.current.lx = e.clientX;
      pan.current.ly = e.clientY;
      pan.current.dist += Math.abs(dx) + Math.abs(dy);
      if (pan.current.dist > 3) pan.current.moved = true;
      setView({ x: view.x + dx, y: view.y + dy, zoom: view.zoom });
      return true;
    },
    [setView, view],
  );

  const endPan = useCallback((): boolean => {
    if (!pan.current) return false;
    // A pan that moved must not read as a background click (deselect) —
    // swallow the click that follows this pointerup.
    suppressClick.current = pan.current.moved;
    pan.current = null;
    setPanning(false);
    return true;
  }, []);

  const cancelPan = useCallback((): boolean => {
    if (!pan.current) return false;
    pan.current = null;
    setPanning(false);
    return true;
  }, []);

  const panActive = useCallback((): boolean => pan.current != null, []);

  return {
    surfacePoint,
    applyZoom,
    zoomToFit,
    panning,
    beginPan,
    movePan,
    endPan,
    cancelPan,
    panActive,
    suppressClick,
  };
}
