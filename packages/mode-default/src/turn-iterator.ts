import {
  buildSystemPromptWithSkills,
  collectProviderStream,
  createStuckLoopDetector,
  emitRequestsAndDetectStuck,
  executeToolUses,
  isContextOverflowError,
  nextBackoffMs,
  projectMessages,
  runCompactionIfNeeded,
  runElisionIfNeeded,
  sleepWithAbort,
  usageEventFields,
  type ModeContext,
  type MoxxyEvent,
  type ProjectedMessages,
} from '@moxxy/sdk';

export const DEFAULT_MODE_NAME = 'default';

/**
 * Bounded back-off for a *retryable* provider error (rate-limit/429,
 * overloaded, transient 5xx, ECONNRESET/ETIMEDOUT). Without it, a sustained
 * retryable condition becomes a tight busy-loop: the loop rebuilds the message
 * set and re-hits the provider with zero delay up to `maxIterations` times,
 * burning rate-limit budget and worsening the throttle. We back off
 * exponentially (abort-aware) and give up with a fatal error after
 * {@link MAX_CONSECUTIVE_RETRIES} consecutive failures — the counter resets on
 * any clean provider call, so a long turn can still recover from transient
 * blips. (The context-overflow path keeps its own MAX_REACTIVE_COMPACTIONS
 * budget and is handled before this.)
 */
export const MAX_CONSECUTIVE_RETRIES = 6;

/** Exponential back-off base/cap for the retry schedule (attempt is 1-based). */
const RETRY_BACKOFF_BASE_MS = 500;
const RETRY_BACKOFF_CAP_MS = 30_000;

// Abort-aware sleep, injectable for tests so the back-off path runs instantly
// and deterministically. Production delegates to the SDK's sleepWithAbort: a
// real timer that clears (and drops its abort listener) when the signal fires,
// so a pending back-off never outlives a cancelled turn.
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

export async function* runDefaultMode(ctx: ModeContext): AsyncIterable<MoxxyEvent> {
  // High soft cap as a safety net against truly runaway modes (network
  // glitch causing an infinite retry, bad prompt, etc.) — primary
  // termination signal is the stuck-loop detector, which catches the
  // common "model keeps calling the same tool" case ~10 iterations in.
  // Coerce a caller/config-supplied bound to a positive integer; a degenerate
  // value (0, negative, NaN, fractional) would otherwise make the loop never
  // run and emit a misleading "exceeded maxIterations" fatal. Treat anything
  // un-coercible (NaN) as the default rather than failing the turn.
  const requestedMaxIterations = ctx.maxIterations;
  const maxIterations =
    typeof requestedMaxIterations === 'number' && Number.isFinite(requestedMaxIterations)
      ? Math.max(1, Math.floor(requestedMaxIterations))
      : 500;
  const detector = createStuckLoopDetector(ctx.loopGuard);
  // Reactive-compaction budget per overflow episode. If the provider keeps
  // rejecting for context size even after compacting this many times, give up
  // (the overflow is in the recent, un-compactable tail). Reset on any clean
  // provider call so a long turn can recover from multiple overflow episodes.
  const MAX_REACTIVE_COMPACTIONS = 2;
  let reactiveCompactions = 0;
  // Consecutive retryable-error count; reset on any clean provider call. Caps
  // the busy-loop a sustained retryable condition would otherwise create.
  let consecutiveRetries = 0;

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
      strategy: DEFAULT_MODE_NAME,
      iteration,
    });

    // Auto-compact before composing the next provider request. If the
    // active compactor's `shouldCompact` returns true, this appends a
    // compaction event onto the log — projectMessagesFromLog (called
    // by buildMessages) honors it, so the model sees a summarized
    // prefix instead of overflowing the window mid-loop.
    await runCompactionIfNeeded(ctx);
    // Turn-boundary elision (context-on-demand): stub old bulky tool output and
    // (when enabled) old text turns, recall-able on demand. Composes with
    // compaction over the same projection.
    await runElisionIfNeeded(ctx);

    const { messages, stablePrefixIndex } = buildMessages(ctx);
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
      },
    );

    // A user cancellation WHILE the provider stream was being consumed surfaces
    // as a non-retryable provider `error` ("The operation was aborted") rather
    // than a clean abort — collectProviderStream catches the fetch AbortError
    // and classifies it as fatal. Treat it as the cancellation it is so
    // downstream channels render a 'stopped' turn, not a failed/error turn.
    if (ctx.signal.aborted) {
      yield await ctx.emit({
        type: 'abort',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        reason: 'signal aborted during provider stream',
      });
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
      // The request was too big for the model's window: our token estimate
      // lagged the provider's real tokenizer, so the proactive compactor
      // didn't fire. Force a compaction and retry rather than dying — this is
      // the auto-compact-on-overflow path.
      if (
        isContextOverflowError(error.message) &&
        reactiveCompactions < MAX_REACTIVE_COMPACTIONS
      ) {
        const compacted = await runCompactionIfNeeded(ctx, { force: true });
        if (compacted) {
          // Only count an attempt that actually compacted against the budget —
          // a no-op (overflow lives in the un-compactable recent tail) must not
          // deny a later, genuinely compactable overflow its retry.
          reactiveCompactions += 1;
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
      if (!error.retryable) {
        yield await ctx.emit({
          type: 'error',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          kind: 'fatal',
          message: error.message,
        });
        return;
      }
      // Retryable: surface it, then back off before retrying. A persistent
      // retryable condition (sustained 429 / outage) must NOT busy-loop the
      // provider — give up with a fatal error after the bounded retry count.
      consecutiveRetries += 1;
      yield await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: 'retryable',
        message: error.message,
      });
      if (consecutiveRetries >= MAX_CONSECUTIVE_RETRIES) {
        yield await ctx.emit({
          type: 'error',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          kind: 'fatal',
          message:
            `provider kept returning a retryable error ${consecutiveRetries} times in a row ` +
            `(last: ${error.message}); giving up rather than hammering the provider.`,
        });
        return;
      }
      await sleepImpl(
        nextBackoffMs(consecutiveRetries, RETRY_BACKOFF_BASE_MS, RETRY_BACKOFF_CAP_MS),
        ctx.signal,
      );
      if (ctx.signal.aborted) {
        yield await ctx.emit({
          type: 'abort',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          reason: 'signal aborted during retry back-off',
        });
        return;
      }
      continue;
    }
    // Clean provider call — reset the overflow-recovery + retry budgets.
    reactiveCompactions = 0;
    consecutiveRetries = 0;

    // Finalize the reasoning summary for THIS call BEFORE the tool/assistant
    // emits, so the log order is reasoning → tool_use → text (projection
    // attaches the signed thinking block as content[0] of the same assistant
    // turn). collectProviderStream already guards on non-empty text / encrypted.
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

    const stuck = yield* emitRequestsAndDetectStuck(ctx, toolUses, detector, {
      abortedResultMessage: 'default mode loop aborted (stuck pattern) before this call ran',
      nearHint: 'against the same target (only volatile args like maxBytes varied)',
      fatalMessage: ({ toolName, count, how }) =>
        `default mode loop aborted — detected stuck pattern: tool "${toolName}" called ` +
        `${count} times ${how}. The model is likely looping on the same call; ` +
        `reset or rephrase.`,
    });
    if (stuck) return;

    if (text || stopReason === 'end_turn' || toolUses.length === 0) {
      // A completion with no text, no tool uses, and a non-natural stop (e.g.
      // 'max_tokens' truncated to nothing) yields a blank assistant bubble that
      // silently swallows the truncation signal. Surface a retryable note so the
      // user sees why the turn produced nothing, alongside the (preserved)
      // empty assistant_message.
      if (!text && toolUses.length === 0 && stopReason !== 'end_turn') {
        yield await ctx.emit({
          type: 'error',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          kind: 'retryable',
          message: `provider returned an empty completion (stopReason: ${stopReason ?? 'unknown'})`,
        });
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

    // Execute whenever the model requested tools, regardless of stopReason.
    // Providers vary in how reliably they report `stopReason: 'tool_use'`
    // (Codex's Responses API doesn't carry one on `response.completed`, so
    // the provider has to infer it from emitted events). Trusting only
    // stopReason here meant a single provider mis-mapping silently dropped
    // tool calls — `tool_call_requested` would be emitted with no matching
    // `tool_result`, leaving an orphan pending dot and a stuck-looking UI.
    if (toolUses.length === 0) return;

    const exited = yield* executeToolUses(ctx, toolUses, iteration);
    if (exited) return;
  }

  yield await ctx.emit({
    type: 'error',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    kind: 'fatal',
    message: `default mode loop exceeded maxIterations (${maxIterations})`,
  });
}

function buildMessages(ctx: ModeContext): ProjectedMessages {
  // Compose the system prompt with the skill catalog so the model knows
  // which playbooks exist; without this skills are invisible to the
  // model and it falls back to ad-hoc tool calls (the classic
  // `web_fetch instead of media-digest skill` symptom).
  const systemPrompt = buildSystemPromptWithSkills(ctx.systemPrompt, ctx.skills.list());
  return projectMessages(ctx, { ...(systemPrompt ? { systemPrompt } : {}) });
}
