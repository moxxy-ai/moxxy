import {
  asToolCallId,
  buildSystemPromptWithSkills,
  collectProviderStream,
  createStuckLoopDetector,
  dispatchToolCall,
  projectMessages,
  runCompactionIfNeeded,
  runElisionIfNeeded,
  usageEventFields,
  type ModeContext,
  type MoxxyEvent,
} from '@moxxy/sdk';

import { COMPLETION_CHECK_SYSTEM_PROMPT, GOAL_MODE_NAME } from './constants.js';

/**
 * The completion check is meant to be one verify command + a verdict. If the
 * model calls the same Bash twice it's already wasting the round; three times
 * means it's looping — bail. (Mirrors mode-developer's verify-phase tuning.)
 */
const CHECK_STUCK_WINDOW = 4;
const CHECK_STUCK_THRESHOLD = 2;
const CHECK_MAX_ITERATIONS = 8;

/**
 * Run the completion-check sub-loop: ask the model to confirm the objective is
 * delivered (running a verify command when it's code work), then emit the
 * VERDICT block. Returns the model's final text (the verdict the caller parses)
 * or `null` on abort / fatal error (already emitted). Adapted near-verbatim
 * from mode-developer's runVerifyPhase — same tool-use shape, different prompt.
 */
export async function* runCompletionCheck(
  ctx: ModeContext,
  goal: string,
): AsyncGenerator<MoxxyEvent, string | null, unknown> {
  let finalText = '';
  const detector = createStuckLoopDetector({
    windowSize: CHECK_STUCK_WINDOW,
    repeatThreshold: CHECK_STUCK_THRESHOLD,
  });

  for (let iteration = 1; iteration <= CHECK_MAX_ITERATIONS; iteration++) {
    if (ctx.signal.aborted) return null;

    yield await ctx.emit({
      type: 'mode_iteration',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      strategy: GOAL_MODE_NAME,
      iteration,
    });

    await runCompactionIfNeeded(ctx);
    await runElisionIfNeeded(ctx);

    const baseSystem =
      buildSystemPromptWithSkills(ctx.systemPrompt, ctx.skills.list()) ?? ctx.systemPrompt ?? '';
    const systemPrompt = baseSystem
      ? `${COMPLETION_CHECK_SYSTEM_PROMPT}\n\n${baseSystem}`
      : COMPLETION_CHECK_SYSTEM_PROMPT;
    const { messages, stablePrefixIndex } = projectMessages(ctx, {
      systemPrompt,
      trailingUserText:
        `Checkpoint. The original objective was:\n\n${goal}\n\n` +
        `Confirm whether it is now FULLY delivered, then reply with the VERDICT block exactly as specified.`,
    });

    await ctx.emit({
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

    await ctx.emit({
      type: 'provider_response',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: ctx.provider.name,
      model: ctx.model,
      ...usageEventFields(usage),
    });

    if (error) {
      yield await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: error.retryable ? 'retryable' : 'fatal',
        message: `goal.check: ${error.message}`,
      });
      if (!error.retryable) return null;
      continue;
    }

    if (text) {
      finalText = text;
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
      // Model stopped with no more tool calls — the check is done.
      return finalText;
    }

    for (const t of toolUses) {
      const sig = detector.record(t.name, t.input);
      if (sig.stuck) {
        const how = sig.kind === 'near' ? 'against the same target' : 'with identical input';
        yield await ctx.emit({
          type: 'error',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          kind: 'fatal',
          message:
            `goal.check: detected stuck pattern — tool "${t.name}" called ${sig.count} times ${how}. ` +
            `Stopping the check with whatever verdict the model produced.`,
        });
        return finalText;
      }

      yield await ctx.emit({
        type: 'tool_call_requested',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        callId: asToolCallId(t.id),
        name: t.name,
        input: t.input,
      });
      // Drain the dispatch generator — its events reach the log via ctx.emit.
      for await (const _ of dispatchToolCall(ctx, t, iteration)) void _;
    }
  }

  // Hit the cap without a clean verdict — surface whatever we have; the parser
  // treats unparseable output as GOAL_NOT_MET so the outer loop keeps going.
  return finalText;
}
