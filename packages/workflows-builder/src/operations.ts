/**
 * Pure operations over {@link BuilderState}. Every function takes a state and
 * returns a new one — no mutation, no side effects — so they compose cleanly
 * under a reducer and are trivial to unit-test. Edges are re-derived after any
 * structural change so the rendered graph always matches the node data.
 *
 * The loop node is modeled with TWO connection regions, exposed here as
 * distinct operations: {@link setLoopBody} defines which steps run INSIDE the
 * loop (the body region), and the EXIT connector is implicit — a loop continues
 * to the first non-body step that `needs` it, so {@link setLoopExit} just wires
 * that `needs` edge (and clears any prior exit) rather than storing a separate
 * field. This keeps the on-disk schema unchanged while giving the canvas a
 * single, unambiguous "on done / on error → next" edge per loop.
 */

import type { WorkflowStepErrorMode } from '@moxxy/sdk';
import { assertDefined } from './assert.js';
import { deriveEdges } from './serialize.js';
import {
  type BuilderLoop,
  type BuilderNode,
  type BuilderState,
  type StepKind,
} from './types.js';

const NEW_NODE_OFFSET = 40;

/** Empty canvas for a brand-new workflow. */
export function emptyState(name = 'new-workflow'): BuilderState {
  return {
    meta: {
      name,
      description: 'A new workflow.',
      enabled: true,
      version: 1,
      concurrency: 4,
      inputs: {},
    },
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selected: null,
    dirty: false,
    errors: {},
  };
}

function refresh(state: BuilderState, nodes: ReadonlyArray<BuilderNode>): BuilderState {
  return { ...state, nodes, edges: deriveEdges(nodes), dirty: true };
}

function defaultNode(id: string, kind: StepKind, x: number, y: number): BuilderNode {
  const base: BuilderNode = {
    id,
    kind,
    x,
    y,
    action: '',
    needs: [],
    onError: 'fail',
    retries: 0,
  };
  if (kind === 'condition') return { ...base, then: [], else: [] };
  if (kind === 'switch') return { ...base, cases: {}, default: [] };
  if (kind === 'loop') {
    const loop: BuilderLoop = { body: [], condition: '', maxIterations: 10 };
    return { ...base, loop };
  }
  return base;
}

/**
 * Coerce an arbitrary string into a schema-valid step id (lowercase, only
 * `[a-z0-9_-]`, trimmed, ≤60 chars). The single source of truth for what counts
 * as a valid id so `uniqueId` and `renameNode` can't drift apart and smuggle
 * forbidden characters past one path but not the other.
 */
export function slugifyId(base: string): string {
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'step'
  );
}

/** Generate a unique slug-like id from a desired base. */
export function uniqueId(state: BuilderState, base: string): string {
  const slug = slugifyId(base);
  const taken = new Set(state.nodes.map((n) => n.id));
  if (!taken.has(slug)) return slug;
  let i = 2;
  while (taken.has(`${slug}_${i}`)) i++;
  return `${slug}_${i}`;
}

export interface AddStepInput {
  readonly kind: StepKind;
  readonly id?: string;
  readonly label?: string;
  /** Position; defaults to a cascade below the last node. */
  readonly x?: number;
  readonly y?: number;
  /** When set, the new step `needs` this upstream step. */
  readonly after?: string;
}

/** Add a node of the given kind. Selects it. */
export function addStep(state: BuilderState, input: AddStepInput): BuilderState {
  // Always slugify + de-dupe through uniqueId so a provided id can't smuggle
  // in characters the schema's step-id rule forbids.
  const id = uniqueId(state, input.id ?? input.kind);
  const last = state.nodes[state.nodes.length - 1];
  const x = input.x ?? (last ? last.x + NEW_NODE_OFFSET : NEW_NODE_OFFSET);
  const y = input.y ?? (last ? last.y + NEW_NODE_OFFSET : NEW_NODE_OFFSET);
  const node = defaultNode(id, input.kind, x, y);
  if (input.label) node.label = input.label;
  if (input.after && state.nodes.some((n) => n.id === input.after)) {
    node.needs = [input.after];
  }
  const next = refresh(state, [...state.nodes, node]);
  return { ...next, selected: id };
}

/** Remove a node and scrub every reference to it (needs, branches, loop bodies). */
export function removeStep(state: BuilderState, id: string): BuilderState {
  const nodes = state.nodes
    .filter((n) => n.id !== id)
    .map((n) => scrubReferences(n, id));
  const next = refresh(state, nodes);
  return { ...next, selected: state.selected === id ? null : state.selected };
}

function scrubReferences(node: BuilderNode, removed: string): BuilderNode {
  const out: BuilderNode = {
    ...node,
    needs: node.needs.filter((d) => d !== removed),
  };
  if (out.then) out.then = out.then.filter((t) => t !== removed);
  if (out.else) out.else = out.else.filter((t) => t !== removed);
  if (out.default) out.default = out.default.filter((t) => t !== removed);
  if (out.cases) {
    out.cases = Object.fromEntries(
      Object.entries(out.cases).map(([k, v]) => [k, v.filter((t) => t !== removed)]),
    );
  }
  if (out.loop) out.loop = { ...out.loop, body: out.loop.body.filter((t) => t !== removed) };
  return out;
}

/** Move a node to a new canvas position. Persists to `ui.layout` on save. */
export function moveNode(state: BuilderState, id: string, x: number, y: number): BuilderState {
  const nodes = state.nodes.map((n) => (n.id === id ? { ...n, x, y } : n));
  // Position-only edits keep edges identical — skip re-derivation.
  return { ...state, nodes, dirty: true };
}

/** Set the canvas pan/zoom. */
export function setViewport(state: BuilderState, viewport: BuilderState['viewport']): BuilderState {
  return { ...state, viewport, dirty: true };
}

/** Select a node (or clear selection with null). Not a content edit. */
export function selectNode(state: BuilderState, id: string | null): BuilderState {
  return { ...state, selected: id };
}

/** Add a `needs` dependency edge (idempotent; ignores self/unknown/cyclic). */
export function connectNeeds(state: BuilderState, from: string, to: string): BuilderState {
  if (from === to) return state;
  const fromNode = state.nodes.find((n) => n.id === from);
  const exists = fromNode != null && state.nodes.some((n) => n.id === to);
  if (!exists) return state;
  // A non-body step that `needs` a loop IS that loop's exit (the exit connector
  // is modeled implicitly as `needs:[loop]`). Authoring such an edge here as a
  // plain `needs` would create a SECOND non-body needs:[loop] that the renderer
  // can't disambiguate from the real exit — route it through setLoopExit so the
  // loop keeps exactly one, deterministic exit.
  if (fromNode.kind === 'loop' && !(fromNode.loop?.body ?? []).includes(to)) {
    return setLoopExit(state, from, to);
  }
  // `to` would `needs: [from]`, i.e. `from` must run before `to`. If `from`
  // already (transitively) depends on `to`, that edge closes a cycle the engine
  // can never schedule — refuse it here so the canvas can't author an invalid
  // DAG the way the inspector's free-text field could.
  if (wouldCreateCycle(state, from, to)) return state;
  const nodes = state.nodes.map((n) =>
    n.id === to && !n.needs.includes(from) ? { ...n, needs: [...n.needs, from] } : n,
  );
  return refresh(state, nodes);
}

/**
 * Would adding `to.needs += from` (⇒ `from` runs before `to`) close a cycle in
 * the `needs` DAG? True iff `from` already depends — directly or transitively —
 * on `to`. Pure + synchronous so interaction layers can guard a gesture before
 * dispatching (server validation also rejects cycles, but only after a save).
 */
export function wouldCreateCycle(state: BuilderState, from: string, to: string): boolean {
  if (from === to) return true;
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  // Walk `from`'s upstream dependencies; if we reach `to`, the new edge cycles.
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop();
    assertDefined(id, 'stack is non-empty (loop guard)');
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node) stack.push(...node.needs);
  }
  return false;
}

/** Remove a `needs` dependency edge. */
export function disconnectNeeds(state: BuilderState, from: string, to: string): BuilderState {
  const nodes = state.nodes.map((n) =>
    n.id === to ? { ...n, needs: n.needs.filter((d) => d !== from) } : n,
  );
  return refresh(state, nodes);
}

export type BranchSlot = 'then' | 'else' | 'default';

/** Replace a condition step's `then`/`else` (or a switch's `default`) targets. */
export function setBranchTargets(
  state: BuilderState,
  nodeId: string,
  slot: BranchSlot,
  targets: ReadonlyArray<string>,
): BuilderState {
  const nodes = state.nodes.map((n) =>
    n.id === nodeId ? { ...n, [slot]: dedupe(targets) } : n,
  );
  return refresh(state, nodes);
}

/** Set the targets of one switch case (creates the case if new). */
export function setSwitchCase(
  state: BuilderState,
  nodeId: string,
  caseId: string,
  targets: ReadonlyArray<string>,
): BuilderState {
  const nodes = state.nodes.map((n) =>
    n.id === nodeId ? { ...n, cases: { ...(n.cases ?? {}), [caseId]: dedupe(targets) } } : n,
  );
  return refresh(state, nodes);
}

/** Remove a switch case entirely. */
export function removeSwitchCase(state: BuilderState, nodeId: string, caseId: string): BuilderState {
  const nodes = state.nodes.map((n) => {
    if (n.id !== nodeId || !n.cases) return n;
    const { [caseId]: _dropped, ...rest } = n.cases;
    return { ...n, cases: rest };
  });
  return refresh(state, nodes);
}

/**
 * Define the BODY membership of a loop node — the steps that run inside the
 * loop, in order. Also keeps every body step's `needs: [loop]` so the executor
 * scopes them to the loop, and drops `needs` for steps no longer in the body.
 */
export function setLoopBody(
  state: BuilderState,
  loopId: string,
  body: ReadonlyArray<string>,
): BuilderState {
  const loopNode = state.nodes.find((n) => n.id === loopId);
  if (!loopNode || loopNode.kind !== 'loop') return state;
  // A body member gets `needs: [loop]`. If the loop already (transitively)
  // depends on that member, that edge closes a cycle the engine can never
  // schedule — exactly the invariant connectNeeds/setLoopExit guard against.
  // Drop such ancestors from the body so this path can't author an invalid DAG
  // either (the member stays a plain upstream of the loop instead).
  const cleaned = dedupe(body).filter(
    (id) =>
      id !== loopId &&
      state.nodes.some((n) => n.id === id) &&
      !wouldCreateCycle(state, loopId, id),
  );
  const bodySet = new Set(cleaned);
  const prevBody = new Set(loopNode.loop?.body ?? []);
  const nodes = state.nodes.map((n) => {
    if (n.id === loopId) {
      const loop: BuilderLoop = { ...(n.loop ?? defaultLoop()), body: cleaned };
      return { ...n, loop };
    }
    // Body members get `needs: [loop]`; steps dropped from the body lose it.
    if (bodySet.has(n.id)) {
      return n.needs.includes(loopId) ? n : { ...n, needs: [...n.needs, loopId] };
    }
    if (prevBody.has(n.id) && !bodySet.has(n.id)) {
      return { ...n, needs: n.needs.filter((d) => d !== loopId) };
    }
    return n;
  });
  return refresh(state, nodes);
}

/**
 * Wire a loop's EXIT target — the single step the loop continues to once its
 * condition is met (or a body step errors). Implemented as a `needs: [loop]`
 * edge on the target, with the previous exit's edge cleared, so there is always
 * exactly one exit per loop. Pass null to detach the exit.
 */
export function setLoopExit(state: BuilderState, loopId: string, targetId: string | null): BuilderState {
  const loopNode = state.nodes.find((n) => n.id === loopId);
  if (!loopNode || loopNode.kind !== 'loop') return state;
  if (targetId && (targetId === loopId || (loopNode.loop?.body ?? []).includes(targetId))) {
    return state; // a body step can't also be the exit
  }
  // Wiring `target.needs += loop` closes a cycle if the loop already
  // (transitively) depends on `target`. connectNeeds short-circuits to here for
  // loop nodes BEFORE its own cycle guard runs, so without this the canvas could
  // author an unschedulable DAG via a loop-exit edge. Mirror the plain-needs
  // guard so the loop-exit path is consistent.
  if (targetId && wouldCreateCycle(state, loopId, targetId)) return state;
  // Scrub EVERY non-body `needs:[loop]` edge before wiring the new target.
  // `loopExitTarget` only reports the FIRST such node by array order, so if a
  // second non-body step also carried `needs:[loop]` (e.g. authored via
  // connectNeeds), clearing just that one would leave a second, ambiguous exit
  // — and which one renders as `loop-exit` would then depend on node order.
  // Clearing all of them keeps exactly one exit and makes it deterministic.
  const body = new Set(loopNode.loop?.body ?? []);
  const nodes = state.nodes.map((n) => {
    if (n.id === targetId) {
      return n.needs.includes(loopId) ? n : { ...n, needs: [...n.needs, loopId] };
    }
    if (!body.has(n.id) && n.id !== loopId && n.needs.includes(loopId)) {
      return { ...n, needs: n.needs.filter((d) => d !== loopId) };
    }
    return n;
  });
  return refresh(state, nodes);
}

/** Patch a loop node's condition / maxIterations. */
export function setLoopConfig(
  state: BuilderState,
  loopId: string,
  patch: Partial<Pick<BuilderLoop, 'condition' | 'maxIterations'>>,
): BuilderState {
  const nodes = state.nodes.map((n) => {
    if (n.id !== loopId || n.kind !== 'loop') return n;
    const loop: BuilderLoop = { ...(n.loop ?? defaultLoop()), ...patch };
    loop.maxIterations = clampIterations(loop.maxIterations);
    return { ...n, loop };
  });
  return refresh(state, nodes);
}

/** Editable per-node fields the inspector can patch directly. */
export interface NodeFieldPatch {
  label?: string;
  action?: string;
  input?: string;
  args?: Record<string, unknown>;
  when?: string;
  onError?: WorkflowStepErrorMode;
  retries?: number;
  format?: BuilderNode['format'];
  awaitInput?: boolean;
}

/** Patch scalar fields of a node (action text, label, onError, …). */
export function updateNode(state: BuilderState, id: string, patch: NodeFieldPatch): BuilderState {
  const nodes = state.nodes.map((n) => (n.id === id ? applyPatch(n, patch) : n));
  // Field edits don't change topology — keep edges, just flip dirty.
  return { ...state, nodes, dirty: true };
}

function applyPatch(node: BuilderNode, patch: NodeFieldPatch): BuilderNode {
  const next: BuilderNode = { ...node };
  if (patch.label !== undefined) next.label = patch.label || undefined;
  if (patch.action !== undefined) next.action = patch.action;
  if (patch.input !== undefined) next.input = patch.input || undefined;
  // Clone so the new immutable node never aliases the caller's object — a later
  // in-place mutation of `patch.args` must not retroactively edit this snapshot
  // (breaks undo/replay + React referential equality). Matches hydrate's clone.
  if (patch.args !== undefined) next.args = { ...patch.args };
  if (patch.when !== undefined) next.when = patch.when || undefined;
  if (patch.onError !== undefined) next.onError = patch.onError;
  if (patch.retries !== undefined) next.retries = clampRetries(patch.retries);
  if (patch.format !== undefined) next.format = patch.format;
  if (patch.awaitInput !== undefined) next.awaitInput = patch.awaitInput || undefined;
  return next;
}

/** Patch workflow-level metadata (name/description/enabled/…). */
export function updateMeta(state: BuilderState, patch: Partial<BuilderState['meta']>): BuilderState {
  return { ...state, meta: { ...state.meta, ...patch }, dirty: true };
}

/** Rename a node id, rewriting every reference (needs/branch/loop body). */
export function renameNode(state: BuilderState, from: string, to: string): BuilderState {
  if (from === to) return state;
  // Reject ids the schema's step-id rule forbids — the inspector wires this
  // straight from a free-text field, so a value like `my step!` must not be
  // accepted verbatim into node + edge ids the way addStep guards against.
  if (!to || slugifyId(to) !== to || state.nodes.some((n) => n.id === to)) return state;
  const nodes = state.nodes.map((n) => {
    const renamed = n.id === from ? { ...n, id: to } : { ...n };
    renamed.needs = renamed.needs.map((d) => (d === from ? to : d));
    if (renamed.then) renamed.then = renamed.then.map((t) => (t === from ? to : t));
    if (renamed.else) renamed.else = renamed.else.map((t) => (t === from ? to : t));
    if (renamed.default) renamed.default = renamed.default.map((t) => (t === from ? to : t));
    if (renamed.cases) {
      renamed.cases = Object.fromEntries(
        Object.entries(renamed.cases).map(([k, v]) => [k, v.map((t) => (t === from ? to : t))]),
      );
    }
    if (renamed.loop) renamed.loop = { ...renamed.loop, body: renamed.loop.body.map((t) => (t === from ? to : t)) };
    return renamed;
  });
  const next = refresh(state, nodes);
  return { ...next, selected: state.selected === from ? to : state.selected };
}

function defaultLoop(): BuilderLoop {
  return { body: [], condition: '', maxIterations: 10 };
}

function clampIterations(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(50, Math.round(n)));
}

function clampRetries(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, Math.round(n)));
}

function dedupe(list: ReadonlyArray<string>): string[] {
  return [...new Set(list.filter((x) => x.length > 0))];
}
