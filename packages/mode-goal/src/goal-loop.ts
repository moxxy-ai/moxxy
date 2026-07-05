import {
  runReactLoop,
  type ModeContext,
  type MoxxyEvent,
  type PermissionResolver,
  type ProviderSuccessInfo,
  type TurnCheckpoint,
} from '@moxxy/sdk';

import { detectGoalTerminal } from './completion.js';
import {
  CONTINUE_NUDGE,
  GOAL_ABANDON_TOOL,
  GOAL_COMPLETE_TOOL,
  GOAL_MAX_ITERATIONS,
  GOAL_MAX_NOOP_ITERATIONS,
  GOAL_MODE_NAME,
  GOAL_PLUGIN_ID,
  GOAL_SYSTEM_PROMPT,
  GOAL_TOKEN_BUDGET,
  STALL_NUDGE,
} from './constants.js';

// The retry back-off (and its test seam) lives in the SDK's shared ReAct
// core now — re-export so existing importers/tests keep working.
export { __setRetrySleepForTests } from '@moxxy/sdk';

/**
 * Goal mode driver.
 *
 * Unlike the default mode (which returns the instant the model stops emitting
 * tools), goal mode treats "stopped emitting tools" as a cue to re-prompt: it
 * keeps the model working autonomously across iterations until the model
 * explicitly calls `goal_complete` (success) or `goal_abandon` (blocked).
 *
 * The loop plumbing — bounded retry back-off, reactive compaction, stuck-loop
 * detection, abort handling — is the SDK's shared {@link runReactLoop}; goal
 * mode contributes only its POLICY:
 *
 *   - an idle checkpoint (`gateOn: 'idle'`): nudge the model with a volatile
 *     trailing prompt when it goes quiet, stop after
 *     {@link GOAL_MAX_NOOP_ITERATIONS} consecutive idle rounds
 *   - a cumulative token budget (`onProviderSuccess`)
 *   - terminal-tool detection after each batch (`onToolBatchEnd`)
 *   - goal-flavored wording for stuck/cap/error events
 *
 * Tool calls are auto-approved for the whole run (the user opted into full
 * autonomy) by swapping in a resolver that replaces only the PROMPT path:
 * the session resolver's prompt-free `policyCheck` (user deny/allow rules
 * from ~/.moxxy/permissions.json plus tool-declared rules) is consulted
 * first, so a configured deny rule still denies here. Every call also still
 * flows through `dispatchToolCall`, so tool-call HOOKS (e.g. a security
 * plugin) still run and can deny. Auto-approve skips the prompt, not the
 * policy.
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

  // Auto-approve for the duration of the run — the user chose to let goal
  // mode run unattended, so nothing may ever block on an interactive prompt.
  // But ONLY the prompt is skipped: the session resolver's prompt-free
  // `policyCheck` is consulted first, so a user deny rule still denies in
  // goal mode. Anything the policy doesn't decide is allowed. Scoped to
  // goalCtx so it never leaks past this loop.
  const sessionResolver = ctx.permissions;
  const autoApprove: PermissionResolver = {
    name: 'goal-auto-approve',
    check: async (call, permCtx) => {
      const policy = (await sessionResolver.policyCheck?.(call, permCtx)) ?? null;
      if (policy) return policy;
      return { mode: 'allow', reason: 'goal mode runs tools unattended (auto-approve)' };
    },
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

  // Cumulative token budget across the whole run (alongside the iteration
  // cap). Tally the FULL prompt of each call: Anthropic reports the cached
  // portion separately (`inputTokens` is only the non-cached prefix), so on a
  // long goal run — where the rolling cache breakpoint serves most of the
  // prompt as cacheRead — counting input+output alone undercounts by a large
  // factor and this backstop could be exceeded many times over before it
  // trips.
  let totalTokens = 0;

  // The model idled without calling goal_complete: nudge it back to work with
  // a volatile trailing prompt (this call only — never appended to the log),
  // and stop for good after GOAL_MAX_NOOP_ITERATIONS consecutive idle rounds.
  const idleNudge: TurnCheckpoint = {
    name: 'goal-idle',
    gateOn: 'idle',
    run: async (check) => {
      if (check.consecutiveIdle >= GOAL_MAX_NOOP_ITERATIONS) {
        await goalCtx.emit({
          type: 'plugin_event',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'plugin',
          pluginId: GOAL_PLUGIN_ID,
          subtype: 'goal_stalled',
          payload: { idleIterations: check.consecutiveIdle, iteration: check.iteration },
        });
        await goalCtx.emit({
          type: 'assistant_message',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          content:
            'Goal mode stopped: the model went idle without calling `goal_complete`. ' +
            'It may believe the goal is done — review the work above, and send another message to continue if not.',
          stopReason: 'end_turn',
        });
        return { action: 'stop' };
      }
      return {
        action: 'inject',
        volatile: true,
        text: check.consecutiveIdle >= GOAL_MAX_NOOP_ITERATIONS - 1 ? STALL_NUDGE : CONTINUE_NUDGE,
      };
    },
  };

  yield* runReactLoop(goalCtx, {
    strategyName: GOAL_MODE_NAME,
    defaultMaxIterations: GOAL_MAX_ITERATIONS,
    errorPrefix: 'goal: ',
    checkpoints: [idleNudge],
    // The idle checkpoint stops itself at GOAL_MAX_NOOP_ITERATIONS, before
    // this backstop can trip — it exists so a future checkpoint bug degrades
    // loudly instead of looping.
    maxInjections: GOAL_MAX_NOOP_ITERATIONS,
    stuck: {
      abortedResultMessage: 'goal mode aborted (stuck pattern) before this call ran',
      nearHint: 'against the same target (only volatile args varied)',
      extraOnStuck: ({ toolName, count, kind }) => [
        {
          type: 'plugin_event',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'plugin',
          pluginId: GOAL_PLUGIN_ID,
          subtype: 'goal_stuck',
          payload: { tool: toolName, count, kind },
        },
      ],
      fatalMessage: ({ toolName, count, how }) =>
        `goal mode aborted — stuck pattern: tool "${toolName}" called ${count} times ${how}. ` +
        `The model is looping on the same call; send another message to redirect it.`,
    },
    onProviderSuccess: async (loopCtx, info) => {
      totalTokens += usageTotal(info);
      if (totalTokens <= GOAL_TOKEN_BUDGET) return undefined;
      // Persist the budget-exhausting call's assistant text before exiting,
      // just like every productive iteration does. Otherwise the model's last
      // words vanish from the log, so a resume ("continue from here") loses
      // that context. We do NOT execute its tool calls — the run is stopping.
      if (info.text || info.stopReason === 'end_turn' || info.toolUses.length === 0) {
        await loopCtx.emit({
          type: 'assistant_message',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'model',
          content: info.text,
          stopReason: info.stopReason,
        });
      }
      await loopCtx.emit({
        type: 'plugin_event',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'plugin',
        pluginId: GOAL_PLUGIN_ID,
        subtype: 'goal_budget_exhausted',
        payload: { totalTokens, budget: GOAL_TOKEN_BUDGET, iteration: info.iteration },
      });
      await loopCtx.emit({
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
      return { action: 'stop' };
    },
    onToolBatchEnd: async (loopCtx, { toolUses, iteration }) => {
      // Did this batch end the run? (goal_complete / goal_abandon, confirmed
      // via a successful tool_result in the log.) Only materialise the log
      // (an O(n) copy of the ever-growing append-only log) when the batch
      // actually used a goal tool — otherwise this ran on every productive
      // iteration, O(n²) per run.
      const hasGoalTool = toolUses.some(
        (t) => t.name === GOAL_COMPLETE_TOOL || t.name === GOAL_ABANDON_TOOL,
      );
      const terminal = hasGoalTool ? detectGoalTerminal(loopCtx.log.slice(), toolUses) : null;
      if (terminal?.kind === 'complete') {
        await loopCtx.emit({
          type: 'plugin_event',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'plugin',
          pluginId: GOAL_PLUGIN_ID,
          subtype: 'goal_completed',
          payload: {
            summary: terminal.summary,
            evidenceCount: terminal.evidence.length,
            iterations: iteration,
          },
        });
        const evidenceBlock =
          terminal.evidence.length > 0
            ? `\n\n${terminal.evidence.map((e) => `- ${e}`).join('\n')}`
            : '';
        await loopCtx.emit({
          type: 'assistant_message',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          content: `✓ Goal complete — ${terminal.summary}${evidenceBlock}`,
          stopReason: 'end_turn',
        });
        return { action: 'stop' };
      }
      if (terminal?.kind === 'abandon') {
        await loopCtx.emit({
          type: 'plugin_event',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'plugin',
          pluginId: GOAL_PLUGIN_ID,
          subtype: 'goal_abandoned',
          payload: {
            reason: terminal.reason,
            ...(terminal.needsFromUser ? { needsFromUser: terminal.needsFromUser } : {}),
            iterations: iteration,
          },
        });
        const needs = terminal.needsFromUser ? `\n\nNeeds from you: ${terminal.needsFromUser}` : '';
        await loopCtx.emit({
          type: 'assistant_message',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          content: `Goal abandoned — ${terminal.reason}${needs}`,
          stopReason: 'end_turn',
        });
        return { action: 'stop' };
      }
      return undefined;
    },
    onMaxIterations: async (loopCtx, maxIterations) => {
      await loopCtx.emit({
        type: 'plugin_event',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'plugin',
        pluginId: GOAL_PLUGIN_ID,
        subtype: 'goal_max_iterations',
        payload: { maxIterations },
      });
      await loopCtx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: 'fatal',
        message:
          `goal mode reached the iteration cap (${maxIterations}) without calling goal_complete. ` +
          `Stopping to avoid an unbounded run; send another message to continue.`,
      });
    },
  });
}

function usageTotal(info: ProviderSuccessInfo): number {
  const usage = info.usage;
  if (!usage) return 0;
  return (
    (usage.inputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.outputTokens ?? 0)
  );
}

function composeSystemPrompts(user: string | undefined, layer: string): string {
  if (!user || user.trim() === '') return layer;
  return `${layer}\n\n---\n\n${user}`;
}
