import { useCallback, useMemo, useRef, useState } from 'react';
import {
  stepKindMeta,
  WORKFLOW_ERROR_KEY,
  wouldCreateCycle,
  type BuilderAction,
  type BuilderEdge,
  type BuilderNode,
  type BuilderState,
} from '@moxxy/workflows-builder';
import { accentHex } from './accents';

/**
 * The builder canvas: an absolute-positioned layer of draggable step-node
 * cards over an SVG edge layer. Hand-rolled (no react-flow) to avoid pulling a
 * heavy graph lib into the Electron bundle — the graph here is small (≤40
 * steps) and the interactions are limited to drag + select + wire.
 *
 * Two pointer gestures share the cards, disambiguated by WHERE the pointerdown
 * lands:
 *   - on the card BODY  → MOVE the node (drag.current / move-node).
 *   - on a connection HANDLE (the small circles on a card's edges) → draw a
 *     CONNECTION (connect.current); on pointerup over a target node it
 *     dispatches the matching graph op. These connections ARE the execution
 *     order: a `needs` edge from A→B means A runs before B.
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

const EDGE_STYLE: Record<BuilderEdge['kind'], { color: string; dash?: string; label?: string }> = {
  needs: { color: '#94a3b8' },
  then: { color: '#10b981', label: 'then' },
  else: { color: '#ef4444', label: 'else' },
  case: { color: '#8b5cf6' },
  default: { color: '#94a3b8', label: 'default' },
  'loop-body': { color: '#8b5cf6', dash: '6 5', label: 'body' },
  'loop-exit': { color: '#7c3aed', label: 'on done / error → next' },
};

const PORT_COLOR: Record<PortKind, string> = {
  needs: '#94a3b8',
  then: '#10b981',
  else: '#ef4444',
  'loop-exit': '#7c3aed',
};
const LOOP_BODY_COLOR = '#8b5cf6';

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

  const byId = useMemo(() => new Map(state.nodes.map((n) => [n.id, n])), [state.nodes]);

  /** Topological order index per node (1-based) so the canvas reads as a flow. */
  const order = useMemo(() => topoOrder(state.nodes), [state.nodes]);

  const surfacePoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const left = surfaceRef.current?.scrollLeft ?? 0;
    const top = surfaceRef.current?.scrollTop ?? 0;
    return {
      x: (rect ? e.clientX - rect.left : e.clientX) + left,
      y: (rect ? e.clientY - rect.top : e.clientY) + top,
    };
  }, []);

  const flashReject = useCallback((msg: string) => {
    setReject(msg);
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
    rejectTimer.current = setTimeout(() => setReject(null), 2600);
  }, []);

  // --- node move (body drag) ---
  const onBodyPointerDown = useCallback(
    (e: React.PointerEvent, node: BuilderNode) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
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
      const origin = portOrigin(node, port);
      const start: PendingConnection = { nodeId: node.id, port, ox: origin.x, oy: origin.y };
      connect.current = start;
      setPending(start);
      const p = surfacePoint(e);
      setCursor(p);
    },
    [surfacePoint],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = surfacePoint(e);
      if (drag.current) {
        const x = Math.max(0, p.x - drag.current.dx);
        const y = Math.max(0, p.y - drag.current.dy);
        dispatch({ type: 'move-node', id: drag.current.id, x, y });
        return;
      }
      if (connect.current) {
        setCursor(p);
        setHoverTarget(nodeAt(state.nodes, p, connect.current.nodeId));
      }
    },
    [dispatch, state.nodes, surfacePoint],
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
      if (!targetId) return; // dropped on empty canvas → cancel, no-op
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

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (drag.current) {
        drag.current = null;
        setDragging(null);
        return;
      }
      if (connect.current) finishConnection(surfacePoint(e));
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
  }, []);

  const width = Math.max(900, ...state.nodes.map((n) => n.x + NODE_W + 80));
  const height = Math.max(560, ...state.nodes.map((n) => n.y + NODE_H + 80));

  return (
    <div
      ref={surfaceRef}
      data-testid="workflow-canvas"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onClick={() => dispatch({ type: 'select', id: null })}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        background:
          'var(--color-bg) radial-gradient(circle, var(--color-card-border) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        borderRadius: 'var(--radius-block)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div style={{ position: 'relative', width, height }}>
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
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

        {state.nodes.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--color-text-dim)',
              fontSize: '0.9rem',
            }}
          >
            Add a step from the palette to start building.
          </div>
        )}
      </div>

      {reject && (
        <div
          role="alert"
          data-testid="connect-reject"
          style={{
            position: 'sticky',
            bottom: 12,
            margin: '0 auto',
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
  );
}

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
        borderColor: `${
          isHoverTarget ? 'var(--color-primary)' : selected ? accent : errors > 0 ? 'var(--color-red)' : 'var(--color-border)'
        }`,
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
 * A 1-based topological index per node over the `needs` DAG (longest-path
 * layering, ties broken by array order). Makes the execution order legible on
 * the cards. Cyclic graphs (which the connect guard prevents, but a loaded YAML
 * could still contain) just fall back to insertion order for the affected nodes.
 */
function topoOrder(nodes: ReadonlyArray<BuilderNode>): Map<string, number> {
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

export { WORKFLOW_ERROR_KEY };
