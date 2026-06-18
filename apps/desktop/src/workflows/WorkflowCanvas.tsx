import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  STEP_KINDS,
  stepKindMeta,
  uniqueId,
  wouldCreateCycle,
  type BuilderAction,
  type BuilderEdge,
  type BuilderNode,
  type BuilderState,
  type StepKind,
} from '@moxxy/workflows-builder';
import { accentHex } from './accents';

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

const NODE_W = 200;
const NODE_H = 88;
const ANCHOR_OFFSET = NODE_H / 2;
const HANDLE_R = 7;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** Multiplicative step for the +/− buttons. */
const ZOOM_STEP = 1.2;
/** Base spacing of the dotted background grid at 100% zoom. */
const GRID_SIZE = 24;
/** Viewport padding around the graph for zoom-to-fit. */
const FIT_PAD = 60;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

interface Props {
  readonly state: BuilderState;
  readonly dispatch: (action: BuilderAction) => void;
}

/** What a handle emits when its drag is dropped on a target node. */
type PortKind = 'needs' | 'then' | 'else' | 'loop-exit';

interface PendingConnection {
  readonly nodeId: string;
  readonly port: PortKind;
  /** Handle origin in surface coords (where the temp line starts). */
  readonly ox: number;
  readonly oy: number;
}

/** A connection dropped on empty canvas, parked while the insert menu is open. */
interface InsertMenuState {
  /** Source node + port of the pending edge. */
  readonly nodeId: string;
  readonly port: PortKind;
  /** Drop point in content coords (the new node's input anchor lands here). */
  readonly x: number;
  readonly y: number;
  /** Pending-edge origin, kept so the preview line stays drawn. */
  readonly ox: number;
  readonly oy: number;
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
  const connect = useRef<PendingConnection | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [reject, setReject] = useState<string | null>(null);
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Background drag-to-pan: last pointer position (deltas apply incrementally
   *  to the viewport), cumulative travel, and whether it actually moved (a
   *  still pan is a click and must keep deselecting). */
  const pan = useRef<{ lx: number; ly: number; dist: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  /** Set on pan end so the synthetic click that follows doesn't deselect. */
  const suppressClick = useRef(false);
  const [insertMenu, setInsertMenu] = useState<InsertMenuState | null>(null);

  /** The pan/zoom transform — the builder state's persisted viewport. */
  const view = state.viewport;
  const setView = useCallback(
    (viewport: BuilderState['viewport']) => dispatch({ type: 'set-viewport', viewport }),
    [dispatch],
  );

  const byId = useMemo(() => new Map(state.nodes.map((n) => [n.id, n])), [state.nodes]);

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
  // signature instead. The disable directive must sit DIRECTLY above the
  // useMemo to apply.
  const topoSig = topologySignature(state.nodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const order = useMemo(() => topoOrder(state.nodes), [topoSig]);

  /** Pointer position in WORLD coords (node space, pre-transform). */
  const surfacePoint = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const cx = rect ? e.clientX - rect.left : e.clientX;
      const cy = rect ? e.clientY - rect.top : e.clientY;
      return { x: (cx - view.x) / view.zoom, y: (cy - view.y) / view.zoom };
    },
    [view],
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
    [setView, view],
  );

  /** Frame all nodes in the viewport (centered, padded, capped at 100%). */
  const zoomToFit = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 || state.nodes.length === 0) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const minX = Math.min(...state.nodes.map((n) => n.x));
    const minY = Math.min(...state.nodes.map((n) => n.y));
    const maxX = Math.max(...state.nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...state.nodes.map((n) => n.y + NODE_H));
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
  }, [setView, state.nodes]);

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
  }, [applyZoom, setView, view]);

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
  }, [dispatch, state.selected]);

  const flashReject = useCallback((msg: string) => {
    setReject(msg);
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
    rejectTimer.current = setTimeout(() => setReject(null), 2600);
  }, []);

  // Clear a pending reject-flash timer on unmount so it can't fire setReject
  // after the canvas is gone.
  useEffect(
    () => () => {
      if (rejectTimer.current) clearTimeout(rejectTimer.current);
    },
    [],
  );

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
    [dispatch, surfacePoint],
  );

  // --- connection drag (handle pointerdown) ---
  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, node: BuilderNode, port: PortKind) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setInsertMenu(null);
      const origin = portOrigin(node, port);
      const start: PendingConnection = { nodeId: node.id, port, ox: origin.x, oy: origin.y };
      connect.current = start;
      setPending(start);
      const p = surfacePoint(e);
      setCursor(p);
    },
    [surfacePoint],
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
      pan.current = { lx: e.clientX, ly: e.clientY, dist: 0, moved: false };
      setPanning(true);
    },
    [insertMenu],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = surfacePoint(e);
      if (drag.current) {
        // Unbounded world — negative coordinates are fine.
        dispatch({ type: 'move-node', id: drag.current.id, x: p.x - drag.current.dx, y: p.y - drag.current.dy });
        return;
      }
      if (connect.current) {
        setCursor(p);
        setHoverTarget(nodeAt(state.nodes, p, connect.current.nodeId));
        return;
      }
      if (pan.current) {
        const dx = e.clientX - pan.current.lx;
        const dy = e.clientY - pan.current.ly;
        pan.current.lx = e.clientX;
        pan.current.ly = e.clientY;
        pan.current.dist += Math.abs(dx) + Math.abs(dy);
        if (pan.current.dist > 3) pan.current.moved = true;
        setView({ x: view.x + dx, y: view.y + dy, zoom: view.zoom });
      }
    },
    [dispatch, setView, state.nodes, surfacePoint, view],
  );

  const finishConnection = useCallback(
    (p: { x: number; y: number }) => {
      const c = connect.current;
      connect.current = null;
      setPending(null);
      setCursor(null);
      setHoverTarget(null);
      if (!c) return;
      const targetId = nodeAt(state.nodes, p, c.nodeId);
      if (!targetId) {
        // Dropped on empty canvas → offer to insert a node right there, wired
        // to the pending connection (Escape / click-away cancels).
        setInsertMenu({ nodeId: c.nodeId, port: c.port, x: p.x, y: p.y, ox: c.ox, oy: c.oy });
        return;
      }
      const target = byId.get(targetId);
      const source = byId.get(c.nodeId);
      if (!target || !source || target.id === source.id) return;

      switch (c.port) {
        case 'needs': {
          // Dropping a plain output onto a LOOP is ambiguous, so we read the
          // drop sub-region: the lower "body" half adds the source to the loop
          // body (it runs INSIDE the loop); the upper half wires a plain `needs`
          // (the source runs BEFORE the loop).
          if (target.kind === 'loop' && target.loop) {
            if (inBodyRegion(target, p)) {
              if (target.loop.body.includes(source.id)) return;
              dispatch({ type: 'set-loop-body', loopId: target.id, body: [...target.loop.body, source.id] });
              return;
            }
          }
          if (wouldCreateCycle(state, source.id, target.id)) {
            flashReject(`Can't connect ${labelOf(source)} → ${labelOf(target)}: it would create a cycle.`);
            return;
          }
          dispatch({ type: 'connect-needs', from: source.id, to: target.id });
          return;
        }
        case 'then':
        case 'else': {
          const current = (c.port === 'then' ? source.then : source.else) ?? [];
          if (current.includes(target.id)) return;
          dispatch({ type: 'set-branch', nodeId: source.id, slot: c.port, targets: [...current, target.id] });
          return;
        }
        case 'loop-exit': {
          // Source is the loop; target becomes its single exit (on done/error → next).
          dispatch({ type: 'set-loop-exit', loopId: source.id, targetId: target.id });
          return;
        }
      }
    },
    [byId, dispatch, flashReject, state],
  );

  // Insert a node of `kind` at the menu's drop point and wire the pending edge
  // to it, through the same ops the drop-on-node path dispatches. The id is
  // precomputed (uniqueId) because dispatch can't return the id add-step picks;
  // sequential dispatches reduce in order, so the wire op sees the new node.
  const insertFromMenu = useCallback(
    (kind: StepKind) => {
      const menu = insertMenu;
      setInsertMenu(null);
      if (!menu) return;
      const source = byId.get(menu.nodeId);
      if (!source) return;
      const id = uniqueId(state, kind);
      const x = menu.x;
      // Offset so the new node's left input anchor lands at the drop point.
      const y = menu.y - ANCHOR_OFFSET;
      switch (menu.port) {
        case 'needs':
          dispatch({ type: 'add-step', input: { kind, id, x, y, after: source.id } });
          return;
        case 'then':
        case 'else': {
          dispatch({ type: 'add-step', input: { kind, id, x, y } });
          const current = (menu.port === 'then' ? source.then : source.else) ?? [];
          dispatch({ type: 'set-branch', nodeId: source.id, slot: menu.port, targets: [...current, id] });
          return;
        }
        case 'loop-exit':
          dispatch({ type: 'add-step', input: { kind, id, x, y } });
          dispatch({ type: 'set-loop-exit', loopId: source.id, targetId: id });
          return;
      }
    },
    [byId, dispatch, insertMenu, state],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (drag.current) {
        drag.current = null;
        setDragging(null);
        return;
      }
      if (connect.current) {
        finishConnection(surfacePoint(e));
        return;
      }
      if (pan.current) {
        // A pan that moved must not read as a background click (deselect) —
        // swallow the click that follows this pointerup.
        suppressClick.current = pan.current.moved;
        pan.current = null;
        setPanning(false);
      }
    },
    [finishConnection, surfacePoint],
  );

  // Pointer leaving the surface mid-connection cancels cleanly (no stuck line).
  const onPointerLeave = useCallback(() => {
    if (connect.current) {
      connect.current = null;
      setPending(null);
      setCursor(null);
      setHoverTarget(null);
    }
    if (pan.current) {
      pan.current = null;
      setPanning(false);
    }
  }, []);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
    <div
      ref={surfaceRef}
      data-testid="workflow-canvas"
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
                id={`arrow-${kind}`}
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
          />
        ))}

        {insertMenu && byId.has(insertMenu.nodeId) && (
          <InsertNodeMenu menu={insertMenu} zoom={view.zoom} onPick={insertFromMenu} />
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
}: {
  readonly menu: InsertMenuState;
  readonly zoom: number;
  readonly onPick: (kind: StepKind) => void;
}): JSX.Element {
  return (
    <div
      data-testid="insert-node-menu"
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
      {STEP_KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          data-testid={`insert-add-${k.kind}`}
          title={k.description}
          onClick={() => onPick(k.kind)}
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
  onDisconnect,
}: {
  edge: BuilderEdge;
  from: BuilderNode;
  to: BuilderNode;
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
        markerEnd={`url(#arrow-${edge.kind})`}
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
      {/* a small ✕ at the midpoint to delete the connection */}
      <g
        data-testid={`wf-edge-remove-${edge.id}`}
        transform={`translate(${midX}, ${midY + 8})`}
        style={{ pointerEvents: 'all', cursor: 'pointer' }}
        onClick={onRemove}
      >
        <circle r={7} fill="var(--color-bg-card)" stroke={style.color} strokeWidth={1} />
        <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke={style.color} strokeWidth={1.4} />
        <title>Remove this connection</title>
      </g>
    </g>
  );
}

function edgeColor(isHoverTarget: boolean, selected: boolean, accent: string, errors: number): string {
  if (isHoverTarget) return 'var(--color-primary)';
  if (selected) return accent;
  return errors > 0 ? 'var(--color-red)' : 'var(--color-border)';
}

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
}): JSX.Element {
  const meta = stepKindMeta(node.kind);
  const accent = accentHex(meta.accent);
  const isLoop = node.kind === 'loop';
  const isCondition = node.kind === 'condition';
  const isSwitch = node.kind === 'switch';
  return (
    <div
      data-testid={`wf-node-${node.id}`}
      onPointerDown={onBodyPointerDown}
      onClick={(e) => e.stopPropagation()}
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
        borderStyle: 'solid',
        borderWidth: '2px 2px 2px 5px',
        // Per-side colors only — mixing the borderColor shorthand with
        // borderLeftColor makes React warn on rerender.
        borderTopColor: edgeColor(isHoverTarget, selected, accent, errors),
        borderRightColor: edgeColor(isHoverTarget, selected, accent, errors),
        borderBottomColor: edgeColor(isHoverTarget, selected, accent, errors),
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
  return (
    <div
      data-testid={`wf-handle-${node.id}-${port}-${side}`}
      title={title}
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
        borderRadius: '50%',
        background: input && connecting ? color : 'var(--color-bg-card)',
        border: `2px solid ${color}`,
        cursor: input ? 'default' : 'crosshair',
        boxShadow: input && connecting ? `0 0 0 3px color-mix(in oklab, ${color} 40%, transparent)` : 'none',
        zIndex: 4,
      } as React.CSSProperties}
    />
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

/** Compute the surface-space origin of a node's output handle for the temp line. */
function portOrigin(node: BuilderNode, port: PortKind): { x: number; y: number } {
  switch (port) {
    case 'then':
      return { x: node.x + NODE_W, y: node.y + ANCHOR_OFFSET - 14 };
    case 'else':
      return { x: node.x + NODE_W, y: node.y + ANCHOR_OFFSET + 14 };
    case 'loop-exit':
    case 'needs':
    default:
      return { x: node.x + NODE_W, y: node.y + ANCHOR_OFFSET };
  }
}

/** The lower half of a loop card is its "body" drop region (vs the upper input). */
function inBodyRegion(loop: BuilderNode, p: { x: number; y: number }): boolean {
  return p.y >= loop.y + ANCHOR_OFFSET;
}

/**
 * Dispatch the correct disconnect for an edge's kind, reversing whatever wiring
 * op produced it. Each case routes through an EXISTING shared op (no new graph
 * logic in the desktop layer): branch/loop edges re-set their target list with
 * the one target filtered out; `needs`/`loop-exit` have direct inverse ops.
 * `from` is the edge's source node, needed to read its current target lists.
 */
function disconnectEdge(dispatch: (a: BuilderAction) => void, edge: BuilderEdge, from: BuilderNode): void {
  switch (edge.kind) {
    case 'needs':
      dispatch({ type: 'disconnect-needs', from: edge.from, to: edge.to });
      return;
    case 'then':
    case 'else': {
      const current = (edge.kind === 'then' ? from.then : from.else) ?? [];
      dispatch({ type: 'set-branch', nodeId: edge.from, slot: edge.kind, targets: current.filter((t) => t !== edge.to) });
      return;
    }
    case 'default': {
      const current = from.default ?? [];
      dispatch({ type: 'set-branch', nodeId: edge.from, slot: 'default', targets: current.filter((t) => t !== edge.to) });
      return;
    }
    case 'case': {
      const caseId = edge.caseId ?? '';
      const current = from.cases?.[caseId] ?? [];
      dispatch({ type: 'set-case', nodeId: edge.from, caseId, targets: current.filter((t) => t !== edge.to) });
      return;
    }
    case 'loop-body': {
      const body = from.loop?.body ?? [];
      dispatch({ type: 'set-loop-body', loopId: edge.from, body: body.filter((b) => b !== edge.to) });
      return;
    }
    case 'loop-exit':
      dispatch({ type: 'set-loop-exit', loopId: edge.from, targetId: null });
      return;
  }
}

/** True when a key event originated in a text-editing element (don't delete). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** The node whose card contains the point (excluding `exclude`), or null. */
function nodeAt(
  nodes: ReadonlyArray<BuilderNode>,
  p: { x: number; y: number },
  exclude: string,
): string | null {
  // Iterate in reverse so a node drawn on top wins when cards overlap.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (n.id === exclude) continue;
    if (p.x >= n.x && p.x <= n.x + NODE_W && p.y >= n.y && p.y <= n.y + NODE_H) return n.id;
  }
  return null;
}

/**
 * A geometry-FREE signature of the inputs {@link topoOrder} actually reads —
 * each node's id and its `needs` list, in array order. Two `state.nodes`
 * arrays that differ only in node positions (a drag) produce the SAME string,
 * so the `order` memo keyed on this skips the O(V+E) recompute during a drag
 * (when `moveNode` allocates a fresh array every pointer-move). Changes only
 * when a node is added/removed/reordered or a `needs` edge is wired/unwired —
 * exactly when the topological order can change.
 */
export function topologySignature(nodes: ReadonlyArray<BuilderNode>): string {
  let sig = '';
  for (const n of nodes) sig += `${n.id}:${(n.needs ?? []).join(',')};`;
  return sig;
}

/**
 * A 1-based topological index per node over the `needs` DAG (longest-path
 * layering, ties broken by array order). Makes the execution order legible on
 * the cards. Cyclic graphs (which the connect guard prevents, but a loaded YAML
 * could still contain) just fall back to insertion order for the affected nodes.
 */
export function topoOrder(nodes: ReadonlyArray<BuilderNode>): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const resolve = (id: string, seen: Set<string>): number => {
    const cached = depth.get(id);
    if (cached != null) return cached;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const needs = byId.get(id)?.needs ?? [];
    const d = needs.length === 0 ? 0 : Math.max(...needs.map((n) => (byId.has(n) ? resolve(n, seen) + 1 : 0)));
    seen.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) resolve(n.id, new Set());
  // Rank by (depth, insertion index) then assign 1..N.
  const ranked = [...nodes]
    .map((n, idx) => ({ id: n.id, depth: depth.get(n.id) ?? 0, idx }))
    .sort((a, b) => a.depth - b.depth || a.idx - b.idx);
  const order = new Map<string, number>();
  ranked.forEach((r, i) => order.set(r.id, i + 1));
  return order;
}

function preview(text: string): string {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  return t.length > 0 ? t : '(empty)';
}

function labelOf(node: BuilderNode): string {
  return node.label || node.id;
}
