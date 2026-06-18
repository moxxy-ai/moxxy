import type { ProviderMessage } from '../provider.js';
import type { ModeContext } from '../mode.js';
import { runCompactionIfNeeded } from '../compactor-helpers.js';
import { runElisionIfNeeded } from '../elision-helpers.js';
import { usageEventFields } from '../token-accounting.js';
import { collectProviderStream } from './collect-stream.js';

/**
 * Run a single-shot (no-tools) provider turn — the shape every planner /
 * synthesis phase shares. Runs context management (compaction + elision),
 * emits the `provider_request` bookend, streams the response with tools
 * disabled, then emits either an `error` event (returning `null`) or the
 * `provider_response` bookend (returning the collected text).
 *
 * Replaces the ~40-line block each mode phase used to inline; centralizing it
 * keeps event emission uniform and means a fix here (e.g. always running
 * elision) lands for every loop strategy at once.
 */
export async function runSingleShotTurn(
  ctx: ModeContext,
  messages: ReadonlyArray<ProviderMessage>,
  opts: { maxTokens?: number } = {},
): Promise<string | null> {
  await runCompactionIfNeeded(ctx);
  await runElisionIfNeeded(ctx);

  await ctx.emit({
    type: 'provider_request',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    provider: ctx.provider.name,
    model: ctx.model,
  });

  const { text, usage, error } = await collectProviderStream(ctx, messages, {
    includeTools: false,
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
  });
  if (error) {
    await ctx.emit({
      type: 'error',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      kind: error.retryable ? 'retryable' : 'fatal',
      message: error.message,
    });
    return null;
  }

  await ctx.emit({
    type: 'provider_response',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    provider: ctx.provider.name,
    model: ctx.model,
    ...usageEventFields(usage),
  });

  return text;
}
