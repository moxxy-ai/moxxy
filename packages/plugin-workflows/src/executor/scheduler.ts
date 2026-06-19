import {
  type SessionId,
  type Workflow,
  type WorkflowRunDeps,
  type WorkflowRunResult,
} from '@moxxy/sdk';
import {
  defaultWorkflowRunStore,
  type WorkflowRunDepsWithStore,
  type WorkflowRunStore,
} from '../run-store.js';
import { evalCondition } from '../template.js';
import {
  applyBranchSkips,
  buildScope,
  collectLoopBodyIds,
  FINALIZE_REPLY_SUFFIX,
  mergeVars,
  nowFn,
  resolveInputs,
  sinkOutput,
  type ExecutorContext,
} from './context.js';
import { buildRunResult, buildStepResults, restoreStates, serializeStates } from './state-serde.js';
import { runStep } from './steps.js';

export async function runExecutorLoop(
  ctx: ExecutorContext,
  resumed = false,
): Promise<WorkflowRunResult> {
  const { workflow, deps } = ctx;

  // Only a fresh run emits `workflow_started`. A resume already emitted
  // `workflow_resumed`; re-emitting `workflow_started` here (with the full step
  // count) would make a progress consumer that resets on `workflow_started`
  // wipe its already-settled steps mid-run.
  if (!resumed) {
    await deps.emit?.('workflow_started', { name: workflow.name, steps: workflow.steps.length });
  }

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

    // 3. Run a wave. `concurrency` caps the BATCH SIZE per scheduler pass; the
    //    steps in a wave are then executed STRICTLY SEQUENTIALLY (one awaited
    //    `runStep` at a time below) — there is NO actual parallelism, and
    //    `concurrency` therefore bounds only how many ready steps are drained per
    //    pass, not wall-clock latency.
    //
    //    Sequential execution is deliberate and load-bearing, NOT merely
    //    deferred: overlapping even the "pure" tool/prompt/skill steps cannot
    //    preserve the current observable contract, so parity is unprovable here:
    //      - Event ordering: each step emits `workflow_step_started` then its
    //        terminal `workflow_step_completed`/`workflow_step_failed` as an
    //        atomic, non-interleaved pair, in declared wave order. Consumers
    //        (progress UIs) rely on this; concurrent steps would interleave them.
    //      - Error semantics: a hard failure (onError≠'continue') earlier in the
    //        wave aborts the run and STOPS later same-wave steps from starting at
    //        all (see the loop below + the "hard failure breaks the rest of the
    //        wave" test). Concurrency would have already launched those steps,
    //        changing which steps run, which events fire, and the spend.
    //      - vars merge: logic-step `vars` merge into shared `ctx.vars` in wave
    //        order; reordering merges is observable when keys collide.
    //    Because these are all externally observable, no concurrent execution is
    //    provably identical to the sequential one — so we keep it sequential and
    //    the executor description states the sequential behavior plainly rather
    //    than promising parallelism.
    const wave = ready.slice(0, Math.max(1, workflow.concurrency));
    const scope = buildScope(ctx, new Date(ctx.now()).toISOString());

    for (const step of wave) {
      // A hard failure (onError≠'continue') earlier in THIS wave aborts the
      // run: stop scheduling the rest of the wave rather than burning
      // subagent/tool calls and emitting completed events for steps that ran
      // after the run had logically failed.
      if (aborted) break;
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
          // Persist vars set by logic steps that ran before this pause so a
          // resume restores them (otherwise downstream `{{ vars.x }}` is lost).
          vars: ctx.vars,
          pendingStepId: step.id,
          interactionAgentId: outcome.interactionAgentId!,
          startedAt: ctx.now(),
        });
        await deps.emit?.('workflow_paused', {
          runId,
          stepId: step.id,
          childSessionId: outcome.interactionAgentId,
          // Carry the human-facing question so the operator UI is self-contained
          // (no separate event correlation needed): the workflow name, the step
          // label, and the prompt/question the paused step asked.
          workflow: workflow.name,
          label: step.label ?? step.id,
          prompt: outcome.output.slice(0, 2000),
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
    // A run whose only remaining steps were all skipped by branch routing can
    // reach here with NO sink output (every sink step skipped → fallback ''),
    // which a delivery consumer would silently treat as "nothing to send".
    // Flag the empty terminal output so the delivery layer can warn rather than
    // deliver an empty body and call it a success.
    await deps.emit?.('workflow_completed', {
      name: workflow.name,
      output: output.slice(0, 280),
      ...(output.length === 0 ? { empty: true } : {}),
    });
    return buildRunResult(ctx, 'completed', true, { output });
  }

  await deps.emit?.('workflow_failed', { name: workflow.name, error: abortReason });
  return buildRunResult(ctx, 'failed', false, {
    output,
    error: abortReason ?? 'workflow failed',
  });
}

export async function runExecutor(
  workflow: Workflow,
  deps: WorkflowRunDeps,
): Promise<WorkflowRunResult> {
  const ctx: ExecutorContext = {
    workflow,
    deps: deps as WorkflowRunDepsWithStore,
    inputs: resolveInputs(workflow, deps),
    vars: {},
    states: new Map(),
    now: nowFn(deps),
    loopBodyIds: collectLoopBodyIds(workflow),
    runNested: runExecutor,
  };
  for (const step of workflow.steps) {
    ctx.states.set(step.id, { status: 'pending', output: '', startedAt: 0, endedAt: 0 });
  }
  return runExecutorLoop(ctx);
}

/**
 * Run ids currently being resumed. A second concurrent resume of the SAME run
 * (operator double-tap, a retry of a slow request, or two clients over the WS
 * bridge) must not both `spawner.continue` the same retained child session and
 * both `store.remove` the checkpoint — that double-spends the subagent and can
 * double-deliver downstream. The first claim wins; the rest are rejected until
 * it settles (the `finally` clears the claim).
 */
const inFlightResumes = new Set<string>();

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
  if (inFlightResumes.has(runId)) {
    return {
      ok: false,
      status: 'failed',
      steps: [],
      output: '',
      error: `workflow run "${runId}" is already being resumed`,
    };
  }
  inFlightResumes.add(runId);
  try {
    return await resumeWorkflowRunInner(runId, userMessage, deps, store);
  } finally {
    inFlightResumes.delete(runId);
  }
}

async function resumeWorkflowRunInner(
  runId: string,
  userMessage: string,
  deps: WorkflowRunDeps,
  store: WorkflowRunStore,
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

  // Restore vars captured at pause time (logic steps that ran before the
  // awaitInput step). Older checkpoints predate `vars` — default to {}.
  const restoredVars: Record<string, unknown> = {};
  const ctx: ExecutorContext = {
    workflow: checkpoint.workflow,
    deps: depsWithStore,
    inputs: checkpoint.inputs,
    vars: restoredVars,
    states: restoreStates(checkpoint.states),
    now: nowFn(deps),
    loopBodyIds: collectLoopBodyIds(checkpoint.workflow),
    runNested: runExecutor,
  };
  mergeVars(ctx, checkpoint.vars);

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
  return runExecutorLoop(ctx, true);
}
