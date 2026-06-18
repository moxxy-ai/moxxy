import {
  type SubagentSpec,
  type WorkflowRunDeps,
  type WorkflowStep,
} from '@moxxy/sdk';
import { defaultWorkflowRunStore } from '../run-store.js';
import {
  logicSystemPrompt,
  parseLogicResponse,
  resolveBranchForCondition,
  resolveBranchForSwitch,
  wantsPlainResponse,
} from '../logic-response.js';
import { renderArgs, renderTemplate, type TemplateScope } from '../template.js';
import {
  buildScope,
  mergeVars,
  MAX_NESTING_DEPTH,
  type ExecutorContext,
  type LoggerOpts,
  type StepOutcome,
} from './context.js';

export async function runStep(
  step: WorkflowStep,
  scope: TemplateScope,
  ctx: ExecutorContext,
): Promise<StepOutcome> {
  // Retries are gated on the three-valued `onError` contract:
  //   - 'retry'           → run 1 + step.retries attempts (the count is honored).
  //   - 'fail' / 'continue' → run EXACTLY ONE attempt, regardless of `retries`.
  // This makes the `'retry'` enum value behaviorally distinct from `'fail'`
  // (previously retries fired whenever `retries > 0` independent of onError, so
  // `onError: 'fail' + retries: 3` silently retried — a latent semantic trap).
  // `retries` only takes effect in retry mode now.
  const attempts = step.onError === 'retry' ? 1 + Math.max(0, step.retries) : 1;
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
  const result = await ctx.runNested(nested, {
    ...deps,
    inputs: nestedInputs,
    depth,
    trigger: `workflow:${step.workflow}`,
  });
  if (result.status === 'paused') {
    // A nested workflow that pauses on `awaitInput` cannot be resumed through
    // the parent: the inner run already wrote its OWN checkpoint, but the parent
    // only checkpoints the `workflow`-typed step. On resume the parent would
    // `spawner.continue` the inner child once and mark the whole nested step
    // done WITHOUT re-entering the nested DAG — stranding the inner checkpoint
    // and skipping the nested workflow's remaining steps. Reject it loudly here
    // (mirrors the loop-body awaitInput guard) rather than half-resume. Drop the
    // inner checkpoint we'd otherwise orphan first.
    if (result.runId) {
      const store = deps.runStore ?? defaultWorkflowRunStore;
      await store.remove(result.runId).catch(() => {});
    }
    throw new Error(
      `nested workflow "${step.workflow}" paused for input (awaitInput); ` +
        'awaitInput is not supported inside a nested workflow — run it as a top-level workflow instead',
    );
  }
  if (!result.ok) throw new Error(result.error ?? `nested workflow "${step.workflow}" failed`);
  return { ok: true, output: result.output };
}

function buildUpstreamBlock(step: WorkflowStep, scope: TemplateScope): string {
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
 * Bounded while-loop node. `loop.condition` is the loop's EXIT/GOAL
 * condition — the body repeats UNTIL it is met. Each iteration:
 *   1. resets every body step's runtime state (so it re-runs cleanly);
 *   2. runs the body steps in declared order, merging any logic-step `vars`
 *      and honoring `onError` (a body step that fails with onError≠'continue'
 *      BREAKS the loop and proceeds to the next step — the loop returns ok with
 *      a "broke on error" note rather than failing the whole workflow; with
 *      `onError: continue` the body error is swallowed and iteration continues);
 *   3. evaluates `loop.condition` via the SAME LLM predicate as a `condition`
 *      step — `then` = condition met → STOP (continue to the next step),
 *      `else` = not yet met → run another iteration.
 *
 * It always terminates: either the exit condition is met, a body step breaks
 * the loop, or `maxIterations` is reached (in which case the loop completes
 * cleanly with a "max iterations reached" note rather than hanging). Composes with
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
          // Loop exit-on-error: a body error BREAKS the loop and proceeds to
          // the next step (the loop node's exit edge fires on condition-met OR
          // body error), rather than failing the whole workflow. Use
          // `onError: continue` on a body step to swallow its error and keep
          // iterating instead.
          ctx.deps.logger?.warn?.('workflow loop broke on body error', {
            step: step.id,
            body: body.id,
            error: outcome.error,
          });
          return {
            ok: true,
            output:
              `loop "${step.id}" broke on error in body step "${body.id}" ` +
              `after ${iteration + 1} iteration(s): ${outcome.error}` +
              (lastBodyOutput ? `\n\n${lastBodyOutput}` : ''),
          };
        }
      }
    }

    // Evaluate the loop's EXIT condition via the shared logic mechanism.
    // `then` = condition met → stop; `else` = not yet → run another iteration.
    const decision = await evaluateLoopCondition(step, loop.condition, ctx, opts);
    if (!decision.ok) {
      return { ok: false, output: lastBodyOutput, error: decision.error };
    }
    if (decision.route === 'then') {
      // Exit condition met — loop completes normally and execution continues
      // to the loop node's downstream (next) steps.
      return {
        ok: true,
        output: `loop "${step.id}" stopped after ${iteration + 1} iteration(s).\n\n${lastBodyOutput}`.trim(),
      };
    }
    // route === 'else' → condition not met yet → run another iteration (cap).
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
    '\n\nThis is the loop\'s EXIT condition. Evaluate whether it is now met. ' +
    'Reply with {"branch":"then"} if the condition IS met (stop the loop and ' +
    'continue to the next step), or {"branch":"else"} if it is NOT yet met ' +
    '(run another iteration).';

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

export function buildSubagentSpecWithDeps(
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
    if (allowed && allowed.length > 0)
      (spec as { allowedTools?: ReadonlyArray<string> }).allowedTools = allowed;
    return spec;
  }

  // prompt step
  return { prompt: renderTemplate(step.prompt ?? '', scope, opts), label };
}
