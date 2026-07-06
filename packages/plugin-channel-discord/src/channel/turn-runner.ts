import type { newTurnId } from '@moxxy/core';
import { assertDefined, type ClientSession as Session } from '@moxxy/sdk';
import { FramePump, driveTurn, subscribeTurn } from '@moxxy/channel-kit';
import { DiscordTurnRenderer, splitForDiscord } from '../render.js';
import type { ChannelLogger, SendableChannelLike, SentMessageLike } from './discord-like.js';
import type { TypingIndicator } from './typing-indicator.js';

/**
 * Discord's per-channel edit budget is ~5 edits / 5s; the streaming edit
 * throttle must stay at or above 1200ms so a long turn never trips the rate
 * limiter (which would delay-queue frames and lag the stream).
 */
export const MIN_EDIT_FRAME_MS = 1_200;
export const DEFAULT_EDIT_FRAME_MS = 1_500;

/** Clamp a configured editFrameMs to the Discord-safe floor. */
export function clampEditFrameMs(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return DEFAULT_EDIT_FRAME_MS;
  return Math.max(MIN_EDIT_FRAME_MS, requested);
}

export interface RunDiscordTurnDeps {
  readonly session: Session;
  readonly channel: SendableChannelLike;
  readonly typing: TypingIndicator;
  readonly editFrameMs: number;
  readonly logger?: ChannelLogger;
  /**
   * Called once with the FINAL assistant text after it has been flushed to the
   * channel (so the text reply always lands first). Backs the optional voice
   * reply. Best-effort — its failure is logged and never breaks the text turn.
   */
  readonly onFinalReply?: (text: string) => Promise<void>;
}

export interface RunDiscordTurnOptions {
  readonly text: string;
  readonly model?: string | undefined;
  readonly controller: AbortController;
  /** Pre-minted turn id; the channel records it as an own-turn id. */
  readonly turnId: ReturnType<typeof newTurnId>;
}

/**
 * Drive a single Discord turn end-to-end: start typing, subscribe the frame
 * pump to THIS turn's events (filtered by turnId — `session.log` fans out to
 * every listener, so a concurrent turn on the same Session would otherwise
 * stream into this channel, AGENTS.md invariant #8), run the turn, flush the
 * final frame, unwind in `finally`.
 *
 * The streaming loop is `@moxxy/channel-kit`'s {@link FramePump} ("send once,
 * then edit that message", throttled to `editFrameMs`) over a
 * {@link DiscordTurnRenderer} snapshot. Delivery handles the 2000-char cap:
 * mid-stream frames edit only the first split part; the FINAL frame sends the
 * overflow tail parts as follow-up messages (`alwaysFlushFinal` so the sink's
 * final-only work is never skipped).
 */
export async function runDiscordTurn(
  deps: RunDiscordTurnDeps,
  opts: RunDiscordTurnOptions,
): Promise<void> {
  const { session, channel, typing, editFrameMs, logger, onFinalReply } = deps;
  const { text, model, controller, turnId } = opts;

  const renderer = new DiscordTurnRenderer();
  const sendPart = async (part: string): Promise<SentMessageLike | null> => {
    try {
      return await channel.send(part);
    } catch (err) {
      logger?.warn('discord send failed', { err: String(err) });
      return null;
    }
  };
  const pump = new FramePump<SentMessageLike>({
    editFrameMs,
    frame: () => renderer.snapshot(),
    // Guarantee at least one message even when the turn produced no text.
    emptyFinalText: '*(no output)*',
    // The sink does final-only work (split-overflow tails), so the final frame
    // must reach it even when the text didn't change since the last edit.
    alwaysFlushFinal: true,
    sink: {
      send: async (t, final) => {
        const parts = splitForDiscord(t);
        const head = parts[0];
        assertDefined(head, 'discord: FramePump never sinks empty text (emptyFinalText guarantees a part)');
        const sent = await sendPart(head);
        if (final) for (const tail of parts.slice(1)) await sendPart(tail);
        return sent;
      },
      edit: async (message, t, final) => {
        const parts = splitForDiscord(t);
        const head = parts[0];
        assertDefined(head, 'discord: FramePump never sinks empty text (emptyFinalText guarantees a part)');
        try {
          await message.edit(head);
        } catch (err) {
          logger?.warn('discord edit failed', { err: String(err) });
        }
        if (final) for (const tail of parts.slice(1)) await sendPart(tail);
      },
    },
  });

  typing.start(channel);
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
    // The text reply is now out. Speak the final assistant body if a voice
    // reply is wired — isolated so a synth/transcode/transport failure can
    // never break (or re-report) the already-delivered text turn.
    if (onFinalReply) {
      const finalText = renderer.finalText();
      if (finalText) {
        try {
          await onFinalReply(finalText);
        } catch (err) {
          logger?.warn('discord voice reply hook failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } catch (err) {
    logger?.warn('discord turn failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    await sendPart(`Turn failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    typing.stop();
    unsubscribe();
    pump.dispose();
  }
}
