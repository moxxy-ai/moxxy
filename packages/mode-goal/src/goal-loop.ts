import {
  asToolCallId,
  buildSystemPromptWithSkills,
  collectProviderStream,
  createStuckLoopDetector,
  dispatchToolCall,
  isContextOverflowError,
  projectMessages,
  runCompactionIfNeeded,
  runElisionIfNeeded,
  usageEventFields,
  type CollectedToolUse,
  type ModeContext,
  type MoxxyEvent,
  type PermissionResolver,
  type StuckLoopDetector,
} from '@moxxy/sdk';

import { detectGoalTerminal } from './completion.js';
import {
  CONTINUE_NUDGE,
  GOAL_MAX_ITERATIONS,
  GOAL_MAX_NOOP_ITERATIONS,
  GOAL_MODE_NAME,
  GOAL_PLUGIN_ID,
  GOAL_SYSTEM_PROMPT,
  GOAL_TOKEN_BUDGET,
  STALL_NUDGE,
} from './constants.js';

/**
 * Goal mode driver.
 *
 * Unlike tool-use (which returns the instant the model stops emitting tools),
 * goal mode treats "stopped emitting tools" as a cue to re-prompt: it keeps
 * the model working autonomously across iterations until the model explicitly
 * calls `goal_complete` (success) or `goal_abandon` (blocked). Every iteration
 * is guarded so the loop always terminates:
 *
 *   - hard iteration cap (`maxIterations`)
 *   - cumulative token budget
 *   - stuck-loop detector (same identical-call detection as tool-use)
 *   - no-progress detection (repeated idle iterations → stall stop)
 *   - `ctx.signal.aborted` checked every iteration and mid tool batch
 *
 * Tool calls are auto-approved for the whole run (the user opted into full
 * autonomy) by swapping in a permissive resolver — but every call still flows
 * through `dispatchToolCall`, so tool-call HOOKS (e.g. a security plugin) still
 * run and can deny. Auto-approve skips the prompt, not the policy.
 */
export async function* runGoalMode(ctx: ModeContext): AsyncIterable<MoxxyEvent> {
  if (ctx.signal.aborted) {
    yield await ctx.emit({
      type: 'abort',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      reason: 'aborted before goal mode start',
    });
    return;
  }

  // Full auto-approve for the duration of the run — the user chose to let goal
  // mode run unattended. Scoped to goalCtx so it never leaks past this loop.
  const autoApprove: PermissionResolver = {
    name: 'goal-auto-approve',
    check: async () => ({ mode: 'allow', reason: 'goal mode runs tools unattended (auto-approve)' }),
  };
  const goalCtx: ModeContext = {
    ...ctx,
    systemPrompt: composeSystemPrompts(ctx.systemPrompt, GOAL_SYSTEM_PROMPT),
    permissions: autoApprove,
  };

  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: GOAL_PLUGIN_ID,
    subtype: 'goal_started',
    payload: { autoApprove: true, maxIterations: ctx.maxIterations ?? GOAL_MAX_ITERATIONS },
  });

  const detector = createStuckLoopDetector();
  const maxIterations = ctx.maxIterations ?? GOAL_MAX_ITERATIONS;
  let noop = 0; // consecutive idle (no-tool) iterations
  let totalTokens = 0;
  let reactiveCompactions = 0;
  const MAX_REACTIVE_COMPACTIONS = 2;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (ctx.signal.aborted) {
      yield await ctx.emit({
        type: 'abort',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        reason: 'signal aborted',
      });
      return;
    }

    yield await ctx.emit({
      type: 'mode_iteration',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      strategy: GOAL_MODE_NAME,
      iteration,
    });

    await runCompactionIfNeeded(goalCtx);
    await runElisionIfNeeded(goalCtx);

    // Nudge only when the model went idle last iteration (no tool calls and no
    // completion). After a productive iteration the tool results carry the
    // model forward on their own — no nudge needed.
    const nudge =
      noop === 0 ? undefined : noop >= GOAL_MAX_NOOP_ITERATIONS - 1 ? STALL_NUDGE : CONTINUE_NUDGE;

    const baseSystem = buildSystemPromptWithSkills(goalCtx.systemPrompt, goalCtx.skills.list()) ?? '';
    const { messages, stablePrefixIndex } = projectMessages(goalCtx, {
      ...(baseSystem ? { systemPrompt: baseSystem } : {}),
      ...(nudge ? { trailingUserText: nudge } : {}),
    });

    yield await ctx.emit({
      type: 'provider_request',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: goalCtx.provider.name,
      model: goalCtx.model,
    });

    const { text, toolUses, stopReason, error, usage } = await collectProviderStream(
      goalCtx,
      messages,
      { iteration, stablePrefixIndex },
    );

    yield await ctx.emit({
      type: 'provider_response',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: goalCtx.provider.name,
      model: goalCtx.model,
      ...usageEventFields(usage),
    });

    if (usage) totalTokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);

    if (error) {
      if (isContextOverflowError(error.message) && reactiveCompactions < MAX_REACTIVE_COMPACTIONS) {
        reactiveCompactions += 1;
        const compacted = await runCompactionIfNeeded(goalCtx, { force: true });
        if (compacted) {
          yield await ctx.emit({
            type: 'error',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            source: 'system',
            kind: 'retryable',
            message: 'context window exceeded — compacted older turns, retrying',
          });
          continue;
        }
      }
      yield await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: error.retryable ? 'retryable' : 'fatal',
        message: `goal: ${error.message}`,
      });
      if (!error.retryable) return;
      continue;
    }
    reactiveCompactions = 0;

    // Token budget backstop (alongside the iteration cap).
    if (totalTokens > GOAL_TOKEN_BUDGET) {
      yield await ctx.emit({
        type: 'plugin_event',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'plugin',
        pluginId: GOAL_PLUGIN_ID,
        subtype: 'goal_budget_exhausted',
        payload: { totalTokens, budget: GOAL_TOKEN_BUDGET, iteration },
      });
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        content:
          `Goal mode stopped: token budget exhausted (${totalTokens.toLocaleString()} > ` +
          `${GOAL_TOKEN_BUDGET.toLocaleString()}) before the goal was completed. ` +
          `Send another message to continue from here.`,
        stopReason: 'end_turn',
      });
      return;
    }

    const stuck = yield* emitRequestsAndDetectStuck(ctx, toolUses, detector);
    if (stuck) return;

    if (text || stopReason === 'end_turn' || toolUses.length === 0) {
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        content: text,
        stopReason,
      });
    }

    if (toolUses.length === 0) {
      // The model idled without calling goal_complete. Count it; nudge next
      // iteration. After enough idle rounds, stop rather than spin forever.
      noop += 1;
      if (noop >= GOAL_MAX_NOOP_ITERATIONS) {
        yield await ctx.emit({
          type: 'plugin_event',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'plugin',
          pluginId: GOAL_PLUGIN_ID,
          subtype: 'goal_stalled',
          payload: { idleIterations: noop, iteration },
        });
        yield await ctx.emit({
          type: 'assistant_message',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          content:
            'Goal mode stopped: the model went idle without calling `goal_complete`. ' +
            'It may believe the goal is done — review the work above, and send another message to continue if not.',
          stopReason: 'end_turn',
        });
        return;
      }
      continue;
    }
    noop = 0;

    const exited = yield* executeToolUses(goalCtx, toolUses, iteration);
    if (exited) return;

    // Did this batch end the run? (goal_complete / goal_abandon, confirmed via
    // a successful tool_result in the log.)
    const terminal = detectGoalTerminal(ctx.log.slice(), toolUses);
    if (terminal?.kind === 'complete') {
      yield await ctx.emit({
        type: 'plugin_event',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'plugin',
        pluginId: GOAL_PLUGIN_ID,
        subtype: 'goal_completed',
        payload: { summary: terminal.summary, evidenceCount: terminal.evidence.length, iterations: iteration },
      });
      const evidenceBlock =
        terminal.evidence.length > 0 ? `\n\n${terminal.evidence.map((e) => `- ${e}`).join('\n')}` : '';
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        content: `✓ Goal complete — ${terminal.summary}${evidenceBlock}`,
        stopReason: 'end_turn',
      });
      return;
    }
    if (terminal?.kind === 'abandon') {
      yield await ctx.emit({
        type: 'plugin_event',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'plugin',
        pluginId: GOAL_PLUGIN_ID,
        subtype: 'goal_abandoned',
        payload: { reason: terminal.reason, ...(terminal.needsFromUser ? { needsFromUser: terminal.needsFromUser } : {}), iterations: iteration },
      });
      const needs = terminal.needsFromUser ? `\n\nNeeds from you: ${terminal.needsFromUser}` : '';
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        content: `Goal abandoned — ${terminal.reason}${needs}`,
        stopReason: 'end_turn',
      });
      return;
    }
  }

  // Iteration cap hit without the model declaring done.
  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: GOAL_PLUGIN_ID,
    subtype: 'goal_max_iterations',
    payload: { maxIterations },
  });
  yield await ctx.emit({
    type: 'error',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    kind: 'fatal',
    message:
      `goal mode reached the iteration cap (${maxIterations}) without calling goal_complete. ` +
      `Stopping to avoid an unbounded run; send another message to continue.`,
  });
}

function composeSystemPrompts(user: string | undefined, layer: string): string {
  if (!user || user.trim() === '') return layer;
  return `${layer}\n\n---\n\n${user}`;
}

/** Emit tool_call_requested for each tool use and check the stuck-loop
 *  detector. Returns `true` when the detector tripped (caller should stop). */
async function* emitRequestsAndDetectStuck(
  ctx: ModeContext,
  toolUses: ReadonlyArray<CollectedToolUse>,
  detector: StuckLoopDetector,
): AsyncGenerator<MoxxyEvent, boolean, unknown> {
  for (const t of toolUses) {
    yield await ctx.emit({
      type: 'tool_call_requested',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'model',
      callId: asToolCallId(t.id),
      name: t.name,
      input: t.input,
    });
    const sig = detector.record(t.name, t.input);
    if (sig.stuck) {
      const how =
        sig.kind === 'near'
          ? 'against the same target (only volatile args varied)'
          : 'with identical input';
      yield await ctx.emit({
        type: 'plugin_event',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'plugin',
        pluginId: GOAL_PLUGIN_ID,
        subtype: 'goal_stuck',
        payload: { tool: t.name, count: sig.count, kind: sig.kind },
      });
      yield await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: 'fatal',
        message:
          `goal mode aborted — stuck pattern: tool "${t.name}" called ${sig.count} times ${how}. ` +
          `The model is looping on the same call; send another message to redirect it.`,
      });
      return true;
    }
  }
  return false;
}

/** Execute tool uses, handling mid-batch abort. Returns `true` when the
 *  caller should stop (abort observed). Mirrors mode-tool-use. */
async function* executeToolUses(
  ctx: ModeContext,
  toolUses: ReadonlyArray<CollectedToolUse>,
  iteration: number,
): AsyncGenerator<MoxxyEvent, boolean, unknown> {
  const unresolved = new Set<string>(toolUses.map((t) => t.id));
  for (const t of toolUses) {
    if (ctx.signal.aborted) {
      for (const orphanId of unresolved) {
        yield await ctx.emit({
          type: 'tool_result',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'tool',
          callId: asToolCallId(orphanId),
          ok: false,
          error: { kind: 'aborted', message: 'turn aborted before tool ran' },
        });
      }
      unresolved.clear();
      yield await ctx.emit({
        type: 'abort',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        reason: 'signal aborted during tool execution',
      });
      return true;
    }
    try {
      yield* dispatchToolCall(ctx, t, iteration);
    } finally {
      unresolved.delete(t.id);
    }
  }
  return false;
}
