import {
  runCompactionIfNeeded,
  type ModeContext,
  type ProviderMessage,
} from '@moxxy/sdk';

import { SYNTHESIS_SYSTEM_PROMPT } from './constants.js';

/**
 * Run the synthesis turn: single-shot stream that consumes the
 * per-subagent findings and produces the final structured writeup.
 * Returns the assembled text or null on error.
 */
export async function collectSynthesis(
  ctx: ModeContext,
  inputBody: string,
): Promise<string | null> {
  await runCompactionIfNeeded(ctx);

  const messages: ProviderMessage[] = [
    {
      role: 'system',
      content: [{ type: 'text', text: SYNTHESIS_SYSTEM_PROMPT }],
    },
    {
      role: 'user',
      content: [{ type: 'text', text: inputBody }],
    },
  ];

  await ctx.emit({
    type: 'provider_request',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    provider: ctx.provider.name,
    model: ctx.model,
  });

  let text = '';
  try {
    for await (const event of ctx.provider.stream({
      model: ctx.model,
      messages,
      maxTokens: 4096,
      signal: ctx.signal,
    })) {
      if (event.type === 'text_delta') {
        text += event.delta;
        await ctx.emit({
          type: 'assistant_chunk',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'model',
          delta: event.delta,
        });
      } else if (event.type === 'error') {
        await ctx.emit({
          type: 'error',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          kind: event.retryable ? 'retryable' : 'fatal',
          message: event.message,
        });
        return null;
      }
    }
  } catch (err) {
    await ctx.emit({
      type: 'error',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      kind: 'fatal',
      message: err instanceof Error ? err.message : String(err),
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
  });

  return text;
}
