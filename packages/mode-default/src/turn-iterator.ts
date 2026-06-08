import {
  buildSystemPromptWithSkills,
  collectProviderStream,
  createStuckLoopDetector,
  emitRequestsAndDetectStuck,
  executeToolUses,
  isContextOverflowError,
  projectMessages,
  runCompactionIfNeeded,
  runElisionIfNeeded,
  usageEventFields,
  type ModeContext,
  type MoxxyEvent,
  type ProjectedMessages,
} from '@moxxy/sdk';

export const DEFAULT_MODE_NAME = 'default';

export async function* runDefaultMode(ctx: ModeContext): AsyncIterable<MoxxyEvent> {
  // High soft cap as a safety net against truly runaway modes (network
  // glitch causing an infinite retry, bad prompt, etc.) — primary
  // termination signal is the stuck-loop detector, which catches the
  // common "model keeps calling the same tool" case ~10 iterations in.
  const maxIterations = ctx.maxIterations ?? 500;
  const detector = createStuckLoopDetector();
  // Reactive-compaction budget per overflow episode. If the provider keeps
  // rejecting for context size even after compacting this many times, give up
  // (the overflow is in the recent, un-compactable tail). Reset on any clean
  // provider call so a long turn can recover from multiple overflow episodes.
  const MAX_REACTIVE_COMPACTIONS = 2;
  let reactiveCompactions = 0;

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

    const { text, toolUses, stopReason, error, usage } = await collectProviderStream(ctx, messages, {
      iteration,
      stablePrefixIndex,
    });

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
        reactiveCompactions += 1;
        const compacted = await runCompactionIfNeeded(ctx, { force: true });
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
        message: error.message,
      });
      if (!error.retryable) return;
      continue;
    }
    // Clean provider call — reset the overflow-recovery budget.
    reactiveCompactions = 0;

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
