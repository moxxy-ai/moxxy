import { useCallback, useRef, useState } from 'react';
import {
  stepKindMeta,
  WORKFLOW_ERROR_KEY,
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
 * steps) and the interactions are limited to drag + select.
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

interface Props {
  readonly state: BuilderState;
  readonly dispatch: (action: BuilderAction) => void;
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

export function WorkflowCanvas({ state, dispatch }: Props): JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const byId = new Map(state.nodes.map((n) => [n.id, n]));

  const onPointerDown = useCallback(
    (e: React.PointerEvent, node: BuilderNode) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const rect = surfaceRef.current?.getBoundingClientRect();
      const ox = rect ? e.clientX - rect.left : e.clientX;
      const oy = rect ? e.clientY - rect.top : e.clientY;
      drag.current = { id: node.id, dx: ox - node.x, dy: oy - node.y };
      setDragging(node.id);
      dispatch({ type: 'select', id: node.id });
    },
    [dispatch],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const rect = surfaceRef.current?.getBoundingClientRect();
      const ox = rect ? e.clientX - rect.left : e.clientX;
      const oy = rect ? e.clientY - rect.top : e.clientY;
      const x = Math.max(0, ox - drag.current.dx);
      const y = Math.max(0, oy - drag.current.dy);
      dispatch({ type: 'move-node', id: drag.current.id, x, y });
    },
    [dispatch],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
    setDragging(null);
  }, []);

  const width = Math.max(900, ...state.nodes.map((n) => n.x + NODE_W + 80));
  const height = Math.max(560, ...state.nodes.map((n) => n.y + NODE_H + 80));

  return (
    <div
      ref={surfaceRef}
      data-testid="workflow-canvas"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
            return <Edge key={edge.id} edge={edge} from={from} to={to} />;
          })}
        </svg>

        {state.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selected={state.selected === node.id}
            dragging={dragging === node.id}
            errors={state.errors[node.id]?.length ?? 0}
            onPointerDown={(e) => onPointerDown(e, node)}
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
    </div>
  );
}

function Edge({ edge, from, to }: { edge: BuilderEdge; from: BuilderNode; to: BuilderNode }): JSX.Element {
  const style = EDGE_STYLE[edge.kind];
  const x1 = from.x + NODE_W;
  const y1 = from.y + ANCHOR_OFFSET;
  const x2 = to.x;
  const y2 = to.y + ANCHOR_OFFSET;
  const midX = (x1 + x2) / 2;
  const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  const label = edge.caseId ?? style.label;
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={style.color}
        strokeWidth={2}
        strokeDasharray={style.dash}
        markerEnd={`url(#arrow-${edge.kind})`}
      />
      {label && (
        <text
          x={midX}
          y={(y1 + y2) / 2 - 6}
          textAnchor="middle"
          fontSize="10"
          fill={style.color}
          style={{ fontWeight: 600, paintOrder: 'stroke', stroke: 'var(--color-bg)', strokeWidth: 3 }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function NodeCard({
  node,
  selected,
  dragging,
  errors,
  onPointerDown,
}: {
  node: BuilderNode;
  selected: boolean;
  dragging: boolean;
  errors: number;
  onPointerDown: (e: React.PointerEvent) => void;
}): JSX.Element {
  const meta = stepKindMeta(node.kind);
  const accent = accentHex(meta.accent);
  const isLoop = node.kind === 'loop';
  return (
    <div
      data-testid={`wf-node-${node.id}`}
      onPointerDown={onPointerDown}
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
        borderColor: `${selected ? accent : errors > 0 ? 'var(--color-red)' : 'var(--color-border)'}`,
        borderLeftColor: accent,
        borderRadius: 'var(--radius-block)',
        boxShadow: selected ? `0 4px 16px -6px ${accent}` : 'var(--color-card-shadow)',
        padding: '0.5rem 0.65rem',
        zIndex: selected ? 3 : 2,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
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
        {errors > 0 && (
          <span
            title={`${errors} validation issue(s)`}
            style={{
              fontSize: '0.6rem',
              fontWeight: 700,
              color: 'var(--color-red)',
            }}
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
    </div>
  );
}

function preview(text: string): string {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  return t.length > 0 ? t : '(empty)';
}

export { WORKFLOW_ERROR_KEY };
