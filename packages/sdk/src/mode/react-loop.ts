import { isContextOverflowError, runCompactionIfNeeded } from '../compactor-helpers.js';
import { runElisionIfNeeded } from '../elision-helpers.js';
import type { MoxxyEvent } from '../events.js';
import type { ModeContext } from '../mode.js';
import { usageEventFields } from '../token-accounting.js';
import {
  emitRequestsAndDetectStuck,
  emitRequestsAndNudgeOnStuck,
  executeToolUses,
  type StuckLoopReport,
  type StuckTripInfo,
} from '../tool-dispatch.js';
import { nextBackoffMs, sleepWithAbort } from './abort-backoff.js';
import { emitAbort, emitError, runCheckpointGate } from './checkpoint-gate.js';
import { runAgentStepLoop } from './agent-step-loop.js';
import { collectProviderStream } from './collect-stream.js';
import { buildSystemPromptWithSkills, projectMessages, skillsWithinReach } from './project-messages.js';
import { createStuckLoopDetector } from './stuck-loop.js';

/**
 * The shared ReAct loop core every tool-calling mode runs on. One hardened
 * copy of the plumbing that used to be duplicated per mode (default / goal /
 * collab-agent): provider retry with bounded exponential back-off, reactive
 * compaction on context overflow, turn-boundary elision, stuck-loop
 * detection, abort handling on every await — plus the turn-end checkpoint
 * gate ({@link TurnCheckpoint}) that lets a mode verify a completion claim
 * (run lints, spawn a reviewer agent) before the turn is allowed to end.
 *
 * Modes express their POLICY through {@link ReactLoopOptions}: hooks fire at
 * fixed points (iteration start, provider success, tool batch end, iteration
 * cap) and checkpoints fire at the turn-end candidate. Hooks emit their own
 * events via `ctx.emit` — the live event channel is the log subscription
 * (`runTurn` discards the yielded stream), so emit order is what channels
 * and tests observe.
 */

/** Bounded back-off for retryable provider errors — see the field docs. */
export const MAX_CONSECUTIVE_RETRIES = 6;
const RETRY_BACKOFF_BASE_MS = 500;
const RETRY_BACKOFF_CAP_MS = 30_000;
const DEFAULT_MAX_ITERATIONS = 500;
const MAX_REACTIVE_COMPACTIONS = 2;
const DEFAULT_MAX_INJECTIONS = 3;
const DEFAULT_MAX_INJECT_CHARS = 16_384;

// Abort-aware sleep, injectable for tests so back-off paths run instantly and
// deterministically. Production delegates to sleepWithAbort: a real timer that
// clears (and drops its abort listener) when the signal fires, so a pending
// back-off never outlives a cancelled turn.
let sleepImpl = (ms: number, signal: AbortSignal): Promise<void> => sleepWithAbort(ms, signal);

/**
 * Override the retry back-off sleep (test seam). Returns a restore fn that
 * callers MUST invoke (in a `finally`) — `sleepImpl` is a module-scoped
 * singleton shared process-wide, so a leaked override bleeds the fake sleep
 * into every other turn/test running in the same worker (parallel subagent
 * fan-out, multiple Sessions in one host). Test-only; never call from prod.
 */
export function __setRetrySleepForTests(
  fn: (ms: number, signal: AbortSignal) => Promise<void>,
): () => void {
  const prev = sleepImpl;
  sleepImpl = fn;
  return () => {
    sleepImpl = prev;
  };
}

export type { ProviderSuccessInfo, ReactLoopOptions, StopDirective, ToolBatchInfo } from './react-loop-options.js';
import type { ReactLoopOptions } from './react-loop-options.js';

export async function* runReactLoop(
  ctx: ModeContext,
  opts: ReactLoopOptions,
): AsyncIterable<MoxxyEvent> {
  // An agent connection: the vendor's agent does each round, not this loop.
  if (ctx.provider.agentStep) {
    yield* runAgentStepLoop(ctx, opts);
    return;
  }
  if (opts.preflightAbortReason && ctx.signal.aborted) {
    yield await emitAbort(ctx, opts.preflightAbortReason);
    return;
  }

  // Coerce a caller/config-supplied bound to a positive integer; a degenerate
  // value (0, negative, NaN, fractional) would otherwise make the loop never
  // run and emit a misleading "exceeded maxIterations" fatal. The config
  // schema validates this, but programmatic callers (subagents/workflows)
  // bypass that schema.
  const requestedMaxIterations = ctx.maxIterations;
  const maxIterations =
    typeof requestedMaxIterations === 'number' && Number.isFinite(requestedMaxIterations)
      ? Math.max(1, Math.floor(requestedMaxIterations))
      : (opts.defaultMaxIterations ?? DEFAULT_MAX_ITERATIONS);

  const detector = createStuckLoopDetector(ctx.loopGuard);
  const stuckReport = buildStuckReport(opts);
  const prefix = opts.errorPrefix ?? '';

  // Recursion backstop: a checkpoint that spawns a child running a
  // checkpoint-bearing mode would gate the child's turn-end, spawn a
  // grandchild, and so on forever. Checkpoint authors should spawn children
  // as `mode: 'default'`; this disarm means a mistake degrades to an ungated
  // child instead of unbounded recursion.
  const checkpoints = ctx.isSubagent ? [] : (opts.checkpoints ?? []);
  const injectionBudget = Math.max(0, Math.floor(opts.maxInjections ?? DEFAULT_MAX_INJECTIONS));
  const maxInjectChars = Math.max(1024, Math.floor(opts.maxInjectChars ?? DEFAULT_MAX_INJECT_CHARS));
  let injectionsUsed = 0;
  let consecutiveIdle = 0;
  // A volatile injection from the previous round's checkpoint (goal's nudge),
  // consumed by the next provider call only.
  let pendingVolatileText: string | undefined;

  // Reactive-compaction budget per overflow episode and consecutive
  // retryable-error count; both reset on any clean provider call so a long
  // turn can recover from multiple transient episodes.
  let reactiveCompactions = 0;
  let consecutiveRetries = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (ctx.signal.aborted) {
      yield await emitAbort(ctx, 'signal aborted');
      return;
    }

    yield await ctx.emit({
      type: 'mode_iteration',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      strategy: opts.strategyName,
      iteration,
    });

    // Auto-compact before composing the next provider request, then apply
    // turn-boundary elision (context-on-demand). Both mutate the log's
    // projection, not the loop's state.
    await runCompactionIfNeeded(ctx);
    await runElisionIfNeeded(ctx);

    const hookStart = opts.onIterationStart
      ? await opts.onIterationStart(ctx, iteration)
      : undefined;
    // At most ONE volatile trailing user message per call: a pending
    // checkpoint nudge and an iteration-start note merge into it.
    const volatileParts = [pendingVolatileText, hookStart?.volatileUserText].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    pendingVolatileText = undefined;
    const volatileText = volatileParts.length > 0 ? volatileParts.join('\n\n') : undefined;

    // onIterationStart may block for a long time (collab's cooperative-pause
    // poll idles here until the human resumes) — re-check the signal so an
    // abort during the hook ends the turn cleanly instead of burning a
    // provider call that is already cancelled.
    if (ctx.signal.aborted) {
      yield await emitAbort(ctx, 'signal aborted');
      return;
    }

    // A text-only provider cannot call `load_skill`. Advertising the lazy skill
    // index anyway makes agent-shaped transports (notably Claude Code CLI)
    // imitate the unavailable call as plain assistant text and then end the
    // turn. Keep the base prompt, but only advertise lazy skills when the
    // selected model can actually execute the loader. Unknown/dynamic model ids
    // retain the historical tool-capable behavior, matching collect-stream's
    // conservative capability fallback.
    const projectionStarted=performance.now();
    const descriptor = ctx.provider.models.find((candidate) => candidate.id === ctx.model);
    const availableSkills = descriptor?.supportsTools === false
      ? []
      : skillsWithinReach(ctx.skills.list(), ctx.tools.list().map((tool) => tool.name));
    const systemPrompt = buildSystemPromptWithSkills(ctx.systemPrompt, availableSkills);
    const { messages, stablePrefixIndex } = projectMessages(ctx, {
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(volatileText ? { trailingUserText: volatileText } : {}),
    });

    const projectionMs=performance.now()-projectionStarted;
    yield await ctx.emit({
      type: 'provider_request',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: ctx.provider.name,
      model: ctx.model,
    });

    const { text, toolUses, stopReason, error, usage, reasoning, timing } = await collectProviderStream(
      ctx,
      messages,
      {
        iteration,
        projectionMs,
        stablePrefixIndex,
        // Volatile text is injected for this call only, never appended to the
        // log — the cache strategy must keep its rolling tail breakpoint
        // BEFORE it, or every such call caches a prefix ending in a message
        // that won't exist at that position next call: a guaranteed-wasted
        // cache write.
        ...(volatileText ? { volatileTailCount: 1 } : {}),
      },
    );

    // A user cancellation WHILE the provider stream was being consumed
    // surfaces as a non-retryable provider `error` ("The operation was
    // aborted") rather than a clean abort — collectProviderStream catches the
    // fetch AbortError and classifies it as fatal. Treat it as the
    // cancellation it is so channels render a 'stopped' turn, not a failed one.
    if (ctx.signal.aborted) {
      yield await emitAbort(ctx, 'signal aborted during provider stream');
      return;
    }

    yield await ctx.emit({
      type: 'provider_response',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: ctx.provider.name,
      model: ctx.model,
      ...usageEventFields(usage),
      ...(timing ? {timing} : {}),
    });

    if (error) {
      const overflow = isContextOverflowError(error.message);
      // The request was too big for the model's window: our token estimate
      // lagged the provider's real tokenizer, so the proactive compactor
      // didn't fire. Force a compaction and retry rather than dying.
      if (overflow && reactiveCompactions < MAX_REACTIVE_COMPACTIONS) {
        const compacted = await runCompactionIfNeeded(ctx, { force: true });
        if (compacted) {
          // Only count an attempt that actually compacted against the budget —
          // a no-op (overflow lives in the un-compactable recent tail) must
          // not deny a later, genuinely compactable overflow its retry.
          reactiveCompactions += 1;
          yield await emitError(ctx, 'retryable', 'context window exceeded — compacted older turns, retrying');
          continue;
        }
      }
      // A context overflow that can't be compacted further is fatal regardless
      // of the provider's `retryable` flag: some providers mark "reduce the
      // length" errors retryable, but the prompt cannot shrink, so a retry
      // just re-sends the identical over-budget request and overflows again.
      if (!error.retryable || overflow) {
        yield await emitError(ctx, 'fatal', `${prefix}${error.message}`);
        return;
      }
      // Retryable: surface it, then back off before retrying. A persistent
      // retryable condition (sustained 429 / outage) must NOT busy-loop the
      // provider — give up with a fatal error after the bounded retry count.
      consecutiveRetries += 1;
      yield await emitError(ctx, 'retryable', `${prefix}${error.message}`);
      if (consecutiveRetries >= MAX_CONSECUTIVE_RETRIES) {
        yield await emitError(
          ctx,
          'fatal',
          `${prefix}provider kept returning a retryable error ${consecutiveRetries} times in a row ` +
            `(last: ${error.message}); giving up rather than hammering the provider.`,
        );
        return;
      }
      await sleepImpl(
        nextBackoffMs(consecutiveRetries, RETRY_BACKOFF_BASE_MS, RETRY_BACKOFF_CAP_MS),
        ctx.signal,
      );
      if (ctx.signal.aborted) {
        yield await emitAbort(ctx, 'signal aborted during retry back-off');
        return;
      }
      continue;
    }
    // Clean provider call — reset the overflow-recovery + retry budgets.
    reactiveCompactions = 0;
    consecutiveRetries = 0;

    // Finalize the reasoning summary for THIS call BEFORE any exit decision or
    // tool/assistant emits, so the log order is reasoning → tool_use → text
    // (projection attaches the signed thinking block as content[0] of the
    // same assistant turn) and every exit path logs it consistently.
    if (reasoning) {
      yield await ctx.emit({
        type: 'reasoning_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        content: reasoning.text,
        ...(reasoning.signature ? { signature: reasoning.signature } : {}),
        ...(reasoning.redacted ? { redacted: true } : {}),
        ...(reasoning.encrypted ? { encrypted: reasoning.encrypted } : {}),
        ...(reasoning.replayItems ? { replayItems: reasoning.replayItems } : {}),
      });
    }

    if (opts.onProviderSuccess) {
      const directive = await opts.onProviderSuccess(ctx, {
        text,
        stopReason,
        toolUses,
        ...(usage ? { usage } : {}),
        iteration,
      });
      if (directive?.action === 'stop') return;
    }

    if (opts.stuck?.action === 'nudge') {
      const trip = yield* emitRequestsAndNudgeOnStuck(ctx, toolUses, detector, {
        nearHint: stuckReport.nearHint,
        warnMessage: (info) =>
          `${opts.strategyName} loop noticed a repetitive pattern: tool "${info.toolName}" called ` +
          `${info.count} times ${info.how} — steering the model to change approach (the run continues).`,
        ...(stuckReport.extraOnStuck ? { extraOnStuck: stuckReport.extraOnStuck } : {}),
      });
      if (trip) {
        const nudge = opts.stuck.nudgeText?.(trip) ?? defaultStuckNudge(trip);
        // Ride the NEXT provider call; merge with anything already pending.
        pendingVolatileText = pendingVolatileText ? `${pendingVolatileText}\n\n${nudge}` : nudge;
      }
    } else {
      const stuck = yield* emitRequestsAndDetectStuck(ctx, toolUses, detector, stuckReport);
      // A stuck trip kills the turn — it never reaches the checkpoint gate;
      // gating a turn that is being aborted would just burn a checker run.
      if (stuck) return;
    }

    if (text || stopReason === 'end_turn' || toolUses.length === 0) {
      // A completion with no text, no tool uses, and a non-natural stop (e.g.
      // 'max_tokens' truncated to nothing) yields a blank assistant bubble
      // that silently swallows the truncation signal. Surface a retryable
      // note so the user sees why, alongside the (preserved) empty
      // assistant_message.
      if (!text && toolUses.length === 0 && stopReason !== 'end_turn') {
        yield await emitError(
          ctx,
          'retryable',
          `provider returned an empty completion (stopReason: ${stopReason ?? 'unknown'})`,
        );
      }
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
      // ── The turn-end candidate: the model stopped calling tools. ──
      consecutiveIdle += 1;
      const verdict = yield* runCheckpointGate(ctx, checkpoints, {
        candidateText: text,
        stopReason,
        iteration,
        consecutiveIdle,
        injectionsUsed,
        injectionBudget,
        maxInjectChars,
      });
      if (verdict.kind === 'end') return;
      injectionsUsed += 1;
      if (verdict.volatileText !== undefined) pendingVolatileText = verdict.volatileText;
      continue;
    }
    consecutiveIdle = 0;
    // The injection budget is per idle-EPISODE, not per turn: it exists to
    // stop a permanently-failing gate from looping a turn that makes no
    // progress. Once the model does real tool work again the episode is over —
    // without this reset, a long unattended run died on its Nth *spread-out*
    // idle round ("checkpoint budget exhausted") even though every earlier
    // nudge had successfully put the model back to work.
    injectionsUsed = 0;

    // Execute whenever the model requested tools, regardless of stopReason.
    // Providers vary in how reliably they report `stopReason: 'tool_use'`;
    // trusting only stopReason silently dropped tool calls on providers that
    // mis-map it, leaving orphaned tool_call_requested events.
    const exited = yield* executeToolUses(ctx, toolUses, iteration);
    if (exited) return;

    if (opts.onToolBatchEnd) {
      const directive = await opts.onToolBatchEnd(ctx, { toolUses, iteration });
      if (directive?.action === 'stop') return;
    }
  }

  if (opts.onMaxIterations) {
    await opts.onMaxIterations(ctx, maxIterations);
    return;
  }
  yield await emitError(
    ctx,
    'fatal',
    `${opts.strategyName} mode loop exceeded maxIterations (${maxIterations})`,
  );
}

function defaultStuckNudge(trip: StuckTripInfo): string {
  return (
    `You have called the tool \`${trip.toolName}\` ${trip.count} times ${trip.how}. ` +
    `Repeating the same call will not produce a different result. Step back, reassess what ` +
    `you learned from the previous attempts, and take a DIFFERENT next action or approach.`
  );
}

function buildStuckReport(opts: ReactLoopOptions): StuckLoopReport {
  const name = opts.strategyName;
  return {
    abortedResultMessage:
      opts.stuck?.abortedResultMessage ??
      `${name} mode loop aborted (stuck pattern) before this call ran`,
    nearHint:
      opts.stuck?.nearHint ?? 'against the same target (only volatile args like maxBytes varied)',
    fatalMessage:
      opts.stuck?.fatalMessage ??
      (({ toolName, count, how }) =>
        `${name} mode loop aborted — detected stuck pattern: tool "${toolName}" called ` +
        `${count} times ${how}. The model is likely looping on the same call; ` +
        `reset or rephrase.`),
    ...(opts.stuck?.extraOnStuck ? { extraOnStuck: opts.stuck.extraOnStuck } : {}),
  };
}
