/**
 * The builder's canvas data model — a normalized, framework-agnostic view of a
 * {@link Workflow} laid out as nodes + edges. It is deliberately a SUPERSET of
 * the on-disk {@link WorkflowStep} shape: every editable field of a step lives
 * on its node, and the DAG/branch/loop relationships are projected into typed
 * {@link BuilderEdge}s so a renderer can draw them without re-deriving topology.
 *
 * This module is pure data — no React, no DOM, no node built-ins — so it
 * import-cleanly under both the Electron renderer and the Expo (Hermes) bundle.
 */

import { assertDefined } from './assert.js';
import type {
  WorkflowDelivery,
  WorkflowInputSpec,
  WorkflowLogicStepFormat,
  WorkflowStepErrorMode,
  WorkflowTrigger,
  WorkflowUiViewport,
} from '@moxxy/sdk';

/** The eight mutually-exclusive step actions, mirrored from the SDK. */
export type StepKind =
  | 'skill'
  | 'prompt'
  | 'tool'
  | 'workflow'
  | 'bridge'
  | 'condition'
  | 'switch'
  | 'loop';

/** Loop config carried on a `loop` node (mirrors `WorkflowLoopAction`). */
export interface BuilderLoop {
  /** Ordered step ids that run once per iteration. */
  body: string[];
  /** EXIT/GOAL predicate — met → stop the loop, continue to the next step. */
  condition: string;
  /** Hard iteration cap (1..50). */
  maxIterations: number;
}

/**
 * One node on the canvas — a workflow step plus its layout. The action field
 * matching {@link kind} holds the step's instruction/target; the others are
 * undefined. Branch targets (`then`/`else`/`cases`/`default`) and the loop body
 * are kept on the node so the inspector edits them in place; they are ALSO
 * projected into {@link BuilderEdge}s for rendering.
 */
export interface BuilderNode {
  readonly id: string;
  kind: StepKind;
  label?: string;
  /** Canvas position (persisted to `ui.layout.nodes[id]`). */
  x: number;
  y: number;

  // --- action payloads (only the one matching `kind` is set) ---
  /** skill name / prompt text / tool name / workflow name / logic instruction. */
  action: string;
  /** Templated instruction for skill steps. */
  input?: string;
  /** Templated args object for tool/workflow steps. */
  args?: Record<string, unknown>;
  /** Branch lists for condition steps. */
  then?: string[];
  else?: string[];
  /** Branch map for switch steps. */
  cases?: Record<string, string[]>;
  default?: string[];
  /** Loop config for loop steps. */
  loop?: BuilderLoop;

  // --- shared step fields ---
  /** DAG dependencies (also projected as `needs` edges). */
  needs: string[];
  when?: string;
  onError: WorkflowStepErrorMode;
  retries: number;
  format?: WorkflowLogicStepFormat;
  awaitInput?: boolean;
}

/** How an edge relates two nodes — drives its label + visual treatment. */
export type EdgeKind = 'needs' | 'then' | 'else' | 'case' | 'default' | 'loop-body' | 'loop-exit';

/**
 * A directed edge between two nodes, derived from the step graph. `needs` edges
 * point from the dependency to the dependent (data-flow direction). Branch/loop
 * edges point from the gate/loop node to a target. `caseId` is set only for
 * `case` edges. `loop-exit` is the single edge a loop takes once its condition
 * is met (or a body step errors) — there is exactly one per loop node.
 */
export interface BuilderEdge {
  readonly id: string;
  readonly kind: EdgeKind;
  readonly from: string;
  readonly to: string;
  /** Label for `case` edges (the switch case id). */
  readonly caseId?: string;
}

/** Workflow-level metadata edited in the builder's header, not on any node. */
export interface BuilderMeta {
  name: string;
  description: string;
  enabled: boolean;
  version: number;
  concurrency: number;
  inputs: Record<string, WorkflowInputSpec>;
  on?: WorkflowTrigger;
  /** Session this workflow's triggered runs are pinned to (where they run + display). */
  targetSessionId?: string;
  delivery?: WorkflowDelivery;
}

/** Pan/zoom of the canvas (persisted to `ui.layout.viewport`). */
export type BuilderViewport = WorkflowUiViewport;

/**
 * The full builder state. Immutable from the reducer's point of view: every
 * operation returns a fresh object (structural sharing where cheap). `dirty`
 * flips true on any content edit and back to false after a successful save.
 */
export interface BuilderState {
  readonly meta: BuilderMeta;
  readonly nodes: ReadonlyArray<BuilderNode>;
  readonly edges: ReadonlyArray<BuilderEdge>;
  readonly viewport: BuilderViewport;
  /** Currently-selected node id (drives the inspector), or null. */
  readonly selected: string | null;
  /** True when there are unsaved content changes. */
  readonly dirty: boolean;
  /**
   * Per-node validation errors keyed by node id, plus a `__workflow__` bucket
   * for graph-level / metadata issues that don't map to one node. Refreshed by
   * {@link applyValidation} after a `validateDraft` round-trip.
   */
  readonly errors: Readonly<Record<string, ReadonlyArray<string>>>;
}

/** The catch-all error bucket key for issues that don't bind to a node. */
export const WORKFLOW_ERROR_KEY = '__workflow__';

/** Human label + accent token per step kind (consumed by both UIs). */
export interface StepKindMeta {
  readonly kind: StepKind;
  readonly label: string;
  /** A semantic color name; each platform maps it to its own token. */
  readonly accent: 'blue' | 'green' | 'purple' | 'teal' | 'amber' | 'pink' | 'cyan' | 'orange';
  readonly description: string;
}

export const STEP_KINDS: ReadonlyArray<StepKindMeta> = [
  { kind: 'prompt', label: 'Prompt', accent: 'blue', description: 'Free-form instruction to a subagent.' },
  { kind: 'skill', label: 'Skill', accent: 'green', description: 'Run a named skill with an input.' },
  { kind: 'tool', label: 'Tool', accent: 'teal', description: 'Invoke a tool with templated args.' },
  { kind: 'workflow', label: 'Sub-workflow', accent: 'cyan', description: 'Run another workflow by name.' },
  { kind: 'bridge', label: 'Bridge', accent: 'amber', description: 'Extract/transform data into vars.' },
  { kind: 'condition', label: 'Condition', accent: 'orange', description: 'If/else routing on a predicate.' },
  { kind: 'switch', label: 'Switch', accent: 'pink', description: 'Multi-way routing on cases.' },
  { kind: 'loop', label: 'Loop', accent: 'purple', description: 'Repeat a body until a goal is met.' },
];

export function stepKindMeta(kind: StepKind): StepKindMeta {
  const meta = STEP_KINDS.find((k) => k.kind === kind) ?? STEP_KINDS[0];
  assertDefined(meta, 'STEP_KINDS is a non-empty constant array');
  return meta;
}
