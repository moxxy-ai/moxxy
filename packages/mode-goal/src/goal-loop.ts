import {
  runReactLoop,
  type ModeContext,
  type MoxxyEvent,
  type PermissionResolver,
  type TurnCheckpoint,
} from '@moxxy/sdk';

import { detectGoalTerminal } from './completion.js';
import {
  CONTINUE_NUDGE,
  GOAL_ABANDON_TOOL,
  GOAL_COMPLETE_TOOL,
  GOAL_MAX_NOOP_ITERATIONS,
  GOAL_MODE_NAME,
  GOAL_PLUGIN_ID,
  GOAL_SYSTEM_PROMPT,
  STALL_NUDGE,
  STUCK_NUDGE_SUFFIX,
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
 * Goal mode is deliberately GUARDRAIL-FREE: the user asked for an outcome and
 * opted into full autonomy, so nothing heuristic may kill the run mid-delivery.
 * There is no iteration cap (unless the embedder set an explicit
 * `ctx.maxIterations`), no token budget, and a stuck-loop trip steers the model
 * instead of aborting. The ONLY ways a run ends:
 *
 *   - the model calls `goal_complete` (verified success) or `goal_abandon`
 *     (blocked, needs the user),
 *   - the model goes idle {@link GOAL_MAX_NOOP_ITERATIONS} rounds in a row
 *     despite nudges — it has decided it's done without saying so, so the run
 *     ends cleanly as a soft completion,
 *   - the user aborts (Esc / stop), or
 *   - a genuinely fatal condition (un-compactable context overflow, provider
 *     giving up after bounded retries).
 *
 * Goal mode is also ONE-SHOT (`transient: true` on the ModeDef): it arms for a
 * single objective. When the run concludes as DONE — `goal_complete` or the
 * idle soft-completion — the session hands back to the mode that was active
 * before goal mode (via `ctx.requestModeSwitch`), so the user's next message is
 * normal chat again. While the goal is UNFINISHED — `goal_abandon` (the model
 * needs an answer to continue), a fatal error, or a user abort — the mode stays
 * armed so the user's reply resumes the autonomous run.
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

  // Hand the session back to whatever the user was in before arming goal mode
  // — applied by the runner AFTER the turn drains, and only on clean
  // completion. Called on the DONE terminals only (complete / idle
  // soft-completion): an unfinished goal (abandon / fatal / abort) keeps the
  // mode armed so the user's reply resumes the run.
  const disarm = (): void => {
    const previous = ctx.previousModeName;
    const target = previous && previous !== GOAL_MODE_NAME ? previous : 'default';
    ctx.requestModeSwitch?.(target);
  };

  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: GOAL_PLUGIN_ID,
    subtype: 'goal_started',
    payload: { autoApprove: true, maxIterations: ctx.maxIterations ?? null },
  });

  // The model idled without calling goal_complete: nudge it back to work with
  // a volatile trailing prompt (this call only — never appended to the log).
  // After GOAL_MAX_NOOP_ITERATIONS consecutive idle rounds the model has
  // clearly decided it's done without declaring it — end the run cleanly as a
  // soft completion (and disarm) rather than spin forever.
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
            'Goal run ended: the model stopped working without calling `goal_complete` — ' +
            'it likely considers the goal done. Review the work above; if something is ' +
            'missing, describe it in your next message.',
          stopReason: 'end_turn',
        });
        disarm();
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
    // No iteration cap: a goal run ends via its terminals, never because a
    // counter ran out mid-delivery. An explicit ctx.maxIterations (set by a
    // programmatic embedder) still takes precedence inside runReactLoop.
    defaultMaxIterations: Number.POSITIVE_INFINITY,
    errorPrefix: 'goal: ',
    checkpoints: [idleNudge],
    // The idle checkpoint stops itself at GOAL_MAX_NOOP_ITERATIONS consecutive
    // idles, before this backstop can trip — it exists so a future checkpoint
    // bug degrades loudly instead of looping. (The core resets the budget
    // whenever the model does tool work, so spread-out idle rounds across a
    // long run never exhaust it.)
    maxInjections: GOAL_MAX_NOOP_ITERATIONS,
    stuck: {
      // Never abort an unattended run on a repetition heuristic — the repeats
      // are often legitimate (re-running a failing build between edits).
      // Steer instead: visible warning + a volatile nudge on the next call.
      action: 'nudge',
      nearHint: 'against the same target (only volatile args varied)',
      nudgeText: ({ toolName, count, how }) =>
        `You have called the tool \`${toolName}\` ${count} times ${how}. Repeating the same ` +
        `call will not produce a different result. Step back, reassess, and take a DIFFERENT ` +
        `next action toward the goal. ${STUCK_NUDGE_SUFFIX}`,
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
        disarm();
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
          content:
            `Goal abandoned — ${terminal.reason}${needs}\n\n` +
            `Goal mode stays armed: your reply resumes the autonomous run.`,
          stopReason: 'end_turn',
        });
        // Deliberately NOT disarming: the model needs something from the user
        // and their reply should resume the autonomous run.
        return { action: 'stop' };
      }
      return undefined;
    },
    onMaxIterations: async (loopCtx, maxIterations) => {
      // Only reachable when an embedder set an explicit ctx.maxIterations —
      // goal mode itself is uncapped.
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
          `goal mode reached the configured iteration cap (${maxIterations}) without calling ` +
          `goal_complete. Send another message to continue.`,
      });
    },
  });
}

function composeSystemPrompts(user: string | undefined, layer: string): string {
  if (!user || user.trim() === '') return layer;
  return `${layer}\n\n---\n\n${user}`;
}
