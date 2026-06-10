import {
  defineWorkflowExecutor,
  type SessionId,
  type SubagentSpec,
  type Workflow,
  type WorkflowExecutorDef,
  type WorkflowRunDeps,
  type WorkflowRunResult,
  type WorkflowRunStatus,
  type WorkflowStep,
  type WorkflowStepResult,
  type WorkflowStepStatus,
} from '@moxxy/sdk';
import {
  defaultWorkflowRunStore,
  type SerializedStepState,
  type WorkflowRunDepsWithStore,
  type WorkflowRunStore,
} from '../run-store.js';
import {
  logicSystemPrompt,
  parseLogicResponse,
  resolveBranchForCondition,
  resolveBranchForSwitch,
  stepsToSkipForBranch,
  wantsPlainResponse,
} from '../logic-response.js';
import { evalCondition, renderArgs, renderTemplate, type TemplateScope } from '../template.js';

export const DAG_EXECUTOR_NAME = 'dag';

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
const MAX_NESTING_DEPTH = 5;

const FINALIZE_REPLY_SUFFIX =
  '\n\nFinalize now: consolidate the operator\'s answers into a clear structured response. ' +
  'Include every field the step instructions require. Do not ask further questions.';

type StepRuntimeStatus = 'pending' | WorkflowStepStatus;

interface StepState {
  status: StepRuntimeStatus;
  output: string;
  error?: string;
  startedAt: number;
  endedAt: number;
}

interface ExecutorContext {
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
}

function collectLoopBodyIds(workflow: Workflow): Set<string> {
  const ids = new Set<string>();
  for (const step of workflow.steps) {
    if (step.loop) for (const id of step.loop.body) ids.add(id);
  }
  return ids;
}

function nowFn(deps: WorkflowRunDeps): () => number {
  return deps.now ?? (() => Date.now());
}

function resolveInputs(workflow: Workflow, deps: WorkflowRunDeps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(workflow.inputs)) {
    if (spec.default !== undefined) out[name] = spec.default;
  }
  for (const [name, value] of Object.entries(deps.inputs ?? {})) {
    if (value !== undefined) out[name] = value;
  }
  return out;
}

function buildScope(ctx: ExecutorContext, nowIso: string): TemplateScope {
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

function mergeVars(ctx: ExecutorContext, vars: Record<string, unknown> | undefined): void {
  if (!vars) return;
  Object.assign(ctx.vars, vars);
}

async function applyBranchSkips(
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

function serializeStates(states: Map<string, StepState>): Record<string, SerializedStepState> {
  const out: Record<string, SerializedStepState> = {};
  for (const [id, st] of states) {
    out[id] = {
      status: st.status === 'pending' ? 'pending' : st.status,
      output: st.output,
      ...(st.error ? { error: st.error } : {}),
      startedAt: st.startedAt,
      endedAt: st.endedAt,
    };
  }
  return out;
}

function restoreStates(raw: Record<string, SerializedStepState>): Map<string, StepState> {
  const states = new Map<string, StepState>();
  for (const [id, st] of Object.entries(raw)) {
    states.set(id, {
      status: st.status as StepRuntimeStatus,
      output: st.output,
      ...(st.error ? { error: st.error } : {}),
      startedAt: st.startedAt,
      endedAt: st.endedAt,
    });
  }
  return states;
}

function buildStepResults(workflow: Workflow, states: Map<string, StepState>): WorkflowStepResult[] {
  return workflow.steps.map((step) => {
    const st = states.get(step.id)!;
    const status: WorkflowStepStatus =
      st.status === 'pending' ? 'skipped' : (st.status as WorkflowStepStatus);
    return {
      id: step.id,
      status,
      output: st.output,
      ...(st.error ? { error: st.error } : {}),
      startedAt: st.startedAt,
      endedAt: st.endedAt,
    };
  });
}

function buildRunResult(
  ctx: ExecutorContext,
  status: WorkflowRunStatus,
  ok: boolean,
  extra?: Partial<WorkflowRunResult>,
): WorkflowRunResult {
  const output = status === 'completed' ? sinkOutput(ctx.workflow, ctx.states) : '';
  return {
    ok,
    status,
    steps: buildStepResults(ctx.workflow, ctx.states),
    output,
    ...extra,
  };
}

async function runExecutorLoop(ctx: ExecutorContext): Promise<WorkflowRunResult> {
  const { workflow, deps } = ctx;

  await deps.emit?.('workflow_started', { name: workflow.name, steps: workflow.steps.length });

  const settled = (id: string): boolean => {
    const s = ctx.states.get(id)?.status;
    return s === 'completed' || s === 'skipped' || s === 'failed';
  };

  let aborted = false;
  let abortReason: string | undefined;

  while (!aborted) {
    if (deps.signal.aborted) {
      abortReason = 'aborted';
      break;
    }

    // 1. Resolve any newly-ready steps whose `when` is false → skip them.
    //    Loop so a skip that unblocks another skip settles in one pass.
    let skippedSomething = true;
    while (skippedSomething) {
      skippedSomething = false;
      for (const step of workflow.steps) {
        if (ctx.loopBodyIds.has(step.id)) continue; // owned by a loop
        const st = ctx.states.get(step.id)!;
        if (st.status !== 'pending') continue;
        if (!step.needs.every(settled)) continue;
        if (step.when == null) continue;
        const scope = buildScope(ctx, new Date(ctx.now()).toISOString());
        let keep: boolean;
        try {
          keep = evalCondition(step.when, scope);
        } catch (err) {
          // A malformed condition that slipped past validation fails the step.
          st.status = 'failed';
          st.error = `when: ${err instanceof Error ? err.message : String(err)}`;
          st.startedAt = st.endedAt = ctx.now();
          await deps.emit?.('workflow_step_failed', { id: step.id, error: st.error });
          if (step.onError !== 'continue') {
            aborted = true;
            abortReason = st.error;
          }
          skippedSomething = true;
          continue;
        }
        if (!keep) {
          st.status = 'skipped';
          st.startedAt = st.endedAt = ctx.now();
          await deps.emit?.('workflow_step_skipped', { id: step.id });
          skippedSomething = true;
        }
      }
      if (aborted) break;
    }
    if (aborted) break;

    // 2. Gather ready executable steps (deps settled, when true / absent).
    //    Loop-body steps are owned by their loop and never scheduled here.
    const ready = workflow.steps.filter((step) => {
      if (ctx.loopBodyIds.has(step.id)) return false;
      const st = ctx.states.get(step.id)!;
      return st.status === 'pending' && step.needs.every(settled);
    });

    if (ready.length === 0) {
      const anyPending = [...ctx.states.values()].some((s) => s.status === 'pending');
      if (anyPending) {
        abortReason = 'workflow stalled — no runnable steps (check needs/when)';
        aborted = true;
      }
      break;
    }

    // 3. Run a wave (cap at concurrency). Logic/branch/pause steps mutate
    //    shared state (vars, branch skips, checkpoints), so the wave runs
    //    sequentially within itself; independent steps still settle together
    //    across iterations.
    const wave = ready.slice(0, Math.max(1, workflow.concurrency));
    const scope = buildScope(ctx, new Date(ctx.now()).toISOString());

    for (const step of wave) {
      const st = ctx.states.get(step.id)!;
      st.startedAt = ctx.now();
      await deps.emit?.('workflow_step_started', {
        id: step.id,
        label: step.label ?? step.id,
      });
      const outcome = await runStep(step, scope, ctx);
      st.endedAt = ctx.now();

      if (outcome.paused) {
        st.status = 'awaiting_input';
        st.output = outcome.output;
        await deps.emit?.('workflow_step_awaiting_input', {
          id: step.id,
          label: step.label ?? step.id,
          preview: outcome.output.slice(0, 280),
          childSessionId: outcome.interactionAgentId,
        });
        const store = deps.runStore ?? defaultWorkflowRunStore;
        const runId = await store.save({
          workflow,
          trigger: deps.trigger ?? 'manual',
          inputs: ctx.inputs,
          states: serializeStates(ctx.states),
          pendingStepId: step.id,
          interactionAgentId: outcome.interactionAgentId!,
          startedAt: ctx.now(),
        });
        await deps.emit?.('workflow_paused', {
          runId,
          stepId: step.id,
          childSessionId: outcome.interactionAgentId,
        });
        return buildRunResult(ctx, 'paused', true, {
          runId,
          pendingStepId: step.id,
          ...(outcome.interactionAgentId ? { interactionAgentId: outcome.interactionAgentId } : {}),
        });
      }

      if (outcome.ok) {
        st.status = 'completed';
        st.output = outcome.output;
        mergeVars(ctx, outcome.vars);
        if (outcome.branchRoute != null) {
          await applyBranchSkips(ctx, step, outcome.branchRoute);
        }
        await deps.emit?.('workflow_step_completed', {
          id: step.id,
          preview: outcome.output.slice(0, 280),
        });
      } else {
        st.status = 'failed';
        st.error = outcome.error;
        await deps.emit?.('workflow_step_failed', { id: step.id, error: outcome.error });
        if (step.onError !== 'continue') {
          aborted = true;
          abortReason = `step "${step.id}" failed: ${outcome.error}`;
        }
      }
    }
  }

  // A run is "ok" when it reached the end without a hard abort. A failure on
  // a step whose `onError` is `continue` is tolerated by the author, so it
  // does not flip the run to failed — the per-step status still records it.
  const ok = !aborted;
  const output = sinkOutput(workflow, ctx.states);

  if (ok) {
    await deps.emit?.('workflow_completed', { name: workflow.name, output: output.slice(0, 280) });
    return buildRunResult(ctx, 'completed', true, { output });
  }

  await deps.emit?.('workflow_failed', { name: workflow.name, error: abortReason });
  return buildRunResult(ctx, 'failed', false, {
    output,
    error: abortReason ?? 'workflow failed',
  });
}

async function runExecutor(workflow: Workflow, deps: WorkflowRunDeps): Promise<WorkflowRunResult> {
  const ctx: ExecutorContext = {
    workflow,
    deps: deps as WorkflowRunDepsWithStore,
    inputs: resolveInputs(workflow, deps),
    vars: {},
    states: new Map(),
    now: nowFn(deps),
    loopBodyIds: collectLoopBodyIds(workflow),
  };
  for (const step of workflow.steps) {
    ctx.states.set(step.id, { status: 'pending', output: '', startedAt: 0, endedAt: 0 });
  }
  return runExecutorLoop(ctx);
}

/**
 * Resume a paused (`awaitInput`) run: load its checkpoint, replay the operator
 * reply into the retained child session via `spawner.continue`, then drive the
 * rest of the DAG from the restored state.
 */
export async function resumeWorkflowRun(
  runId: string,
  userMessage: string,
  deps: WorkflowRunDeps,
  store: WorkflowRunStore = defaultWorkflowRunStore,
): Promise<WorkflowRunResult> {
  const checkpoint = await store.load(runId);
  if (!checkpoint) {
    return {
      ok: false,
      status: 'failed',
      steps: [],
      output: '',
      error: `no paused workflow run "${runId}"`,
    };
  }

  const depsWithStore = { ...deps, runStore: store } as WorkflowRunDepsWithStore;
  const step = checkpoint.workflow.steps.find((s) => s.id === checkpoint.pendingStepId);
  if (!step) {
    return {
      ok: false,
      status: 'failed',
      steps: buildStepResults(checkpoint.workflow, restoreStates(checkpoint.states)),
      output: '',
      error: `paused step "${checkpoint.pendingStepId}" not found`,
    };
  }

  const ctx: ExecutorContext = {
    workflow: checkpoint.workflow,
    deps: depsWithStore,
    inputs: checkpoint.inputs,
    vars: {},
    states: restoreStates(checkpoint.states),
    now: nowFn(deps),
    loopBodyIds: collectLoopBodyIds(checkpoint.workflow),
  };

  const st = ctx.states.get(step.id)!;
  await deps.emit?.('workflow_resumed', { runId, stepId: step.id });

  if (typeof deps.spawner.continue !== 'function') {
    st.status = 'failed';
    st.error = 'subagent spawner does not support resume (continue)';
    st.endedAt = ctx.now();
    await deps.emit?.('workflow_step_failed', { id: step.id, error: st.error });
    await store.remove(runId);
    return buildRunResult(ctx, 'failed', false, { error: st.error });
  }

  const finalizePrompt = `Operator reply:\n${userMessage.trim()}${FINALIZE_REPLY_SUFFIX}`;
  try {
    const child = await deps.spawner.continue({
      childSessionId: checkpoint.interactionAgentId as SessionId,
      prompt: finalizePrompt,
      label: step.label ?? step.id,
    });
    if (child.error) throw new Error(child.error.message);
    st.status = 'completed';
    st.output = child.text;
    st.endedAt = ctx.now();
    await deps.emit?.('workflow_step_completed', {
      id: step.id,
      preview: child.text.slice(0, 280),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    st.status = 'failed';
    st.error = message;
    st.endedAt = ctx.now();
    await deps.emit?.('workflow_step_failed', { id: step.id, error: message });
    await store.remove(runId);
    return buildRunResult(ctx, 'failed', false, { error: message });
  }

  await store.remove(runId);
  return runExecutorLoop(ctx);
}

/** Concatenate the outputs of completed terminal (sink) steps. */
function sinkOutput(workflow: Workflow, states: Map<string, StepState>): string {
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

interface StepOutcome {
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
  readonly paused?: boolean;
  readonly interactionAgentId?: string;
  readonly vars?: Record<string, unknown>;
  readonly branchRoute?: 'then' | 'else' | string;
}

async function runStep(
  step: WorkflowStep,
  scope: TemplateScope,
  ctx: ExecutorContext,
): Promise<StepOutcome> {
  const attempts = 1 + Math.max(0, step.retries);
  let lastError = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (ctx.deps.signal.aborted) return { ok: false, output: '', error: 'aborted' };
    try {
      return await runStepOnce(step, scope, ctx);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      ctx.deps.logger?.warn?.('workflow step attempt failed', {
        step: step.id,
        attempt: attempt + 1,
        error: lastError,
      });
    }
  }
  return { ok: false, output: '', error: lastError };
}

async function runStepOnce(
  step: WorkflowStep,
  scope: TemplateScope,
  ctx: ExecutorContext,
): Promise<StepOutcome> {
  const { deps } = ctx;
  const opts = deps.logger ? { logger: deps.logger } : {};

  if (step.loop != null) {
    return runLoopStep(step, ctx, opts);
  }

  if (step.bridge != null || step.condition != null || step.switch != null) {
    return runLogicStep(step, scope, ctx, opts);
  }

  if (step.tool) {
    const args = renderArgs(step.args ?? {}, scope, opts);
    const result = await deps.tools.execute(step.tool, args, deps.signal);
    const output = typeof result === 'string' ? result : JSON.stringify(result ?? '');
    return { ok: true, output };
  }

  if (step.workflow) {
    return runNestedWorkflow(step, scope, ctx, opts);
  }

  // skill / prompt → run a child agent and capture its final text.
  const spec = buildSubagentSpecWithDeps(step, scope, deps, opts);
  if (step.awaitInput) {
    const child = await deps.spawner.spawn({ ...spec, retainSession: true });
    if (child.error) throw new Error(child.error.message);
    return {
      ok: false,
      output: child.text,
      paused: true,
      interactionAgentId: String(child.childSessionId),
    };
  }

  const child = await deps.spawner.spawn(spec);
  if (child.error) throw new Error(child.error.message);
  return { ok: true, output: child.text };
}

type LoggerOpts = { logger?: { warn?(msg: string, meta?: Record<string, unknown>): void } };

async function runNestedWorkflow(
  step: WorkflowStep,
  scope: TemplateScope,
  ctx: ExecutorContext,
  opts: LoggerOpts,
): Promise<StepOutcome> {
  const { deps } = ctx;
  const nested = deps.lookup.workflow(step.workflow!);
  if (!nested) throw new Error(`nested workflow "${step.workflow}" not found`);
  const depth = (deps.depth ?? 0) + 1;
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error(`nested workflow depth exceeded ${MAX_NESTING_DEPTH}`);
  }
  const nestedInputs = renderArgs(step.args ?? {}, scope, opts) as Record<string, unknown>;
  const result = await runExecutor(nested, {
    ...deps,
    inputs: nestedInputs,
    depth,
    trigger: `workflow:${step.workflow}`,
  });
  if (result.status === 'paused') {
    return {
      ok: false,
      output: result.output,
      paused: true,
      ...(result.interactionAgentId ? { interactionAgentId: result.interactionAgentId } : {}),
    };
  }
  if (!result.ok) throw new Error(result.error ?? `nested workflow "${step.workflow}" failed`);
  return { ok: true, output: result.output };
}

function buildUpstreamBlock(
  step: WorkflowStep,
  scope: TemplateScope,
): string {
  if (step.needs.length === 0) return '';
  const parts = step.needs.map((id) => `### ${id}\n${scope.steps?.[id]?.output ?? ''}`);
  return `\n\n## Upstream\n${parts.join('\n\n')}`;
}

async function runLogicStep(
  step: WorkflowStep,
  scope: TemplateScope,
  ctx: ExecutorContext,
  opts: LoggerOpts,
): Promise<StepOutcome> {
  const instruction = step.bridge ?? step.condition ?? step.switch ?? '';
  const format = wantsPlainResponse(step) ? 'plain' : 'json';
  if ((step.condition != null || step.switch != null) && format === 'plain') {
    return { ok: false, output: '', error: 'condition/switch steps require JSON responses' };
  }

  const userPrompt = renderTemplate(instruction, scope, opts) + buildUpstreamBlock(step, scope);

  const spec: SubagentSpec = {
    prompt: userPrompt,
    ...(format === 'json' ? { systemPrompt: logicSystemPrompt() } : {}),
    label: step.label ?? step.id,
    allowedTools: [],
  };

  const child = await ctx.deps.spawner.spawn(spec);
  if (child.error) return { ok: false, output: '', error: child.error.message };

  try {
    const parsed = parseLogicResponse(child.text, step, format);
    let branchRoute: 'then' | 'else' | string | undefined;

    if (step.condition != null) {
      const route = resolveBranchForCondition(step, parsed.branch);
      if (!route) {
        return {
          ok: false,
          output: child.text,
          error: `condition step "${step.id}": expected branch "then" or "else", got ${JSON.stringify(parsed.branch)}`,
        };
      }
      branchRoute = route;
    }

    if (step.switch != null) {
      const route = resolveBranchForSwitch(step, parsed.branch);
      if (!route) {
        return {
          ok: false,
          output: child.text,
          error: `switch step "${step.id}": unknown branch ${JSON.stringify(parsed.branch)}`,
        };
      }
      branchRoute = route;
    }

    return {
      ok: true,
      output: parsed.output,
      ...(parsed.vars ? { vars: parsed.vars } : {}),
      ...(branchRoute != null ? { branchRoute } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: child.text, error: message };
  }
}

/**
 * Bounded while-loop node. Each iteration:
 *   1. resets every body step's runtime state (so it re-runs cleanly);
 *   2. runs the body steps in declared order, merging any logic-step `vars`
 *      and honoring `onError` (a body step that fails with onError≠'continue'
 *      aborts the loop with that step's error);
 *   3. evaluates `loop.condition` via the SAME LLM predicate as a `condition`
 *      step — `then` = run another iteration, `else` = stop.
 *
 * It always terminates: either the predicate says stop, a body step aborts, or
 * `maxIterations` is reached (in which case the loop completes cleanly with a
 * "max iterations reached" note rather than hanging). Composes with
 * {@link MAX_NESTING_DEPTH}: a body step that calls a nested workflow still
 * obeys the depth cap, so the iteration cap and the depth cap are independent
 * guards and neither can be defeated by the other — no infinite loop is
 * possible.
 */
async function runLoopStep(
  step: WorkflowStep,
  ctx: ExecutorContext,
  opts: LoggerOpts,
): Promise<StepOutcome> {
  const loop = step.loop!;
  const max = loop.maxIterations;
  const bodySteps = loop.body
    .map((id) => ctx.workflow.steps.find((s) => s.id === id))
    .filter((s): s is WorkflowStep => s != null);

  let iteration = 0;
  let lastBodyOutput = '';

  for (; iteration < max; iteration++) {
    await ctx.deps.emit?.('workflow_step_started', {
      id: step.id,
      label: `${step.label ?? step.id} (iteration ${iteration + 1})`,
    });

    // Each iteration runs the body fresh: reset state for re-runnable steps.
    for (const body of bodySteps) {
      const bst = ctx.states.get(body.id)!;
      bst.status = 'pending';
      bst.output = '';
      delete bst.error;
    }

    for (const body of bodySteps) {
      if (ctx.deps.signal.aborted) return { ok: false, output: lastBodyOutput, error: 'aborted' };
      const bodyScope = buildScope(ctx, new Date(ctx.now()).toISOString());
      const bst = ctx.states.get(body.id)!;
      bst.startedAt = ctx.now();
      const outcome = await runStep(body, bodyScope, ctx);
      bst.endedAt = ctx.now();
      if (outcome.paused) {
        // awaitInput inside a loop body is not supported — it would require
        // checkpointing mid-iteration. Schema bars awaitInput on loop steps,
        // but a body prompt could still set it; fail loudly rather than hang.
        return {
          ok: false,
          output: lastBodyOutput,
          error: `loop "${step.id}": body step "${body.id}" cannot pause for input`,
        };
      }
      if (outcome.ok) {
        bst.status = 'completed';
        bst.output = outcome.output;
        lastBodyOutput = outcome.output;
        mergeVars(ctx, outcome.vars);
      } else {
        bst.status = 'failed';
        bst.error = outcome.error;
        if (body.onError !== 'continue') {
          return {
            ok: false,
            output: lastBodyOutput,
            error: `loop "${step.id}": body step "${body.id}" failed: ${outcome.error}`,
          };
        }
      }
    }

    // Evaluate the continue/stop predicate via the shared logic mechanism.
    const decision = await evaluateLoopCondition(step, loop.condition, ctx, opts);
    if (!decision.ok) {
      return { ok: false, output: lastBodyOutput, error: decision.error };
    }
    if (decision.route === 'else') {
      // Predicate says stop — loop completes normally.
      return {
        ok: true,
        output: `loop "${step.id}" stopped after ${iteration + 1} iteration(s).\n\n${lastBodyOutput}`.trim(),
      };
    }
    // route === 'then' → run another iteration (subject to the cap).
  }

  // Reached the iteration cap without the predicate saying stop. Finish
  // cleanly with a clear note — never hang.
  ctx.deps.logger?.warn?.('workflow loop hit max iterations', { step: step.id, maxIterations: max });
  return {
    ok: true,
    output:
      `loop "${step.id}" reached max iterations (${max}); stopping.` +
      (lastBodyOutput ? `\n\n${lastBodyOutput}` : ''),
  };
}

/** Run the loop's continue/stop predicate as a no-tools JSON logic turn. */
async function evaluateLoopCondition(
  step: WorkflowStep,
  condition: string,
  ctx: ExecutorContext,
  opts: LoggerOpts,
): Promise<{ ok: true; route: 'then' | 'else' } | { ok: false; error: string }> {
  const scope = buildScope(ctx, new Date(ctx.now()).toISOString());
  const userPrompt =
    renderTemplate(condition, scope, opts) +
    '\n\nDecide whether to continue the loop. Reply with {"branch":"then"} to run another iteration, or {"branch":"else"} to stop.';

  const spec: SubagentSpec = {
    prompt: userPrompt,
    systemPrompt: logicSystemPrompt(),
    label: `${step.label ?? step.id} (condition)`,
    allowedTools: [],
  };
  const child = await ctx.deps.spawner.spawn(spec);
  if (child.error) return { ok: false, error: child.error.message };

  try {
    const parsed = parseLogicResponse(child.text, step, 'json');
    const route = resolveBranchForCondition(step, parsed.branch);
    if (!route) {
      return {
        ok: false,
        error: `loop "${step.id}" condition: expected branch "then" or "else", got ${JSON.stringify(parsed.branch)}`,
      };
    }
    mergeVars(ctx, parsed.vars);
    return { ok: true, route };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function buildSubagentSpecWithDeps(
  step: WorkflowStep,
  scope: TemplateScope,
  deps: WorkflowRunDeps,
  opts: LoggerOpts,
): SubagentSpec {
  const label = step.label ?? step.id;
  const renderedInput = step.input ? renderTemplate(step.input, scope, opts) : '';

  if (step.skill) {
    const skill = deps.lookup.skill(step.skill);
    if (!skill) throw new Error(`skill "${step.skill}" not found`);
    const allowed = skill.frontmatter['allowed-tools'];
    const prompt =
      renderedInput ||
      `Follow the "${skill.frontmatter.name}" playbook in your system prompt.`;
    const spec: SubagentSpec = {
      prompt,
      systemPrompt: skill.body,
      label,
    };
    if (allowed && allowed.length > 0) (spec as { allowedTools?: ReadonlyArray<string> }).allowedTools = allowed;
    return spec;
  }

  // prompt step
  return { prompt: renderTemplate(step.prompt ?? '', scope, opts), label };
}

export const dagExecutor: WorkflowExecutorDef = defineWorkflowExecutor({
  name: DAG_EXECUTOR_NAME,
  description: 'Parallel DAG runner: steps with settled dependencies run in waves up to `concurrency`.',
  run: runExecutor,
});
