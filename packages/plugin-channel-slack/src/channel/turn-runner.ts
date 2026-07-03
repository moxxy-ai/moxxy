import type { newTurnId } from '@moxxy/core';
import type { ClientSession as Session } from '@moxxy/sdk';
import { FramePump, PlainTurnRenderer, driveTurn, subscribeTurn } from '@moxxy/channel-kit';
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
 * Drive a single Slack turn end-to-end: subscribe the frame pump to THIS turn's
 * events (filtered by turnId — `session.log` fans out to every listener, so a
 * concurrent turn on the same Session would otherwise stream into this thread,
 * AGENTS.md invariant #8), run the turn through `runTurn`, flush the final
 * frame, and unwind in `finally`.
 *
 * The streaming loop is `@moxxy/channel-kit`'s {@link FramePump} ("post once
 * via `chat.postMessage`, then edit THAT message via `chat.update`, throttled
 * to `editFrameMs`") over a {@link PlainTurnRenderer} snapshot; only the Slack
 * Web-API calls live here. The turnId is minted by the caller so the channel
 * can also record it as an own-turn id (it filters foreign-turn mirroring on
 * those).
 */
export async function runSlackTurn(
  deps: RunSlackTurnDeps,
  opts: RunSlackTurnOptions,
): Promise<void> {
  const { session, client, editFrameMs, logger } = deps;
  const { channel, threadTs, text, model, controller, turnId } = opts;

  const renderer = new PlainTurnRenderer();
  const pump = new FramePump<string>({
    editFrameMs,
    frame: () => renderer.snapshot(),
    // Guarantee at least one message even when the turn produced no text.
    emptyFinalText: '_(no output)_',
    sink: {
      send: async (t) => {
        try {
          const res = await client.postMessage({ channel, text: t, threadTs });
          return res.ts;
        } catch (err) {
          logger?.warn?.('slack chat.postMessage failed', { err: String(err) });
          return null;
        }
      },
      edit: async (ts, t) => {
        try {
          await client.updateMessage({ channel, ts, text: t });
        } catch (err) {
          logger?.warn?.('slack chat.update failed', { err: String(err) });
        }
      },
    },
  });

  const unsubscribe = subscribeTurn(session, turnId, (event) => {
    if (renderer.accept(event)) pump.scheduleEdit();
  });

  try {
    await driveTurn(session, {
      turnId,
      prompt: text,
      ...(model ? { model } : {}),
      signal: controller.signal,
    });
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
