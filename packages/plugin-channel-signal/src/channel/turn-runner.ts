import type { newTurnId } from '@moxxy/core';
import { PlainTurnRenderer, driveTurn, subscribeTurn } from '@moxxy/channel-kit';
import type { ClientSession as Session } from '@moxxy/sdk';
import { ChunkedSender, type ChunkLimits } from './chunker.js';

export interface TurnRunnerLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface RunSignalTurnDeps {
  readonly session: Session;
  /** Deliver one outbound message to the turn's reply target. Must swallow its
   *  own transport errors (log + resolve) — a failed send never aborts the turn. */
  readonly send: (text: string) => Promise<void>;
  /** Start/refresh the typing indicator (best-effort; errors swallowed). */
  readonly sendTyping?: (stop: boolean) => Promise<void>;
  readonly chunkLimits?: ChunkLimits;
  readonly logger?: TurnRunnerLogger;
}

export interface RunSignalTurnOptions {
  readonly text: string;
  readonly model?: string;
  readonly controller: AbortController;
  /** Pre-minted turn id; the channel records it as an own-turn id (invariant #8). */
  readonly turnId: ReturnType<typeof newTurnId>;
}

/** Signal shows a typing indicator for ~15s per sendTyping; refresh under that. */
const TYPING_REFRESH_MS = 10_000;

/**
 * Drive a single Signal turn end-to-end: subscribe to THIS turn's events
 * (filtered by turnId — `session.log` fans out to every listener, AGENTS.md
 * invariant #8), stream the rendered snapshot through the buffered
 * {@link ChunkedSender} (see chunker.ts for why Signal gets chunked sends
 * instead of FramePump edits), keep a typing indicator alive for liveness, run
 * the turn, flush the final remainder, and unwind in `finally`.
 */
export async function runSignalTurn(
  deps: RunSignalTurnDeps,
  opts: RunSignalTurnOptions,
): Promise<void> {
  const { session, send, sendTyping, logger } = deps;
  const { text, model, controller, turnId } = opts;

  const renderer = new PlainTurnRenderer();
  const sender = new ChunkedSender({
    send: async (t) => {
      try {
        await send(t);
      } catch (err) {
        logger?.warn?.('signal: send failed', { err: err instanceof Error ? err.message : String(err) });
      }
    },
    ...(deps.chunkLimits ? { limits: deps.chunkLimits } : {}),
  });

  // Liveness: refresh the typing indicator while the turn runs (each
  // sendTyping shows for ~15s). Best-effort — a failure only loses the
  // indicator, never the turn.
  const typing = (stop: boolean): void => {
    if (!sendTyping) return;
    void sendTyping(stop).catch(() => undefined);
  };
  typing(false);
  const typingTimer = setInterval(() => typing(false), TYPING_REFRESH_MS);
  typingTimer.unref?.();

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
    logger?.warn?.('signal: turn failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    // Surface the failure to the sender rather than going silent.
    try {
      await send(`Turn failed: ${err instanceof Error ? err.message : String(err)}`);
    } catch {
      /* best-effort */
    }
  } finally {
    clearInterval(typingTimer);
    typing(true);
    unsubscribe();
  }
}
