import type { newTurnId } from '@moxxy/core';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { MoxxyEvent } from '@moxxy/sdk';
import { FramePump } from './frame-pump.js';
import type { SlackClient } from './slack-client.js';

export interface TurnRunnerLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface RunSlackTurnDeps {
  readonly session: Session;
  readonly client: SlackClient;
  readonly editFrameMs: number;
  readonly logger?: TurnRunnerLogger;
}

export interface RunSlackTurnOptions {
  /** Channel the triggering event arrived in. */
  readonly channel: string;
  /** Thread root for the reply: `event.thread_ts ?? event.ts`. */
  readonly threadTs: string;
  readonly text: string;
  readonly model?: string;
  readonly controller: AbortController;
  /** Pre-minted turn id; the channel records it as an own-turn id. */
  readonly turnId: ReturnType<typeof newTurnId>;
}

/**
 * Accumulate streamed assistant text from the event log into a single growing
 * snapshot. We render `assistant_chunk` deltas live and fall back to the final
 * `assistant_message` content (which supersedes the streamed deltas for the
 * same turn) so the last edit always carries the complete reply.
 */
class TurnRenderer {
  private streamed = '';
  private finalText: string | null = null;

  accept(event: MoxxyEvent): boolean {
    if (event.type === 'assistant_chunk') {
      this.streamed += event.delta;
      return true;
    }
    if (event.type === 'assistant_message') {
      this.finalText = event.content;
      return true;
    }
    return false;
  }

  snapshot(): string {
    return (this.finalText ?? this.streamed).trim();
  }
}

/**
 * Drive a single Slack turn end-to-end: subscribe the frame pump to THIS turn's
 * events (filtered by turnId — `session.log` fans out to every listener, so a
 * concurrent turn on the same Session would otherwise stream into this thread,
 * AGENTS.md invariant #8), run the turn through `runTurn`, flush the final
 * frame, and unwind in `finally`.
 *
 * The turnId is minted by the caller so the channel can also record it as an
 * own-turn id (it filters foreign-turn mirroring on those).
 */
export async function runSlackTurn(
  deps: RunSlackTurnDeps,
  opts: RunSlackTurnOptions,
): Promise<void> {
  const { session, client, editFrameMs, logger } = deps;
  const { channel, threadTs, text, model, controller, turnId } = opts;

  const renderer = new TurnRenderer();
  const pump = new FramePump({
    client,
    channel,
    threadTs,
    editFrameMs,
    ...(logger ? { logger } : {}),
  });

  const unsubscribe = session.log.subscribe((event) => {
    if (event.turnId !== turnId) return;
    if (renderer.accept(event)) pump.setText(renderer.snapshot());
  });

  try {
    for await (const _event of session.runTurn(text, {
      turnId,
      ...(model ? { model } : {}),
      signal: controller.signal,
    })) {
      void _event;
    }
    await pump.flush(true);
  } catch (err) {
    logger?.warn?.('slack turn failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    // Surface the failure into the thread rather than leaving a dangling
    // placeholder. Errors from this send are swallowed (best-effort).
    try {
      await client.postMessage({
        channel,
        threadTs,
        text: `Turn failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } catch {
      /* ignore */
    }
  } finally {
    unsubscribe();
    pump.dispose();
  }
}
