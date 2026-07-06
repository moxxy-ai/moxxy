import {
  type Workflow,
  type WorkflowRunDeps,
  type WorkflowRunResult,
  type WorkflowStep,
  type WorkflowStepStatus,
} from '@moxxy/sdk';
import { type WorkflowRunDepsWithStore } from '../run-store.js';
import { stepsToSkipForBranch } from '../logic-response.js';
import { type TemplateScope } from '../template.js';

/**
 * Maximum nested-workflow recursion depth. This is the *structural* guard: a
 * workflow whose step calls another workflow, whose step calls another, … is
 * cut off here. It composes with — but is independent of — two other caps:
 *   - the while-`loop` node's `maxIterations` (a temporal cap on repetition,
 *     enforced per-loop in {@link runLoopStep}); a loop body that spawns nested
 *     workflows still bottoms out at this depth cap, so an N-iteration loop of
 *     depth-D nesting can never exceed D regardless of N.
 *   - the CLI's `MAX_AFTER_WORKFLOW_CHAIN` (an inter-workflow *trigger* graph
 *     cap in `cli/src/setup/workflows.ts`), which guards the event-driven
 *     afterWorkflow re-fire graph — a different graph entirely.
 */
export const MAX_NESTING_DEPTH = 5;

export const FINALIZE_REPLY_SUFFIX =
  '\n\nFinalize now: consolidate the operator\'s answers into a clear structured response. ' +
  'Include every field the step instructions require. Do not ask further questions.';

export type StepRuntimeStatus = 'pending' | WorkflowStepStatus;

export interface StepState {
  status: StepRuntimeStatus;
  output: string;
  error?: string;
  startedAt: number;
  endedAt: number;
}

export interface ExecutorContext {
  workflow: Workflow;
  deps: WorkflowRunDepsWithStore;
  inputs: Record<string, unknown>;
  vars: Record<string, unknown>;
  states: Map<string, StepState>;
  now: () => number;
  /**
   * Step ids that belong to a `loop` body. The main scheduler never runs them
   * directly — the owning loop step runs them internally each iteration — so
   * they are excluded from the ready set and from `when`-skip resolution.
   */
  loopBodyIds: Set<string>;
  /**
   * Run a nested workflow. Injected by the scheduler so the step layer can
   * recurse without importing the scheduler (which imports the step layer) —
   * keeps the module graph acyclic.
   */
  runNested: (workflow: Workflow, deps: WorkflowRunDeps) => Promise<WorkflowRunResult>;
}

export interface StepOutcome {
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
  readonly paused?: boolean;
  readonly interactionAgentId?: string;
  readonly vars?: Record<string, unknown>;
  readonly branchRoute?: 'then' | 'else' | string;
}

export type LoggerOpts = { logger?: { warn?(msg: string, meta?: Record<string, unknown>): void } };

export function collectLoopBodyIds(workflow: Workflow): Set<string> {
  const ids = new Set<string>();
  for (const step of workflow.steps) {
    if (step.loop) for (const id of step.loop.body) ids.add(id);
  }
  return ids;
}

export function nowFn(deps: WorkflowRunDeps): () => number {
  return deps.now ?? (() => Date.now());
}

export function resolveInputs(workflow: Workflow, deps: WorkflowRunDeps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(workflow.inputs)) {
    if (spec.default !== undefined) out[name] = spec.default;
  }
  for (const [name, value] of Object.entries(deps.inputs ?? {})) {
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export function buildScope(ctx: ExecutorContext, nowIso: string): TemplateScope {
  const steps: Record<string, { output: string }> = {};
  for (const [id, st] of ctx.states) steps[id] = { output: st.output };
  return {
    steps,
    inputs: ctx.inputs,
    vars: ctx.vars,
    ...(ctx.deps.trigger != null ? { trigger: ctx.deps.trigger } : {}),
    now: nowIso,
  };
}

/**
 * Keys that would mutate the prototype chain rather than set an own property.
 * Logic-step `vars` come from model output, so a hostile/garbled response could
 * carry `__proto__`/`constructor`/`prototype` — drop them when merging.
 */
const UNSAFE_VAR_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function mergeVars(ctx: ExecutorContext, vars: Record<string, unknown> | undefined): void {
  if (!vars) return;
  for (const [key, value] of Object.entries(vars)) {
    if (UNSAFE_VAR_KEYS.has(key)) {
      const logger = ctx.deps.logger;
      if (logger?.warn) logger.warn('workflow vars: dropping prototype-pollution key', { key });
      continue;
    }
    // Own-property assignment only (skips inherited keys that Object.entries
    // wouldn't surface anyway, but keeps the intent explicit).
    Object.defineProperty(ctx.vars, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}

export async function applyBranchSkips(
  ctx: ExecutorContext,
  gate: WorkflowStep,
  selected: 'then' | 'else' | string,
): Promise<void> {
  for (const id of stepsToSkipForBranch(gate, selected)) {
    const st = ctx.states.get(id);
    if (!st || st.status !== 'pending') continue;
    st.status = 'skipped';
    st.startedAt = st.endedAt = ctx.now();
    await ctx.deps.emit?.('workflow_step_skipped', { id, reason: `branch:${gate.id}` });
  }
}

/** Concatenate the outputs of completed terminal (sink) steps. */
export function sinkOutput(workflow: Workflow, states: Map<string, StepState>): string {
  const needed = new Set<string>();
  for (const step of workflow.steps) for (const dep of step.needs) needed.add(dep);
  const sinks = workflow.steps.filter((s) => !needed.has(s.id));
  const completed = sinks
    .map((s) => states.get(s.id))
    .filter((st): st is StepState => st?.status === 'completed' && st.output.length > 0);
  if (completed.length > 0) return completed.map((s) => s.output).join('\n\n');
  // Fall back to the last completed step's output.
  const lastCompleted = [...states.values()].filter((s) => s.status === 'completed').pop();
  return lastCompleted?.output ?? '';
}
