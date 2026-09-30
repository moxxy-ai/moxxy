import type { Bot, Context } from 'grammy';
import type { newTurnId } from '@moxxy/core';
import type { ClientSession as Session } from '@moxxy/sdk';
import { channelTurnContext, driveTurn, subscribeTurn } from '@moxxy/channel-kit';
import type { FramePump } from './frame-pump.js';
import type { TypingIndicator } from './typing-indicator.js';

export interface TurnRunnerLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

export interface TurnRunnerDeps {
  readonly session: Session;
  readonly bot: Bot | null;
  readonly framePump: FramePump;
  readonly typing: TypingIndicator;
  readonly logger?: TurnRunnerLogger;
  /**
   * Sends the FINAL assistant text as a voice note after it has been flushed to
   * the chat (so the text reply always lands first), on a `spoken` turn only.
   * Best-effort — its failure is logged and never breaks the text turn.
   */
  readonly speakReply?: (text: string) => Promise<void>;
}

/** What the model must know about replying on Telegram (see channelTurnContext). */
export const TELEGRAM_TURN_CONTEXT = channelTurnContext({
  service: 'Telegram',
  sendTool: 'telegram_send_message',
  delivery: 'their Telegram chat with the bot',
  uploadLimit: '50 MB per file',
});

/** Added while voice replies are on: the reply goes back as a voice message too. */
export const TELEGRAM_VOICE_CONTEXT =
  'Your reply will also be sent back as a voice message, read ' +
  'aloud: answer briefly, in plain spoken sentences, without markdown, code blocks, tables or links. ' +
  'Speak in the language of the request.';

export interface TurnRunnerOptions {
  readonly chatId: number;
  readonly text: string;
  /** Voice replies are on (`/voice`): the reply is also spoken back. */
  readonly spoken?: boolean;
  readonly model: string | undefined;
  readonly controller: AbortController;
  /** turnId for this turn. The channel mints it so it can also record it as an
   *  own-turn id (mirrorForeignTurn filters on those). */
  readonly turnId: ReturnType<typeof newTurnId>;
}

/**
 * Drive a single user turn end-to-end: kick off typing, subscribe the
 * frame pump to session events, run the turn through `runTurn`, flush
 * the final frame, and unwind state in `finally`.
 *
 * The controller is owned by the caller so /cancel can abort just this
 * turn without poisoning the session-level signal.
 */
export async function runUserTurn(
  ctx: Context,
  deps: TurnRunnerDeps,
  opts: TurnRunnerOptions,
): Promise<void> {
  const { session, bot, framePump, typing, logger, speakReply } = deps;
  const { chatId, text, model, controller, turnId } = opts;

  framePump.beginTurn(chatId);
  // Kick off "typing…" right away so the user gets immediate feedback.
  // Don't send an ellipsis placeholder message — the typing indicator
  // IS the placeholder. The frame pump lazily sends the first real
  // frame when there's content to display, then edits that message for
  // every subsequent frame.
  typing.start(bot, chatId);

  // turnId is minted by the caller (the channel records it as an own-turn id).
  // The frame-pump subscriber filters by it: `session.log` fans out to every
  // listener; without this a concurrent turn driven by another channel
  // (HTTP/runner) on the same Session would render into THIS chat. (AGENTS.md:
  // filter event-log subscribers by turnId.)
  const unsubscribe = subscribeTurn(session, turnId, (event) => {
    const frame = framePump.renderState.accept(event);
    if (frame.hasUpdate) framePump.scheduleEdit();
  });

  try {
    await driveTurn(session, {
      turnId,
      prompt: text,
      model,
      systemPrompt: opts.spoken ? `${TELEGRAM_TURN_CONTEXT}\n\n${TELEGRAM_VOICE_CONTEXT}` : TELEGRAM_TURN_CONTEXT,
      signal: controller.signal,
    });
    await framePump.flush(true);
    // The text reply is now out. Speak the final assistant body if a voice
    // reply is wired — isolated so a synth/transcode/transport failure can
    // never break (or re-report) the already-delivered text turn.
    if (opts.spoken && speakReply) {
      const finalText = framePump.renderState.snapshot().body;
      if (finalText.trim()) {
        try {
          await speakReply(finalText);
        } catch (err) {
          logger?.warn('telegram voice reply hook failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } catch (err) {
    logger?.warn('telegram turn failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    try {
      await ctx.reply(`Turn failed: ${err instanceof Error ? err.message : String(err)}`);
    } catch {
      /* ignore */
    }
  } finally {
    typing.stop();
    unsubscribe();
    framePump.endTurn();
  }
}
