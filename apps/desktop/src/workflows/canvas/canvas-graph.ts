/**
 * Pure graph + geometry helpers for the workflow builder canvas.
 *
 * These functions are deliberately React-free and side-effect-free: they take
 * plain {@link BuilderNode}/{@link BuilderEdge} data (and, for disconnect, the
 * builder `dispatch`) and return values or dispatch the matching graph op.
 * Extracted from `WorkflowCanvas.tsx` so the topology fold + hit-testing +
 * disconnect routing are independently unit-testable. The canvas re-exports
 * `topoOrder`/`topologySignature` so its existing public surface is unchanged.
 */
import type { BuilderAction, BuilderEdge, BuilderNode } from '@moxxy/workflows-builder';

/** Step-node card width in world (pre-transform) units. */
export const NODE_W = 200;
/** Step-node card height in world units. */
export const NODE_H = 88;
/** Vertical offset of a node's anchor point (handles, edge endpoints). */
export const ANCHOR_OFFSET = NODE_H / 2;

/** What a handle emits when its drag is dropped on a target node. */
export type PortKind = 'needs' | 'then' | 'else' | 'loop-exit';

/** Compute the surface-space origin of a node's output handle for the temp line. */
export function portOrigin(node: BuilderNode, port: PortKind): { x: number; y: number } {
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
export function inBodyRegion(loop: BuilderNode, p: { x: number; y: number }): boolean {
  return p.y >= loop.y + ANCHOR_OFFSET;
}

/**
 * Dispatch the correct disconnect for an edge's kind, reversing whatever wiring
 * op produced it. Each case routes through an EXISTING shared op (no new graph
 * logic in the desktop layer): branch/loop edges re-set their target list with
 * the one target filtered out; `needs`/`loop-exit` have direct inverse ops.
 * `from` is the edge's source node, needed to read its current target lists.
 */
export function disconnectEdge(
  dispatch: (a: BuilderAction) => void,
  edge: BuilderEdge,
  from: BuilderNode,
): void {
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
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** The node whose card contains the point (excluding `exclude`), or null. */
export function nodeAt(
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

/** Trim + collapse whitespace for a node's action preview line. */
export function preview(text: string): string {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  return t.length > 0 ? t : '(empty)';
}

/** A node's display label, falling back to its id. */
export function labelOf(node: BuilderNode): string {
  return node.label || node.id;
}
