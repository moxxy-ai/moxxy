import { toolUseMode } from '@moxxy/mode-tool-use';
import type { ModeContext, MoxxyEvent } from '@moxxy/sdk';

import { runCompletionCheck } from './completion-check.js';
import {
  GOAL_MAX_ROUNDS,
  GOAL_PLUGIN_ID,
  GOAL_SYSTEM_PROMPT,
  GOAL_WORK_MAX_ITERATIONS,
} from './constants.js';
import { parseCompletion } from './parse-completion.js';

/**
 * Goal mode driver. Each ROUND is: a tool-use work phase under a goal-flavored
 * system prompt, then a completion check that decides GOAL_MET / GOAL_NOT_MET.
 * On GOAL_NOT_MET it injects a continuation nudge and loops; on GOAL_MET it
 * reports and stops. It also stops on user interrupt, when the model is blocked
 * awaiting the user, or at the GOAL_MAX_ROUNDS safety cap.
 *
 * Structurally a sibling of mode-developer's runDeveloperMode: same trick of
 * wrapping ctx and delegating the inner loop to toolUseMode rather than forking
 * its iteration logic.
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

  const goal = extractObjective(ctx);

  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: GOAL_PLUGIN_ID,
    subtype: 'goal_started',
    payload: { goal, maxRounds: GOAL_MAX_ROUNDS },
  });

  for (let round = 1; round <= GOAL_MAX_ROUNDS; round++) {
    if (ctx.signal.aborted) return;

    yield await ctx.emit({
      type: 'plugin_event',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'plugin',
      pluginId: GOAL_PLUGIN_ID,
      subtype: 'goal_round_started',
      payload: { round },
    });

    // --- Work phase: delegate to the standard tool-use loop with the goal
    // system prompt layered on. No fork of the iteration logic.
    const workCtx: ModeContext = {
      ...ctx,
      systemPrompt: composeSystemPrompts(ctx.systemPrompt, GOAL_SYSTEM_PROMPT),
      maxIterations: ctx.maxIterations ?? GOAL_WORK_MAX_ITERATIONS,
    };
    for await (const ev of toolUseMode.run(workCtx)) yield ev;

    if (ctx.signal.aborted) return;

    // --- Pause when genuinely blocked on the user. If the work round ended by
    // asking a question / requesting an action only the user can do, looping
    // (or re-checking) would just spin or fabricate progress. Yield back.
    if (lastTurnAwaitsUser(ctx)) {
      yield await ctx.emit({
        type: 'plugin_event',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'plugin',
        pluginId: GOAL_PLUGIN_ID,
        subtype: 'goal_awaiting_user',
        payload: { round, reason: 'work round ended awaiting user input' },
      });
      return;
    }

    // --- Completion check: stop or loop?
    const verdictText = yield* runCompletionCheck(ctx, goal);
    if (verdictText === null || ctx.signal.aborted) return;
    const verdict = parseCompletion(verdictText);

    yield await ctx.emit({
      type: 'plugin_event',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'plugin',
      pluginId: GOAL_PLUGIN_ID,
      subtype: 'goal_check_completed',
      payload: { round, met: verdict.met, ...(verdict.remaining ? { remaining: verdict.remaining } : {}) },
    });

    if (verdict.met) {
      yield await ctx.emit({
        type: 'plugin_event',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'plugin',
        pluginId: GOAL_PLUGIN_ID,
        subtype: 'goal_achieved',
        payload: { round, ...(verdict.summary ? { summary: verdict.summary } : {}) },
      });
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        content: `✓ Objective delivered${verdict.summary ? ` — ${verdict.summary}` : '.'}`,
        stopReason: 'end_turn',
      });
      return;
    }

    // Not met — inject a continuation nudge into the log so the next work
    // round picks up where this left off (same log.append injection the vault
    // command uses), then loop.
    const remainingNote = verdict.remaining
      ? `The objective is not yet fully delivered. Still remaining:\n${verdict.remaining}\n\nKeep working on these, then stop and I'll re-check.`
      : `The objective is not yet fully delivered. Keep working toward it, then stop and I'll re-check.`;
    yield await ctx.emit({
      type: 'user_prompt',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      text: remainingNote,
    });
  }

  // Hit the round cap without a GOAL_MET verdict.
  yield await ctx.emit({
    type: 'error',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    kind: 'fatal',
    message:
      `goal mode hit the safety cap (${GOAL_MAX_ROUNDS} rounds) without verifying the objective ` +
      `as delivered. Stopping to avoid a runaway. Review the progress and re-run /goal to continue.`,
  });
}

function composeSystemPrompts(user: string | undefined, layer: string): string {
  if (!user || user.trim() === '') return layer;
  return `${layer}\n\n---\n\n${user}`;
}

/** The objective = the most recent user-authored prompt at turn start.
 *  Filtering on source 'user' keeps it stable across rounds (the per-round
 *  continuation nudges are appended with source 'system'). */
function extractObjective(ctx: ModeContext): string {
  const events = ctx.log.slice();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.type === 'user_prompt' && e.source === 'user') return e.text;
  }
  return '';
}

/** Did the last work round end with the model asking the user a question or
 *  requesting an action? Inspects the most recent assistant message. Mirrors
 *  mode-developer's lastTurnAwaitsUser/messageAwaitsUser (kept local to avoid a
 *  cross-mode dependency). */
function lastTurnAwaitsUser(ctx: ModeContext): boolean {
  const events = ctx.log.slice();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.type === 'assistant_message') return messageAwaitsUser(e.content);
  }
  return false;
}

const AWAIT_USER_PATTERNS: ReadonlyArray<RegExp> = [
  /\/vault\s+set/i,
  /\bplease\s+(run|provide|share|paste|set|enter|add|confirm)\b/i,
  /\b(can|could|would)\s+you\s+(run|provide|share|paste|confirm|set)\b/i,
  /\bi\s+(need|'ll need|will need)\s+(you|your)\b/i,
  /\blet me know\b/i,
  /\bonce you('ve| have| 're)\b/i,
  /\bwaiting for (you|your)\b/i,
];

/** Heuristic for "this message is awaiting user input": a trailing question
 *  mark, or an explicit request for the user to do/provide something. */
export function messageAwaitsUser(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  const lastChar = t.replace(/[`*_)\]\s]+$/, '').slice(-1);
  if (lastChar === '?') return true;
  return AWAIT_USER_PATTERNS.some((re) => re.test(t));
}
