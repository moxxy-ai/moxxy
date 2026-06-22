import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  STEP_KINDS,
  stepKindMeta,
  type BuilderAction,
  type BuilderEdge,
  type BuilderNode,
  type BuilderState,
  type StepKind,
} from '@moxxy/workflows-builder';
import { accentHex } from './accents';
import {
  ANCHOR_OFFSET,
  NODE_H,
  NODE_W,
  disconnectEdge,
  isEditableTarget,
  preview,
  type PortKind,
  // Re-exported below so `./WorkflowCanvas` keeps its existing public surface
  // (WorkflowCanvas.test.tsx imports these by name).
  topoOrder,
  topologySignature,
} from './canvas/canvas-graph';
import { GRID_SIZE, useCanvasCamera } from './canvas/useCanvasCamera';
import {
  useDragConnect,
  type InsertMenuState,
} from './canvas/useDragConnect';

// Keep the canvas' historical public surface: these pure helpers were defined
// here and are imported elsewhere (e.g. WorkflowCanvas.test.tsx) by name.
export { topoOrder, topologySignature };

/**
 * The builder canvas: an absolute-positioned layer of draggable step-node
 * cards over an SVG edge layer. Hand-rolled (no react-flow) to avoid pulling a
 * heavy graph lib into the Electron bundle — the graph here is small (≤40
 * steps) and the interactions are limited to drag + select + wire.
 *
 * The canvas is an INFINITE world viewed through a pan/zoom transform (Figma
 * model): the viewport div clips (`overflow: hidden`) and a zero-size content
 * layer carries `translate(view.x, view.y) scale(view.zoom)`. There are no
 * scrollbars and no world bounds — nodes can live at negative coordinates.
 * The transform is the builder state's persisted `viewport` (set-viewport),
 * so a saved workflow reopens at the same view.
 *
 *   world = (client − viewportRect.origin − view.pan) / view.zoom
 *
 * Navigation: drag empty canvas to pan; wheel / two-finger trackpad scroll
 * pans both axes; ctrl/cmd+wheel (and macOS pinch, which arrives as
 * ctrl+wheel) zooms anchored at the cursor; double-click empty canvas resets
 * to 100% (anchored at the cursor); the bottom-right cluster has −/%/+ plus
 * zoom-to-fit. The dotted background grid lives on the viewport and follows
 * the transform via background-position/size, so it repeats forever.
 *
 * Two pointer gestures share the cards, disambiguated by WHERE the pointerdown
 * lands:
 *   - on the card BODY  → MOVE the node (drag.current / move-node).
 *   - on a connection HANDLE (the small circles on a card's edges) → draw a
 *     CONNECTION (connect.current); on pointerup over a target node it
 *     dispatches the matching graph op. These connections ARE the execution
 *     order: a `needs` edge from A→B means A runs before B. Releasing over
 *     EMPTY canvas instead opens the insert menu: pick a step kind to create
 *     it at the drop point already wired to the pending edge (Escape or
 *     click-away cancels).
 *
 * Keyboard: Delete/Backspace removes the selected node (suppressed while a
 * text field has focus); Escape dismisses the insert menu.
 *
 * Handles per kind (outputs initiate a drag, inputs/targets receive it):
 *   - every node: a right-edge OUTPUT (plain `needs`) + a left-edge INPUT.
 *   - condition : `then` (green) + `else` (red) OUTPUT handles → setBranchTargets.
 *   - loop      : a `body` INPUT region (drop a step → setLoopBody) + an `exit`
 *                 OUTPUT handle (drag to a step → setLoopExit). No plain input
 *                 (a loop's predecessors are wired as their own `needs`).
 *
 * Edge legend:
 *   - needs  : solid grey arrow (DAG dependency)
 *   - then   : green, `else`: red, `case`: purple (+ label), `default`: grey
 *   - loop-body : dashed purple — the step runs INSIDE the loop
 *   - loop-exit : solid purple with the "on done / on error → next" label — the
 *                 single edge a loop takes once its condition is met or a body
 *                 step errors.
 */

// NODE_W / NODE_H / ANCHOR_OFFSET live in ./canvas/canvas-graph (shared with the
// pure hit-testing + geometry helpers); GRID_SIZE + the zoom math live in
// ./canvas/useCanvasCamera. Imported above.
const HANDLE_R = 7;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** Multiplicative step for the +/− buttons. */
const ZOOM_STEP = 1.2;

interface Props {
  readonly state: BuilderState;
  readonly dispatch: (action: BuilderAction) => void;
}

/** Loop-exit edges use violet-600 — a deliberate step darker than
 *  `--color-purple` so exit reads apart from body; theme-invariant accent
 *  with no design token, so it stays literal. */
const LOOP_EXIT_COLOR = '#7c3aed';

const EDGE_STYLE: Record<BuilderEdge['kind'], { color: string; dash?: string; label?: string }> = {
  needs: { color: 'var(--color-text-dim)' },
  then: { color: 'var(--color-green)', label: 'then' },
  else: { color: 'var(--color-red)', label: 'else' },
  case: { color: 'var(--color-purple)' },
  default: { color: 'var(--color-text-dim)', label: 'default' },
  'loop-body': { color: 'var(--color-purple)', dash: '6 5', label: 'body' },
  'loop-exit': { color: LOOP_EXIT_COLOR, label: 'on done / error → next' },
};

const PORT_COLOR: Record<PortKind, string> = {
  needs: 'var(--color-text-dim)',
  then: 'var(--color-green)',
  else: 'var(--color-red)',
  'loop-exit': LOOP_EXIT_COLOR,
};
const LOOP_BODY_COLOR = 'var(--color-purple)';

export function WorkflowCanvas({ state, dispatch }: Props): JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  /** The pan/zoom transform — the builder state's persisted viewport. */
  const view = state.viewport;
  const setView = useCallback(
    (viewport: BuilderState['viewport']) => dispatch({ type: 'set-viewport', viewport }),
    [dispatch],
  );

  // Camera: world↔client transform, cursor-anchored zoom, zoom-to-fit, the
  // non-passive wheel listener, and the background drag-to-pan gesture.
  const camera = useCanvasCamera(surfaceRef, view, setView, state.nodes);
  const { surfacePoint, applyZoom, zoomToFit, panning, suppressClick } = camera;

  // Drag-to-connect: the pending edge, hover highlighting, cycle-reject flash,
  // and the drop-on-empty insert menu.
  const conn = useDragConnect(state, dispatch);
  const { pending, cursor, hoverTarget, reject, insertMenu, setInsertMenu } = conn;

  const byId = useMemo(() => new Map(state.nodes.map((n) => [n.id, n])), [state.nodes]);

  // Arrow-marker ids must be unique per canvas instance: two canvases mounting
  // at once (or a future split view) would otherwise share DOM ids and all
  // edges would resolve to the first canvas' markers. `useId` namespaces them.
  const markerNs = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const markerId = useCallback((kind: BuilderEdge['kind']) => `arrow-${markerNs}-${kind}`, [markerNs]);

  /**
   * Topological order index per node (1-based) so the canvas reads as a flow.
   *
   * `moveNode` returns a fresh `state.nodes` array on EVERY pointer-move while
   * dragging a card, but a position-only move can never change the `needs`
   * topological order. So memoize on a geometry-FREE signature of the topology
   * (each node's id + needs in array order) — it stays referentially stable
   * across a drag, and the O(V+E) longest-path fold only recomputes when the
   * graph's wiring (or node set / order) actually changes, not per mousemove.
   */
  // topoSig is the intended geometry-free dependency; state.nodes (its source)
  // changes on every drag tick and would defeat the memo, so key on the
  // signature instead. Memoize the signature on state.nodes too so the O(V+E)
  // string build doesn't run on every pan/zoom (set-viewport) or drag tick —
  // only when the node set/wiring actually changes. The disable directive must
  // sit DIRECTLY above the dependent useMemo to apply.
  const topoSig = useMemo(() => topologySignature(state.nodes), [state.nodes]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const order = useMemo(() => topoOrder(state.nodes), [topoSig]);

  // Keyboard: Delete/Backspace removes the selected node + its edges (same op
  // as the inspector's Delete button); Escape dismisses the insert menu,
  // cancelling its pending edge. Skipped while typing in a field so editing
  // text never nukes a node. (Edges aren't selectable — they delete via the
  // midpoint ✕ — so there's no edge case here.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setInsertMenu(null);
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (state.selected == null || isEditableTarget(e.target)) return;
      e.preventDefault();
      setInsertMenu(null);
      dispatch({ type: 'remove-step', id: state.selected });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, setInsertMenu, state.selected]);

  // --- node move (body drag) ---
  const onBodyPointerDown = useCallback(
    (e: React.PointerEvent, node: BuilderNode) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setInsertMenu(null);
      const p = surfacePoint(e);
      drag.current = { id: node.id, dx: p.x - node.x, dy: p.y - node.y };
      setDragging(node.id);
      dispatch({ type: 'select', id: node.id });
    },
    [dispatch, setInsertMenu, surfacePoint],
  );

  // --- connection drag (handle pointerdown) ---
  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, node: BuilderNode, port: PortKind) => {
      conn.onHandlePointerDown(e, node, port, surfacePoint(e));
    },
    [conn, surfacePoint],
  );

  // --- background pan (canvas drag) ---
  // Node bodies and handles stopPropagation on pointerdown, so anything that
  // reaches the surface here is empty canvas (or an edge) → start panning.
  const onSurfacePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Truthy = non-primary button. (Not `!== 0`: jsdom test events have no
      // PointerEvent, so `button` arrives undefined there.)
      if (e.button) return;
      if (insertMenu) {
        // Click-away dismisses the insert menu (cancels the pending edge);
        // swallow the gesture so it doesn't also start a pan.
        setInsertMenu(null);
        return;
      }
      (e.target as Element).setPointerCapture?.(e.pointerId);
      camera.beginPan(e);
    },
    [camera, insertMenu, setInsertMenu],
  );

  // Gesture priority: node move > connection > pan (the original ordering).
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = surfacePoint(e);
      if (drag.current) {
        // Unbounded world — negative coordinates are fine.
        dispatch({ type: 'move-node', id: drag.current.id, x: p.x - drag.current.dx, y: p.y - drag.current.dy });
        return;
      }
      if (conn.moveConnect(p)) return;
      camera.movePan(e);
    },
    [camera, conn, dispatch, surfacePoint],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (drag.current) {
        drag.current = null;
        setDragging(null);
        return;
      }
      if (conn.connectActive()) {
        conn.finishConnection(surfacePoint(e));
        return;
      }
      camera.endPan();
    },
    [camera, conn, surfacePoint],
  );

  // Pointer leaving the surface mid-connection cancels cleanly (no stuck line).
  const onPointerLeave = useCallback(() => {
    conn.cancelConnect();
    camera.cancelPan();
  }, [camera, conn]);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
    <div
      ref={surfaceRef}
      data-testid="workflow-canvas"
      role="application"
      aria-label="Workflow builder canvas"
      // Programmatically focusable so the insert menu can restore focus here on
      // close (not in the Tab order itself — the nodes/handles are the
      // keyboard-reachable interactive elements).
      tabIndex={-1}
      onPointerDown={onSurfacePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onDoubleClick={(e) => applyZoom(1, { x: e.clientX, y: e.clientY })}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        dispatch({ type: 'select', id: null });
      }}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        touchAction: 'none',
        cursor: panning ? 'grabbing' : 'grab',
        background:
          'var(--color-bg) radial-gradient(circle, var(--color-card-border) 1px, transparent 1px)',
        // The grid lives on the viewport but tracks the world transform, so it
        // reads as an infinite sheet: spacing scales with zoom, offset follows pan.
        backgroundSize: `${GRID_SIZE * view.zoom}px ${GRID_SIZE * view.zoom}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        borderRadius: 'var(--radius-block)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* The world: a zero-size layer carrying the pan/zoom transform; children
       *  (absolutely positioned, overflow visible) extend in every direction. */}
      <div
        data-testid="canvas-content"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg
          width="2"
          height="2"
          style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
        >
          <defs>
            {Object.entries(EDGE_STYLE).map(([kind, s]) => (
              <marker
                key={kind}
                id={markerId(kind as BuilderEdge['kind'])}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={s.color} />
              </marker>
            ))}
          </defs>
          {state.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            return (
              <Edge
                key={edge.id}
                edge={edge}
                from={from}
                to={to}
                markerId={markerId(edge.kind)}
                onDisconnect={() => disconnectEdge(dispatch, edge, from)}
              />
            );
          })}
          {pending && cursor && <TempLine from={{ x: pending.ox, y: pending.oy }} to={cursor} port={pending.port} />}
          {insertMenu && byId.has(insertMenu.nodeId) && (
            <TempLine
              from={{ x: insertMenu.ox, y: insertMenu.oy }}
              to={{ x: insertMenu.x, y: insertMenu.y }}
              port={insertMenu.port}
            />
          )}
        </svg>

        {state.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selected={state.selected === node.id}
            dragging={dragging === node.id}
            errors={state.errors[node.id]?.length ?? 0}
            order={order.get(node.id)}
            connecting={pending != null}
            isHoverTarget={hoverTarget === node.id}
            onBodyPointerDown={(e) => onBodyPointerDown(e, node)}
            onHandlePointerDown={(e, port) => onHandlePointerDown(e, node, port)}
            onSelect={() => dispatch({ type: 'select', id: node.id })}
            onNudge={(dx, dy) => dispatch({ type: 'move-node', id: node.id, x: node.x + dx, y: node.y + dy })}
          />
        ))}

        {insertMenu && byId.has(insertMenu.nodeId) && (
          <InsertNodeMenu
            menu={insertMenu}
            zoom={view.zoom}
            onPick={conn.insertFromMenu}
            onClose={() => setInsertMenu(null)}
            restoreFocusRef={surfaceRef}
          />
        )}
      </div>

      {/* Empty-state hint lives on the viewport (not the world) so it stays
       *  centered and readable regardless of pan/zoom. */}
      {state.nodes.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--color-text-dim)',
            fontSize: '0.9rem',
            pointerEvents: 'none',
          }}
        >
          Add a step from the palette to start building.
        </div>
      )}

      {reject && (
        <div
          role="alert"
          data-testid="connect-reject"
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'fit-content',
            maxWidth: '80%',
            padding: '0.4rem 0.7rem',
            background: 'var(--color-red)',
            color: 'var(--color-bg)',
            fontSize: '0.76rem',
            fontWeight: 600,
            borderRadius: 'var(--radius-block)',
            boxShadow: 'var(--color-card-shadow)',
            zIndex: 10,
          }}
        >
          {reject}
        </div>
      )}
    </div>
    <ZoomControls
      zoom={view.zoom}
      onZoomIn={() => applyZoom(view.zoom * ZOOM_STEP)}
      onZoomOut={() => applyZoom(view.zoom / ZOOM_STEP)}
      onReset={() => applyZoom(1)}
      onFit={zoomToFit}
    />
    </div>
  );
}

/** Floating zoom cluster pinned to the canvas' bottom-right corner. The
 *  percentage doubles as a reset-to-100% button; ⛶ frames all nodes. */
function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
}: {
  readonly zoom: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onReset: () => void;
  readonly onFit: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        boxShadow: 'var(--color-card-shadow)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        data-testid="canvas-zoom-out"
        title="Zoom out"
        aria-label="Zoom out"
        disabled={zoom <= MIN_ZOOM}
        onClick={onZoomOut}
        style={{ ...zoomBtn, opacity: zoom <= MIN_ZOOM ? 0.4 : 1 }}
      >
        −
      </button>
      <button
        type="button"
        data-testid="canvas-zoom-reset"
        title="Reset zoom to 100%"
        onClick={onReset}
        style={{ ...zoomBtn, width: 'auto', minWidth: 40, padding: '0 6px', fontSize: '0.68rem' }}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        data-testid="canvas-zoom-in"
        title="Zoom in"
        aria-label="Zoom in"
        disabled={zoom >= MAX_ZOOM}
        onClick={onZoomIn}
        style={{ ...zoomBtn, opacity: zoom >= MAX_ZOOM ? 0.4 : 1 }}
      >
        +
      </button>
      <button
        type="button"
        data-testid="canvas-zoom-fit"
        title="Zoom to fit all steps"
        aria-label="Zoom to fit"
        onClick={onFit}
        style={{ ...zoomBtn, fontSize: '0.8rem' }}
      >
        ⛶
      </button>
    </div>
  );
}

/**
 * The drop-on-empty-canvas insert menu: pick a step kind to create it at the
 * drop point, pre-wired to the pending connection. Lives inside the scaled
 * content layer (so it tracks the drop point through pan/zoom) but counter-
 * scales itself to stay readable at any zoom level.
 */
function InsertNodeMenu({
  menu,
  zoom,
  onPick,
  onClose,
  restoreFocusRef,
}: {
  readonly menu: InsertMenuState;
  readonly zoom: number;
  readonly onPick: (kind: StepKind) => void;
  readonly onClose: () => void;
  readonly restoreFocusRef: React.RefObject<HTMLElement>;
}): JSX.Element {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);

  // Focus the first item on open and restore focus to the canvas on close
  // (focus trap + restoration; WCAG 2.4.3 / menu pattern).
  useEffect(() => {
    itemRefs.current[0]?.focus();
    const surface = restoreFocusRef.current;
    return () => surface?.focus?.();
  }, [restoreFocusRef]);

  const focusItem = (i: number): void => {
    const n = STEP_KINDS.length;
    const next = ((i % n) + n) % n;
    setActive(next);
    itemRefs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(active - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(STEP_KINDS.length - 1);
        break;
      case 'Escape':
        // Menu-scoped close (the global window listener also handles Escape,
        // but this keeps focus management local and restores it on close).
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case 'Tab':
        // A menu is a focus trap: keep arrow keys as the only traversal.
        e.preventDefault();
        focusItem(active + (e.shiftKey ? -1 : 1));
        break;
    }
  };

  return (
    <div
      data-testid="insert-node-menu"
      role="menu"
      aria-label="Insert step"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      // Own the gesture: a pointerdown/click inside the menu must not pan the
      // canvas, dismiss the menu, or deselect.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: menu.x,
        top: menu.y,
        transform: `scale(${1 / zoom})`,
        transformOrigin: '0 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 4,
        minWidth: 160,
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        boxShadow: 'var(--color-card-shadow)',
        zIndex: 6,
      }}
    >
      <span
        style={{
          fontSize: '0.6rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--color-text-dim)',
          padding: '2px 6px',
        }}
      >
        Insert step
      </span>
      {STEP_KINDS.map((k, i) => (
        <button
          key={k.kind}
          type="button"
          role="menuitem"
          data-testid={`insert-add-${k.kind}`}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          // Roving tabindex: only the active item is in the Tab order.
          tabIndex={i === active ? 0 : -1}
          title={k.description}
          aria-label={`Insert ${k.label} step`}
          onClick={() => onPick(k.kind)}
          onFocus={() => setActive(i)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.74rem',
            fontWeight: 600,
            padding: '0.28rem 0.5rem',
            textAlign: 'left',
            color: 'var(--color-text)',
            borderRadius: 6,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: accentHex(k.accent),
              flexShrink: 0,
            }}
          />
          {k.label}
        </button>
      ))}
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.95rem',
  fontWeight: 600,
  color: 'var(--color-text-dim)',
  borderRadius: 6,
};

function TempLine({
  from,
  to,
  port,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  port: PortKind;
}): JSX.Element {
  const midX = (from.x + to.x) / 2;
  const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
  return (
    <path
      data-testid="temp-connection"
      d={path}
      fill="none"
      stroke={PORT_COLOR[port]}
      strokeWidth={2}
      strokeDasharray="5 4"
      opacity={0.85}
    />
  );
}

function Edge({
  edge,
  from,
  to,
  markerId,
  onDisconnect,
}: {
  edge: BuilderEdge;
  from: BuilderNode;
  to: BuilderNode;
  markerId: string;
  onDisconnect: () => void;
}): JSX.Element {
  const style = EDGE_STYLE[edge.kind];
  const x1 = from.x + NODE_W;
  const y1 = from.y + ANCHOR_OFFSET;
  const x2 = to.x;
  const y2 = to.y + ANCHOR_OFFSET;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  const label = edge.caseId ?? style.label;
  const onRemove = (e: { stopPropagation: () => void }): void => {
    e.stopPropagation();
    onDisconnect();
  };
  // A human-readable description of what this edge connects, so the keyboard /
  // screen-reader path to remove it isn't a bare ✕. `style.label` already names
  // the kind (then/else/default/body/exit); `needs` reads as a dependency.
  const kindLabel = label ?? (edge.kind === 'needs' ? 'dependency' : edge.kind);
  const removeLabel = `Remove ${kindLabel} connection ${edge.from} → ${edge.to}`;
  return (
    <g data-testid={`wf-edge-${edge.id}`}>
      {/* fat invisible hit area so the thin edge is easy to click to delete */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onClick={onRemove}
      >
        <title>Click to remove this connection</title>
      </path>
      <path
        d={path}
        fill="none"
        stroke={style.color}
        strokeWidth={2}
        strokeDasharray={style.dash}
        markerEnd={`url(#${markerId})`}
        style={{ pointerEvents: 'none' }}
      />
      {label && (
        <text
          x={midX}
          y={midY - 6}
          textAnchor="middle"
          fontSize="10"
          fill={style.color}
          style={{
            fontWeight: 600,
            paintOrder: 'stroke',
            stroke: 'var(--color-bg)',
            strokeWidth: 3,
            pointerEvents: 'none',
          }}
        >
          {label}
        </text>
      )}
      {/* A small ✕ at the midpoint to delete the connection. Focusable +
       *  keyboard-activatable (Enter/Space) with an accessible name, so an
       *  edge can be removed without a pointer (WCAG 2.1.1). */}
      <g
        data-testid={`wf-edge-remove-${edge.id}`}
        role="button"
        tabIndex={0}
        aria-label={removeLabel}
        transform={`translate(${midX}, ${midY + 8})`}
        style={{ pointerEvents: 'all', cursor: 'pointer' }}
        onClick={onRemove}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onRemove(e);
          }
        }}
      >
        <circle r={7} fill="var(--color-bg-card)" stroke={style.color} strokeWidth={1} />
        <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke={style.color} strokeWidth={1.4} />
        <title>{removeLabel}</title>
      </g>
    </g>
  );
}

function edgeColor(isHoverTarget: boolean, selected: boolean, accent: string, errors: number): string {
  if (isHoverTarget) return 'var(--color-primary)';
  if (selected) return accent;
  return errors > 0 ? 'var(--color-red)' : 'var(--color-border)';
}

/** World-units a keyboard arrow nudge moves a node (Shift = larger step). */
const NUDGE_STEP = 8;
const NUDGE_STEP_LARGE = 40;

function NodeCard({
  node,
  selected,
  dragging,
  errors,
  order,
  connecting,
  isHoverTarget,
  onBodyPointerDown,
  onHandlePointerDown,
  onSelect,
  onNudge,
}: {
  node: BuilderNode;
  selected: boolean;
  dragging: boolean;
  errors: number;
  order: number | undefined;
  connecting: boolean;
  isHoverTarget: boolean;
  onBodyPointerDown: (e: React.PointerEvent) => void;
  onHandlePointerDown: (e: React.PointerEvent, port: PortKind) => void;
  onSelect: () => void;
  onNudge: (dx: number, dy: number) => void;
}): JSX.Element {
  const meta = stepKindMeta(node.kind);
  const accent = accentHex(meta.accent);
  const isLoop = node.kind === 'loop';
  const isCondition = node.kind === 'condition';
  const isSwitch = node.kind === 'switch';
  // The card is the keyboard-reachable handle for its node: Tab to it,
  // Enter/Space selects, arrows nudge its position. (The inspector's
  // checkbox-based NeedsPicker/TargetPicker/LoopEditor are the keyboard-
  // complete authoring path for wiring; this makes selection + nudge operable
  // without a pointer — WCAG 2.1.1.) Errors are signalled by both a red border
  // AND a thicker dashed top border, so the state isn't conveyed by color
  // alone (WCAG 1.4.1).
  const borderColor = edgeColor(isHoverTarget, selected, accent, errors);
  const errored = errors > 0 && !isHoverTarget && !selected;
  const ariaLabel =
    `${meta.label} step ${node.label || node.id}` +
    (order != null ? `, position ${order} in execution order` : '') +
    (errors > 0 ? `, ${errors} validation issue${errors === 1 ? '' : 's'}` : '');
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
      return;
    }
    const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        onNudge(-step, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        onNudge(step, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        onNudge(0, -step);
        break;
      case 'ArrowDown':
        e.preventDefault();
        onNudge(0, step);
        break;
    }
  };
  return (
    <div
      data-testid={`wf-node-${node.id}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={selected}
      onPointerDown={onBodyPointerDown}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      // Double-click on a CARD must not trigger the canvas' zoom reset.
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: NODE_W,
        minHeight: NODE_H,
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        background: 'var(--color-bg-card)',
        borderStyle: errored ? 'dashed dashed dashed solid' : 'solid',
        borderWidth: errored ? '3px 2px 2px 5px' : '2px 2px 2px 5px',
        // Per-side colors only — mixing the borderColor shorthand with
        // borderLeftColor makes React warn on rerender.
        borderTopColor: borderColor,
        borderRightColor: borderColor,
        borderBottomColor: borderColor,
        borderLeftColor: accent,
        borderRadius: 'var(--radius-block)',
        boxShadow: isHoverTarget
          ? '0 0 0 2px var(--color-primary)'
          : selected
            ? `0 4px 16px -6px ${accent}`
            : 'var(--color-card-shadow)',
        padding: '0.5rem 0.65rem',
        zIndex: selected ? 3 : 2,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {order != null && (
            <span
              title={`step ${order} in execution order`}
              style={{
                fontSize: '0.58rem',
                fontWeight: 800,
                minWidth: 16,
                height: 16,
                lineHeight: '16px',
                textAlign: 'center',
                borderRadius: '50%',
                color: 'var(--color-bg)',
                background: accent,
              }}
            >
              {order}
            </span>
          )}
          <span
            style={{
              fontSize: '0.6rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: accent,
            }}
          >
            {meta.label}
          </span>
        </span>
        {errors > 0 && (
          <span
            title={`${errors} validation issue(s)`}
            style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-red)' }}
          >
            ⚠ {errors}
          </span>
        )}
      </div>
      <div style={{ fontWeight: 600, fontSize: '0.82rem', marginTop: 2, color: 'var(--color-text)' }}>
        {node.label || node.id}
      </div>
      <div
        className="mono"
        style={{
          fontSize: '0.66rem',
          color: 'var(--color-text-dim)',
          marginTop: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {isLoop
          ? `loop · ${node.loop?.body.length ?? 0} in body · max ${node.loop?.maxIterations ?? 10}`
          : preview(node.action)}
      </div>

      {/* --- INPUT handle(s) (left edge): drop targets / receivers --- */}
      {isLoop ? (
        <>
          <Handle
            node={node}
            port="needs"
            side="left"
            y={ANCHOR_OFFSET - 16}
            input
            title="Input — drop a step's output on the UPPER half so it runs BEFORE the loop"
            connecting={connecting}
          />
          <BodyDropHandle node={node} y={ANCHOR_OFFSET + 16} connecting={connecting} />
        </>
      ) : (
        <Handle
          node={node}
          port="needs"
          side="left"
          y={ANCHOR_OFFSET}
          input
          title="Input — drag a connection here to make this step depend on another"
          connecting={connecting}
        />
      )}

      {/* --- OUTPUT handle(s) (right edge): initiate a connection drag --- */}
      {isCondition ? (
        <>
          <Handle
            node={node}
            port="then"
            side="right"
            y={ANCHOR_OFFSET - 14}
            title="then → drag to the step that runs when the condition is met"
            onPointerDown={(e) => onHandlePointerDown(e, 'then')}
          />
          <Handle
            node={node}
            port="else"
            side="right"
            y={ANCHOR_OFFSET + 14}
            title="else → drag to the step that runs when the condition is NOT met"
            onPointerDown={(e) => onHandlePointerDown(e, 'else')}
          />
        </>
      ) : isLoop ? (
        <Handle
          node={node}
          port="loop-exit"
          side="right"
          y={ANCHOR_OFFSET}
          title="exit → drag to the step the loop continues to (on done / on error)"
          onPointerDown={(e) => onHandlePointerDown(e, 'loop-exit')}
        />
      ) : (
        <Handle
          node={node}
          port="needs"
          side="right"
          y={ANCHOR_OFFSET}
          title={
            isSwitch
              ? 'Output — drag to a step that should run after this (set cases in the inspector)'
              : 'Output — drag to a step that should run after this one'
          }
          onPointerDown={(e) => onHandlePointerDown(e, 'needs')}
        />
      )}
    </div>
  );
}

/** A non-color glyph that distinguishes a color-coded OUTPUT handle, so the
 *  then/else/exit ports aren't told apart by hue alone (WCAG 1.4.1). */
const PORT_GLYPH: Partial<Record<PortKind, string>> = {
  then: 't',
  else: 'e',
  'loop-exit': 'x',
};

function Handle({
  node,
  port,
  side,
  y,
  title,
  input,
  connecting,
  onPointerDown,
}: {
  node: BuilderNode;
  port: PortKind;
  side: 'left' | 'right';
  y: number;
  title: string;
  /** A pure receiving input (no drag); highlight while a connection is active. */
  input?: boolean;
  connecting?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}): JSX.Element {
  const color = PORT_COLOR[port];
  const glyph = PORT_GLYPH[port];
  return (
    <div
      data-testid={`wf-handle-${node.id}-${port}-${side}`}
      title={title}
      aria-label={title}
      onPointerDown={
        onPointerDown
          ? (e) => {
              // A handle pointerdown must NOT start a node move — own the event.
              e.stopPropagation();
              onPointerDown(e);
            }
          : undefined
      }
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: y - HANDLE_R,
        [side]: -HANDLE_R,
        width: HANDLE_R * 2,
        height: HANDLE_R * 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.55rem',
        fontWeight: 800,
        lineHeight: 1,
        color,
        borderRadius: '50%',
        background: input && connecting ? color : 'var(--color-bg-card)',
        border: `2px solid ${color}`,
        cursor: input ? 'default' : 'crosshair',
        boxShadow: input && connecting ? `0 0 0 3px color-mix(in oklab, ${color} 40%, transparent)` : 'none',
        zIndex: 4,
      } as React.CSSProperties}
    >
      {glyph}
    </div>
  );
}

/**
 * The loop's "body" drop region — a distinct purple input handle on the lower
 * half of the loop card. Dropping a step's output here (i.e. anywhere over the
 * loop's lower half) adds it to the loop body via setLoopBody. It's a passive
 * receiver, so it only highlights; the drop is resolved by {@link inBodyRegion}.
 */
function BodyDropHandle({
  node,
  y,
  connecting,
}: {
  node: BuilderNode;
  y: number;
  connecting: boolean;
}): JSX.Element {
  return (
    <div
      data-testid={`wf-handle-${node.id}-loop-body-left`}
      title="Body — drop a step's output on the LOWER half so it runs INSIDE the loop"
      aria-label="Loop body drop target — drop a step here so it runs inside the loop"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: y - HANDLE_R,
        left: -HANDLE_R,
        width: HANDLE_R * 2,
        height: HANDLE_R * 2,
        borderRadius: '50%',
        background: connecting ? LOOP_BODY_COLOR : 'var(--color-bg-card)',
        border: `2px dashed ${LOOP_BODY_COLOR}`,
        boxShadow: connecting ? `0 0 0 3px color-mix(in oklab, ${LOOP_BODY_COLOR} 40%, transparent)` : 'none',
        zIndex: 4,
      }}
    />
  );
}

// portOrigin / inBodyRegion / disconnectEdge / isEditableTarget / nodeAt /
// topologySignature / topoOrder / preview / labelOf moved to
// ./canvas/canvas-graph (pure, independently unit-tested). topoOrder +
// topologySignature are re-exported from this module's top so the canvas'
// historical public surface is unchanged.
