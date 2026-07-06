import type { newTurnId } from '@moxxy/core';
import { PlainTurnRenderer, driveTurn, subscribeTurn } from '@moxxy/channel-kit';
import type { ClientSession as Session } from '@moxxy/sdk';
import { ChunkedSender, type ChunkLimits } from './chunker.js';

export interface TurnRunnerLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface RunImessageTurnDeps {
  readonly session: Session;
  /** Deliver one outbound message to the turn's reply target. Must swallow its
   *  own transport errors (log + resolve) — a failed send never aborts the turn. */
  readonly send: (text: string) => Promise<void>;
  readonly chunkLimits?: ChunkLimits;
  readonly logger?: TurnRunnerLogger;
}

export interface RunImessageTurnOptions {
  readonly text: string;
  readonly model?: string;
  readonly controller: AbortController;
  /** Pre-minted turn id; the channel records it as an own-turn id (invariant #8). */
  readonly turnId: ReturnType<typeof newTurnId>;
}

/**
 * Drive a single iMessage turn end-to-end: subscribe to THIS turn's events
 * (filtered by turnId — `session.log` fans out to every listener, AGENTS.md
 * invariant #8), stream the rendered snapshot through the buffered
 * {@link ChunkedSender} (see chunker.ts for why iMessage gets chunked sends
 * instead of FramePump edits — apple-script messages are immutable), run the
 * turn, flush the final remainder, and unwind in `finally`. No typing indicator:
 * that needs the BlueBubbles Private API, which v1 deliberately omits.
 */
export async function runImessageTurn(
  deps: RunImessageTurnDeps,
  opts: RunImessageTurnOptions,
): Promise<void> {
  const { session, send, logger } = deps;
  const { text, model, controller, turnId } = opts;

  const renderer = new PlainTurnRenderer();
  const sender = new ChunkedSender({
    send: async (t) => {
      try {
        await send(t);
      } catch (err) {
        logger?.warn?.('imessage: send failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    },
    ...(deps.chunkLimits ? { limits: deps.chunkLimits } : {}),
  });

  const unsubscribe = subscribeTurn(session, turnId, (event) => {
    if (renderer.accept(event)) sender.offer(renderer.snapshot());
  });

  try {
    await driveTurn(session, {
      turnId,
      prompt: text,
      ...(model ? { model } : {}),
      signal: controller.signal,
    });
    await sender.finalize(renderer.snapshot(), '(no output)');
  } catch (err) {
    logger?.warn?.('imessage: turn failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    // Surface the failure to the sender rather than going silent.
    try {
      await send(`Turn failed: ${err instanceof Error ? err.message : String(err)}`);
    } catch {
      /* best-effort */
    }
  } finally {
    unsubscribe();
  }
}
