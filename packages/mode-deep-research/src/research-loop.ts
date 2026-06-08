import type { ModeContext, MoxxyEvent } from '@moxxy/sdk';

import {
  runQueryApprovalGate,
  runSynthesisApprovalGate,
} from './approval.js';
import {
  RESEARCH_MODE_NAME,
  DEEP_RESEARCH_PLUGIN_ID,
  MAX_FOLLOWUPS_PER_ROUND,
  MAX_FOLLOWUP_ROUNDS,
  MAX_REDRAFTS,
  MAX_SUBAGENTS,
} from './constants.js';
import {
  buildFanoutDigest,
  buildSynthesisInput,
  flattenOutcome,
  runFanout,
  type RoundFinding,
} from './fanout-phase.js';
import { parseFollowups, parseQueries } from './parse-queries.js';
import { collectFollowupPlan, collectQueryPlan } from './query-phase.js';
import { collectSynthesis } from './synthesis-phase.js';

/**
 * Deep-research loop:
 *   1. Plan QUERIES: block (with redraft-able approval gate)
 *   2. Fan out (round 1) — one subagent per gathering query, in parallel
 *   3. Up to MAX_FOLLOWUP_ROUNDS of:
 *        a. Ask model "given findings so far, do you need follow-ups?"
 *        b. If yes, fan out follow-ups with the prior findings as
 *           context in each subagent's prompt.
 *        c. If no, break out.
 *   4. Synthesis approval gate (digest of all rounds)
 *   5. Synthesize the final cited writeup.
 *
 * Headless contexts auto-approve both gates. Missing ctx.subagents is
 * fatal — fan-out is the whole point of this mode.
 */
export async function* runDeepResearchMode(ctx: ModeContext): AsyncIterable<MoxxyEvent> {
  if (ctx.signal.aborted) {
    yield await ctx.emit({
      type: 'abort',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      reason: 'aborted before deep-research start',
    });
    return;
  }

  if (!ctx.subagents) {
    yield await ctx.emit({
      type: 'error',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      kind: 'fatal',
      message:
        'research: ctx.subagents is unavailable (the @moxxy/plugin-subagents plugin appears disabled). ' +
        'Re-enable it, or switch to the default mode for a serial alternative.',
    });
    return;
  }

  yield await ctx.emit({
    type: 'mode_iteration',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    strategy: RESEARCH_MODE_NAME,
    iteration: 0,
    routing: 'unresolved',
  });

  // Phase 1: query plan (with redraftable gate).
  const planning = yield* runPlanningPhase(ctx);
  if (planning === null) return;
  const { queries, originalPrompt } = planning;

  // Phase 2: round-1 fan out.
  const allFindings: RoundFinding[] = [];
  const round1 = yield* runRound(ctx, 1, queries, []);
  if (round1 === null) return;
  allFindings.push(...round1);

  // Phase 3: follow-up rounds, capped to MAX_FOLLOWUP_ROUNDS.
  for (let round = 2; round <= MAX_FOLLOWUP_ROUNDS + 1; round += 1) {
    if (ctx.signal.aborted) return;
    const followups = yield* runFollowupPlan(ctx, originalPrompt, allFindings, round);
    if (followups === null) return;
    if (followups.length === 0) {
      yield await ctx.emit({
        type: 'plugin_event',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'plugin',
        pluginId: DEEP_RESEARCH_PLUGIN_ID,
        subtype: 'deep_research_followups_none',
        payload: { round },
      });
      break;
    }
    const nextRound = yield* runRound(ctx, round, followups, allFindings);
    if (nextRound === null) return;
    allFindings.push(...nextRound);
  }

  if (ctx.signal.aborted) return;

  // Phase 4: synthesis approval gate.
  const digest = buildFanoutDigest(allFindings);
  const gate = await runSynthesisApprovalGate(ctx, digest);
  if (gate.kind === 'cancel') {
    yield await ctx.emit({
      type: 'abort',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'user',
      reason: 'synthesis cancelled by user',
    });
    return;
  }

  // Phase 5: synthesize.
  const synthesisInput = buildSynthesisInput(originalPrompt, allFindings);
  const synthesisText = await collectSynthesis(ctx, synthesisInput);
  if (synthesisText === null) return;

  yield await ctx.emit({
    type: 'assistant_message',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'model',
    content: synthesisText,
    stopReason: 'end_turn',
  });

  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: DEEP_RESEARCH_PLUGIN_ID,
    subtype: 'deep_research_synthesis_completed',
    payload: {
      totalFindings: allFindings.length,
      rounds: Math.max(...allFindings.map((f) => f.round), 1),
      errored: allFindings.filter((f) => f.error).length,
    },
  });
}

/**
 * One round of parallel fan-out — emits start/complete events around
 * runFanout. Returns the per-round findings, or null on abort.
 */
async function* runRound(
  ctx: ModeContext,
  round: number,
  queries: ReadonlyArray<string>,
  priorFindings: ReadonlyArray<RoundFinding>,
): AsyncGenerator<MoxxyEvent, RoundFinding[] | null, unknown> {
  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: DEEP_RESEARCH_PLUGIN_ID,
    subtype: 'deep_research_fanout_started',
    payload: { round, queries: queries.length },
  });

  const outcome = await runFanout(ctx, queries, priorFindings);

  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: DEEP_RESEARCH_PLUGIN_ID,
    subtype: 'deep_research_fanout_completed',
    payload: {
      round,
      total: queries.length,
      errored: outcome.errored.length,
    },
  });

  if (ctx.signal.aborted) return null;
  return flattenOutcome(round, queries, outcome);
}

/**
 * Ask the model whether to fan out more queries, given everything
 * gathered so far. Returns the parsed follow-up queries (may be empty)
 * or null on a fatal error.
 */
async function* runFollowupPlan(
  ctx: ModeContext,
  originalPrompt: string,
  priorFindings: ReadonlyArray<RoundFinding>,
  round: number,
): AsyncGenerator<MoxxyEvent, string[] | null, unknown> {
  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: DEEP_RESEARCH_PLUGIN_ID,
    subtype: 'deep_research_followups_planning',
    payload: { round, basedOn: priorFindings.length },
  });

  const text = await collectFollowupPlan(ctx, originalPrompt, priorFindings);
  if (text === null) return null;
  const followups = parseFollowups(text);

  // Apply cap and surface the trim as an event — but only when there's
  // something to draft. The empty case is signalled by the caller via
  // `deep_research_followups_none`; emitting a "drafted with kept=0"
  // event here would be a duplicate "nothing to do" signal.
  const trimmed = followups.slice(0, MAX_FOLLOWUPS_PER_ROUND);
  if (trimmed.length === 0) return [];

  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: DEEP_RESEARCH_PLUGIN_ID,
    subtype: 'deep_research_followups_drafted',
    payload: {
      round,
      proposed: followups.length,
      kept: trimmed.length,
      queries: trimmed,
    },
  });

  // Materialize the follow-up plan as an assistant_message so the user
  // sees the queries that are about to run, even without an approval
  // gate. (We deliberately skip a per-round approval gate to keep the
  // user-facing checkpoints lightweight — the synthesis gate at the
  // end is the final go/no-go.)
  yield await ctx.emit({
    type: 'assistant_message',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'model',
    content:
      `Follow-up round ${round} — spawning ${trimmed.length} more subagent${trimmed.length === 1 ? '' : 's'}:\n` +
      trimmed.map((q, i) => `${i + 1}. ${q}`).join('\n'),
    stopReason: 'end_turn',
  });

  return trimmed;
}

async function* runPlanningPhase(
  ctx: ModeContext,
): AsyncGenerator<
  MoxxyEvent,
  { queries: string[]; originalPrompt: string } | null,
  unknown
> {
  // Capture the original prompt from the log so we can re-include it in
  // synthesis context.
  const originalPrompt = (() => {
    for (const e of ctx.log.slice()) {
      if (e.type === 'user_prompt') return e.text;
    }
    return '';
  })();

  let redraftFeedback: string | null = null;
  let redraftCount = 0;

  while (true) {
    if (ctx.signal.aborted) {
      yield await ctx.emit({
        type: 'abort',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        reason: 'aborted during planning',
      });
      return null;
    }

    const planText = await collectQueryPlan(ctx, redraftFeedback);
    if (planText === null) return null;
    const queries = parseQueries(planText);

    yield await ctx.emit({
      type: 'plugin_event',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'plugin',
      pluginId: DEEP_RESEARCH_PLUGIN_ID,
      subtype: 'deep_research_queries_drafted',
      payload: { text: planText, queries, redraft: redraftCount },
    });

    if (queries.length === 0) {
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        content: planText,
        stopReason: 'end_turn',
      });
      return null;
    }

    if (queries.length > MAX_SUBAGENTS) {
      yield await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: 'fatal',
        message: `deep-research: refusing a ${queries.length}-query plan (cap is ${MAX_SUBAGENTS}). Narrow scope or rephrase.`,
      });
      return null;
    }

    const gate = await runQueryApprovalGate(ctx, planText, queries.length, redraftCount);
    redraftCount = gate.redraftCount;

    if (gate.outcome.kind === 'cancel') {
      yield await ctx.emit({
        type: 'abort',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'user',
        reason: 'query plan rejected by user',
      });
      return null;
    }
    if (gate.outcome.kind === 'redraft-cap-exceeded') {
      yield await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: 'fatal',
        message: `deep-research: redrafted ${MAX_REDRAFTS}× without approval; aborting.`,
      });
      return null;
    }
    if (gate.outcome.kind === 'redraft') {
      redraftFeedback = gate.outcome.feedback;
      continue;
    }

    yield await ctx.emit({
      type: 'assistant_message',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'model',
      content: planText,
      stopReason: 'end_turn',
    });
    return { queries, originalPrompt };
  }
}
