import { isContextOverflowError, runCompactionIfNeeded } from '../compactor-helpers.js';
import { runElisionIfNeeded } from '../elision-helpers.js';
import type { MoxxyEvent } from '../events.js';
import { asPluginId } from '../ids.js';
import type { ModeContext } from '../mode.js';
import type { TokenUsage } from '../provider.js';
import type { StopReason } from '../provider-utils.js';
import { usageEventFields } from '../token-accounting.js';
import {
  emitRequestsAndDetectStuck,
  emitRequestsAndNudgeOnStuck,
  executeToolUses,
  type StuckLoopReport,
  type StuckTripInfo,
} from '../tool-dispatch.js';
import { nextBackoffMs, sleepWithAbort } from './abort-backoff.js';
import type { CheckpointResult, TurnCheckpoint } from './checkpoint.js';
import { collectProviderStream, type CollectedToolUse } from './collect-stream.js';
import { buildSystemPromptWithSkills, projectMessages } from './project-messages.js';
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
const DEFAULT_CHECKPOINT_TIMEOUT_MS = 120_000;
const CHECKPOINT_EVENT_PLUGIN_ID = asPluginId('react-loop');

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

/** What a clean provider call produced — input to {@link ReactLoopOptions.onProviderSuccess}. */
export interface ProviderSuccessInfo {
  readonly text: string;
  readonly stopReason: StopReason;
  readonly toolUses: ReadonlyArray<CollectedToolUse>;
  readonly usage?: TokenUsage;
  readonly iteration: number;
}

/** A completed tool batch — input to {@link ReactLoopOptions.onToolBatchEnd}. */
export interface ToolBatchInfo {
  readonly toolUses: ReadonlyArray<CollectedToolUse>;
  readonly iteration: number;
}

/** Hooks return this to end the turn; the hook emits its own wrap-up events first. */
export interface StopDirective {
  readonly action: 'stop';
}

export interface ReactLoopOptions {
  /** Name stamped on `mode_iteration` events (e.g. `'default'`, `'goal'`). */
  readonly strategyName: string;
  /**
   * Iteration cap when the context doesn't supply one. Default 500. May be
   * `Number.POSITIVE_INFINITY` for an uncapped loop (goal mode): the run then
   * ends only via a terminal signal (checkpoint/hook stop, abort, fatal
   * error) — an explicit `ctx.maxIterations` still takes precedence.
   */
  readonly defaultMaxIterations?: number;
  /** Prefix for provider-error messages (goal mode uses `'goal: '`). */
  readonly errorPrefix?: string;
  /**
   * When set, an already-aborted signal is reported (with this reason) BEFORE
   * the first iteration — goal/collab preflight. When omitted the first
   * iteration's own abort check covers it with the generic reason.
   */
  readonly preflightAbortReason?: string;
  /** Turn-end gates, run in declared order. Omit/empty → plain ReAct loop. */
  readonly checkpoints?: ReadonlyArray<TurnCheckpoint>;
  /**
   * Hard cap on checkpoint `inject`/`retry` rounds per idle EPISODE — i.e.
   * consecutive gate rounds with no tool work between them; the count resets
   * whenever a tool batch executes (default 3). When exhausted the turn ends
   * with the model's answer as-is plus a visible warning — a
   * permanently-failing gate degrades loudly instead of looping forever.
   */
  readonly maxInjections?: number;
  /** Clamp on injected feedback length in characters (default 16_384). */
  readonly maxInjectChars?: number;
  /**
   * Stuck-loop policy + wording overrides; sensible defaults from
   * `strategyName`. `action` picks what a detector trip does:
   *
   *   - `'abort'` (default): fail the batch and end the turn with a fatal
   *     error — the historical behavior, right for attended modes where the
   *     user is present to redirect.
   *   - `'nudge'`: never stop. The batch still executes (repeated calls are
   *     usually legitimate work — re-running a failing build between edits),
   *     a visible warning + `extraOnStuck` events are emitted, the detector
   *     resets, and `nudgeText` (or a default) rides the next provider call
   *     as a volatile steer. For unattended modes (goal) where a heuristic
   *     must never kill the run.
   */
  readonly stuck?: Partial<StuckLoopReport> & {
    readonly action?: 'abort' | 'nudge';
    /** Volatile steer for `'nudge'` trips; default wording when omitted. */
    readonly nudgeText?: (info: StuckTripInfo) => string;
  };
  /**
   * Runs after compaction/elision, before the provider call. May return a
   * volatile user message to ride ONLY the next call (collab's inbox/pause
   * awareness) — never appended to the log; the cache strategy is told via
   * `volatileTailCount` so its tail breakpoint stays ahead of it.
   */
  readonly onIterationStart?: (
    ctx: ModeContext,
    iteration: number,
  ) => Promise<{ readonly volatileUserText?: string } | undefined>;
  /**
   * Runs after every clean provider call (reasoning already logged, tools not
   * yet executed). Return `{action: 'stop'}` to end the turn — the hook emits
   * its own wrap-up events first (goal mode's token-budget backstop).
   */
  readonly onProviderSuccess?: (
    ctx: ModeContext,
    info: ProviderSuccessInfo,
  ) => Promise<StopDirective | undefined>;
  /**
   * Runs after a tool batch executes cleanly. Return `{action: 'stop'}` to
   * end the turn (goal/collab terminal-tool detection: `goal_complete`,
   * `collab_done`); the hook emits its own completion events first.
   */
  readonly onToolBatchEnd?: (
    ctx: ModeContext,
    info: ToolBatchInfo,
  ) => Promise<StopDirective | undefined>;
  /**
   * Replaces the default "exceeded maxIterations" fatal error — the hook
   * emits its own cap-reached events (goal mode adds a plugin event and its
   * own wording). The loop returns right after.
   */
  readonly onMaxIterations?: (ctx: ModeContext, maxIterations: number) => Promise<void>;
}

export async function* runReactLoop(
  ctx: ModeContext,
  opts: ReactLoopOptions,
): AsyncIterable<MoxxyEvent> {
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

    const systemPrompt = buildSystemPromptWithSkills(ctx.systemPrompt, ctx.skills.list());
    const { messages, stablePrefixIndex } = projectMessages(ctx, {
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(volatileText ? { trailingUserText: volatileText } : {}),
    });

    yield await ctx.emit({
      type: 'provider_request',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: ctx.provider.name,
      model: ctx.model,
    });

    const { text, toolUses, stopReason, error, usage, reasoning } = await collectProviderStream(
      ctx,
      messages,
      {
        iteration,
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

/** Gate outcome: end the turn, or loop again (optionally with a volatile nudge). */
type GateVerdict = { readonly kind: 'end' } | { readonly kind: 'loop'; readonly volatileText?: string };

interface GateRound {
  readonly candidateText: string;
  readonly stopReason: StopReason;
  readonly iteration: number;
  readonly consecutiveIdle: number;
  readonly injectionsUsed: number;
  readonly injectionBudget: number;
  readonly maxInjectChars: number;
}

async function* runCheckpointGate(
  ctx: ModeContext,
  checkpoints: ReadonlyArray<TurnCheckpoint>,
  round: GateRound,
): AsyncGenerator<MoxxyEvent, GateVerdict> {
  // Natural completions face every checkpoint; truncated/errored candidates
  // only face the idle-tolerant ones — reviewing a half-sentence as if it
  // were a completion claim wastes a checker run and confuses the model.
  const eligible = checkpoints.filter(
    (cp) => round.stopReason === 'end_turn' || (cp.gateOn ?? 'end_turn') === 'idle',
  );
  if (eligible.length === 0) return { kind: 'end' };

  // Budget exhausted → the answer ships as-is, but LOUDLY: silent
  // degradation would let the user believe a gated answer passed its gates.
  if (round.injectionsUsed >= round.injectionBudget) {
    yield await emitError(
      ctx,
      'retryable',
      `checkpoint budget exhausted (${round.injectionBudget} rounds) — ` +
        `ending the turn with unresolved checkpoint feedback; verify the result manually.`,
    );
    return { kind: 'end' };
  }

  for (const cp of eligible) {
    // User cancelled mid-gate: end the turn WITHOUT retracting the
    // already-logged answer — an abort must never un-say what was said.
    if (ctx.signal.aborted) return { kind: 'end' };

    yield await emitCheckpointEvent(ctx, 'checkpoint_started', {
      name: cp.name,
      iteration: round.iteration,
    });

    const timeoutMs = Math.max(1_000, cp.timeoutMs ?? DEFAULT_CHECKPOINT_TIMEOUT_MS);
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(), timeoutMs);
    timer.unref?.();
    let result: CheckpointResult;
    try {
      result = await cp.run(
        {
          candidateText: round.candidateText,
          stopReason: round.stopReason,
          iteration: round.iteration,
          consecutiveIdle: round.consecutiveIdle,
          injectionsUsed: round.injectionsUsed,
          injectionBudget: round.injectionBudget,
          signal: AbortSignal.any([ctx.signal, timeoutCtl.signal]),
        },
        ctx,
      );
    } catch (err) {
      if (ctx.signal.aborted) return { kind: 'end' };
      // Fail OPEN, visibly. A crashed or timed-out checker downgrades the
      // gate to a warning — it must never wedge the turn (fail-closed is a
      // turn that can never end) and never crash it (the answer is already
      // logged).
      const why = timeoutCtl.signal.aborted
        ? `timed out after ${timeoutMs}ms`
        : `failed: ${err instanceof Error ? err.message : String(err)}`;
      yield await emitError(ctx, 'retryable', `checkpoint "${cp.name}" ${why} — proceeding unchecked`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    switch (result.action) {
      case 'pass': {
        yield await emitCheckpointEvent(ctx, 'checkpoint_passed', { name: cp.name });
        continue;
      }
      case 'stop': {
        // The checkpoint already emitted its own wrap-up events.
        yield await emitCheckpointEvent(ctx, 'checkpoint_stopped', { name: cp.name });
        return { kind: 'end' };
      }
      case 'retry': {
        yield await emitCheckpointEvent(ctx, 'checkpoint_retry', { name: cp.name });
        return { kind: 'loop' };
      }
      case 'inject': {
        // Guard the guard: an inject with blank text would loop the turn
        // with no new signal for the model — a checker bug; fail open.
        const feedback = result.text?.trim();
        if (!feedback) {
          yield await emitError(
            ctx,
            'retryable',
            `checkpoint "${cp.name}" injected empty feedback — ignored`,
          );
          continue;
        }
        const clamped = clampChars(feedback, round.maxInjectChars);
        if (result.volatile) {
          yield await emitCheckpointEvent(ctx, 'checkpoint_injected', {
            name: cp.name,
            volatile: true,
          });
          return { kind: 'loop', volatileText: clamped };
        }
        // Persistent: a checkpoint-origin user prompt. Projected as a
        // user-role message by the existing projection case, marked via the
        // same `origin` machinery trigger prompts use, cache-safe because it
        // is an ordinary append at the log tail.
        yield await ctx.emit({
          type: 'user_prompt',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          text: clamped,
          origin: { kind: 'checkpoint', name: cp.name },
        });
        yield await emitCheckpointEvent(ctx, 'checkpoint_injected', {
          name: cp.name,
          volatile: false,
        });
        return { kind: 'loop' };
      }
    }
  }
  return { kind: 'end' };
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

function clampChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[checkpoint feedback truncated: ${text.length - max} chars dropped]`;
}

async function emitAbort(ctx: ModeContext, reason: string): Promise<MoxxyEvent> {
  return ctx.emit({
    type: 'abort',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    reason,
  });
}

async function emitError(
  ctx: ModeContext,
  kind: 'retryable' | 'fatal',
  message: string,
): Promise<MoxxyEvent> {
  return ctx.emit({
    type: 'error',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    kind,
    message,
  });
}

async function emitCheckpointEvent(
  ctx: ModeContext,
  subtype: string,
  payload: unknown,
): Promise<MoxxyEvent> {
  return ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    pluginId: CHECKPOINT_EVENT_PLUGIN_ID,
    subtype,
    payload,
  });
}
