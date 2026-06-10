/**
 * The graph <-> workflow bridge.
 *
 * `serialize` turns the canvas {@link BuilderState} into a plain `Workflow`
 * object (assignable to the SDK type) plus its canonical YAML, folding node
 * positions + viewport into `ui.layout`. `hydrate` does the inverse: it takes a
 * saved `Workflow` (or its YAML) and rebuilds the canvas, deriving an
 * auto-layout when `ui.layout` is absent so a hand-authored / freshly-imported
 * workflow still opens as a sensible graph.
 *
 * Edges are DERIVED, never authored directly: `deriveEdges` projects each
 * node's `needs`, branch lists, and loop body/exit into the typed
 * {@link BuilderEdge} set the renderer draws.
 */

import type { Workflow, WorkflowStep, WorkflowUiLayout } from '@moxxy/sdk';
import type {
  BuilderEdge,
  BuilderLoop,
  BuilderMeta,
  BuilderNode,
  BuilderState,
  BuilderViewport,
  StepKind,
} from './types.js';
import { fromYaml, toYaml } from './yaml.js';

type ActionField = 'skill' | 'prompt' | 'tool' | 'workflow' | 'bridge' | 'condition' | 'switch' | 'loop';

const ACTION_KIND_FIELD: Record<StepKind, ActionField> = {
  skill: 'skill',
  prompt: 'prompt',
  tool: 'tool',
  workflow: 'workflow',
  bridge: 'bridge',
  condition: 'condition',
  switch: 'switch',
  loop: 'loop',
};

const DEFAULT_VIEWPORT: BuilderViewport = { x: 0, y: 0, zoom: 1 };

export interface SerializeResult {
  readonly workflow: Workflow;
  readonly yaml: string;
}

/** Build a `Workflow` object (+ canonical YAML) from the canvas state. */
export function serialize(state: BuilderState): SerializeResult {
  const steps: WorkflowStep[] = state.nodes.map((node) => nodeToStep(node));
  const layout: WorkflowUiLayout = {
    nodes: Object.fromEntries(state.nodes.map((n) => [n.id, { x: round(n.x), y: round(n.y) }])),
    viewport: {
      x: round(state.viewport.x),
      y: round(state.viewport.y),
      zoom: state.viewport.zoom,
    },
  };
  const workflow: Workflow = {
    name: state.meta.name,
    description: state.meta.description,
    version: state.meta.version,
    enabled: state.meta.enabled,
    inputs: state.meta.inputs,
    ...(state.meta.on ? { on: state.meta.on } : {}),
    ...(state.meta.delivery ? { delivery: state.meta.delivery } : {}),
    ui: { layout },
    concurrency: state.meta.concurrency,
    steps,
  };
  return { workflow, yaml: toYaml(stripUndefined(workflow)) };
}

function nodeToStep(node: BuilderNode): WorkflowStep {
  const base: Record<string, unknown> = {
    id: node.id,
    needs: [...node.needs],
    onError: node.onError,
    retries: node.retries,
  };
  if (node.label) base.label = node.label;
  if (node.when) base.when = node.when;
  if (node.format) base.format = node.format;
  if (node.awaitInput) base.awaitInput = node.awaitInput;

  const field = ACTION_KIND_FIELD[node.kind];
  if (node.kind === 'loop') {
    base.loop = {
      body: [...(node.loop?.body ?? [])],
      condition: node.loop?.condition ?? '',
      maxIterations: node.loop?.maxIterations ?? 10,
    };
  } else {
    base[field] = node.action;
  }

  if (node.kind === 'skill' && node.input) base.input = node.input;
  if ((node.kind === 'tool' || node.kind === 'workflow') && node.args) base.args = node.args;
  if (node.kind === 'condition') {
    base.then = [...(node.then ?? [])];
    base.else = [...(node.else ?? [])];
  }
  if (node.kind === 'switch') {
    base.cases = mapValues(node.cases ?? {}, (v) => [...v]);
    if (node.default && node.default.length > 0) base.default = [...node.default];
  }
  return base as unknown as WorkflowStep;
}

/** Hydrate the canvas from a saved workflow object. */
export function hydrate(workflow: Workflow): BuilderState {
  const positions = workflow.ui?.layout?.nodes;
  const autoPositions = positions ? undefined : autoLayout(workflow.steps);
  const nodes: BuilderNode[] = workflow.steps.map((step, idx) => {
    const pos = positions?.[step.id] ?? autoPositions?.[idx] ?? { x: 0, y: idx * NODE_GAP_Y };
    return stepToNode(step, pos.x, pos.y);
  });
  const meta: BuilderMeta = {
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    version: workflow.version,
    concurrency: workflow.concurrency,
    inputs: workflow.inputs ?? {},
    ...(workflow.on ? { on: workflow.on } : {}),
    ...(workflow.delivery ? { delivery: workflow.delivery } : {}),
  };
  const viewport = workflow.ui?.layout?.viewport ?? DEFAULT_VIEWPORT;
  return {
    meta,
    nodes,
    edges: deriveEdges(nodes),
    viewport,
    selected: null,
    dirty: false,
    errors: {},
  };
}

/** Parse canonical YAML the host returned, then hydrate. */
export function hydrateYaml(yaml: string): BuilderState {
  const raw = fromYaml(yaml) as Partial<Workflow> | null;
  if (!raw || typeof raw !== 'object') {
    throw new Error('workflow YAML did not parse to an object');
  }
  return hydrate(normalizeWorkflow(raw));
}

/** Fill in schema defaults the canvas relies on when reading loose YAML. */
function normalizeWorkflow(raw: Partial<Workflow>): Workflow {
  const steps = (raw.steps ?? []).map((s) => {
    const step = s as Partial<WorkflowStep>;
    return {
      ...step,
      needs: step.needs ?? [],
      onError: step.onError ?? 'fail',
      retries: step.retries ?? 0,
    } as WorkflowStep;
  });
  return {
    name: raw.name ?? 'untitled-workflow',
    description: raw.description ?? '',
    version: raw.version ?? 1,
    enabled: raw.enabled ?? true,
    inputs: raw.inputs ?? {},
    ...(raw.on ? { on: raw.on } : {}),
    ...(raw.delivery ? { delivery: raw.delivery } : {}),
    ...(raw.ui ? { ui: raw.ui } : {}),
    concurrency: raw.concurrency ?? 4,
    steps,
  };
}

function stepToNode(step: WorkflowStep, x: number, y: number): BuilderNode {
  const kind = detectKind(step);
  const loop: BuilderLoop | undefined = step.loop
    ? {
        body: [...step.loop.body],
        condition: step.loop.condition,
        maxIterations: step.loop.maxIterations,
      }
    : undefined;
  return {
    id: step.id,
    kind,
    x,
    y,
    action: kind === 'loop' ? '' : (step[ACTION_KIND_FIELD[kind]] as string) ?? '',
    needs: [...step.needs],
    onError: step.onError,
    retries: step.retries,
    ...(step.label ? { label: step.label } : {}),
    ...(step.input ? { input: step.input } : {}),
    ...(step.args ? { args: { ...step.args } } : {}),
    ...(step.then ? { then: [...step.then] } : {}),
    ...(step.else ? { else: [...step.else] } : {}),
    ...(step.cases ? { cases: mapValues(step.cases, (v) => [...v]) } : {}),
    ...(step.default ? { default: [...step.default] } : {}),
    ...(loop ? { loop } : {}),
    ...(step.when ? { when: step.when } : {}),
    ...(step.format ? { format: step.format } : {}),
    ...(step.awaitInput ? { awaitInput: step.awaitInput } : {}),
  };
}

function detectKind(step: WorkflowStep): StepKind {
  const kinds: StepKind[] = ['skill', 'prompt', 'tool', 'workflow', 'bridge', 'condition', 'switch', 'loop'];
  for (const k of kinds) if (step[ACTION_KIND_FIELD[k]] != null) return k;
  return 'prompt';
}

// ---------------------------------------------------------------------------
// Edge derivation
// ---------------------------------------------------------------------------

/**
 * Project the node graph into the renderable edge set. One `needs` edge per
 * dependency (dependency → dependent), one branch edge per `then`/`else`/case/
 * default target, one `loop-body` edge per body member, and exactly one
 * `loop-exit` edge per loop node (loop → its first downstream non-body step, if
 * any) so the single "on done / on error → next" connector is always present.
 */
export function deriveEdges(nodes: ReadonlyArray<BuilderNode>): BuilderEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  const edges: BuilderEdge[] = [];
  const loopBodyOf = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (n.kind === 'loop' && n.loop) loopBodyOf.set(n.id, new Set(n.loop.body));
  }

  for (const node of nodes) {
    for (const dep of node.needs) {
      if (!ids.has(dep)) continue;
      // A body step's `needs: [loop]` edge is rendered as loop-body, not needs,
      // so the canvas shows the containment region instead of a plain arrow.
      const body = loopBodyOf.get(dep);
      if (body?.has(node.id)) continue;
      edges.push({ id: `needs:${dep}->${node.id}`, kind: 'needs', from: dep, to: node.id });
    }
    if (node.kind === 'condition') {
      for (const t of node.then ?? []) {
        if (ids.has(t)) edges.push({ id: `then:${node.id}->${t}`, kind: 'then', from: node.id, to: t });
      }
      for (const t of node.else ?? []) {
        if (ids.has(t)) edges.push({ id: `else:${node.id}->${t}`, kind: 'else', from: node.id, to: t });
      }
    }
    if (node.kind === 'switch') {
      for (const [caseId, targets] of Object.entries(node.cases ?? {})) {
        for (const t of targets) {
          if (ids.has(t)) {
            edges.push({ id: `case:${node.id}:${caseId}->${t}`, kind: 'case', from: node.id, to: t, caseId });
          }
        }
      }
      for (const t of node.default ?? []) {
        if (ids.has(t)) edges.push({ id: `default:${node.id}->${t}`, kind: 'default', from: node.id, to: t });
      }
    }
    if (node.kind === 'loop' && node.loop) {
      for (const t of node.loop.body) {
        if (ids.has(t)) edges.push({ id: `body:${node.id}->${t}`, kind: 'loop-body', from: node.id, to: t });
      }
      const exit = loopExitTarget(node, nodes);
      if (exit) edges.push({ id: `exit:${node.id}->${exit}`, kind: 'loop-exit', from: node.id, to: exit });
    }
  }
  return edges;
}

/**
 * The single node a loop continues to once it stops: the first non-body step
 * that `needs` the loop node. Returns null when nothing follows the loop (the
 * loop is the tail of the graph) — the renderer then shows a dangling "→ end".
 */
export function loopExitTarget(loop: BuilderNode, nodes: ReadonlyArray<BuilderNode>): string | null {
  if (loop.kind !== 'loop' || !loop.loop) return null;
  const body = new Set(loop.loop.body);
  for (const n of nodes) {
    if (n.id === loop.id || body.has(n.id)) continue;
    if (n.needs.includes(loop.id)) return n.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auto-layout
// ---------------------------------------------------------------------------

const NODE_GAP_X = 280;
const NODE_GAP_Y = 150;

/**
 * A simple longest-path layered layout over `needs` edges: x = depth column, y
 * = stacking within the column. Good enough to open an un-laid-out workflow as
 * a left-to-right graph; the user can then drag nodes and the positions persist.
 */
export function autoLayout(steps: ReadonlyArray<WorkflowStep>): Array<{ x: number; y: number }> {
  const ids = steps.map((s) => s.id);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const depth = new Map<string, number>();

  const resolve = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0; // cycle guard — server validation will reject it
    seen.add(id);
    const step = byId.get(id);
    const needs = step?.needs ?? [];
    const d = needs.length === 0 ? 0 : Math.max(...needs.map((n) => resolve(n, seen) + 1));
    depth.set(id, d);
    seen.delete(id);
    return d;
  };
  for (const id of ids) resolve(id, new Set());

  const rowByCol = new Map<number, number>();
  return steps.map((s) => {
    const col = depth.get(s.id) ?? 0;
    const row = rowByCol.get(col) ?? 0;
    rowByCol.set(col, row + 1);
    return { x: col * NODE_GAP_X + 40, y: row * NODE_GAP_Y + 40 };
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapValues<T, U>(obj: Record<string, T>, fn: (v: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

/** Drop `undefined` values recursively so the YAML emitter never sees them. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
