import type { Bot } from 'grammy';
import { GrammyError } from 'grammy';
import { FramePump as StreamPump } from '@moxxy/channel-kit';
import { TurnRenderer, splitForTelegram } from '../render.js';
import { composeFrame, stripHtml } from './html.js';

export interface FramePumpLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

export interface FramePumpOptions {
  readonly editFrameMs: number;
  readonly logger?: FramePumpLogger;
}

/**
 * Drives the throttled "compose snapshot → send/edit one message" loop
 * for a turn. Owns the renderer and the Telegram-specific delivery —
 * HTML parse-mode fallback + 4096-char message splitting — while the
 * throttle/send-once-then-edit mechanics live in `@moxxy/channel-kit`'s
 * {@link StreamPump} (one instance per turn).
 *
 * Lifecycle per turn:
 *   1. `beginTurn(chatId)` resets state.
 *   2. Renderer updates schedule edits via `scheduleEdit()`.
 *   3. `flush(final)` drains the latest snapshot to Telegram.
 *   4. `endTurn()` clears timers + chat binding.
 */
export class FramePump {
  private readonly editFrameMs: number;
  private readonly logger?: FramePumpLogger;
  private bot: Bot | null = null;
  private renderer: TurnRenderer = new TurnRenderer();
  private pump: StreamPump<number> | null = null;

  constructor(opts: FramePumpOptions) {
    this.editFrameMs = opts.editFrameMs;
    if (opts.logger) this.logger = opts.logger;
  }

  attachBot(bot: Bot | null): void {
    this.bot = bot;
  }

  /** Renderer the channel feeds events into. Owned here so reset/snapshot
   *  cycles stay coordinated with the message-id state. */
  get renderState(): TurnRenderer {
    return this.renderer;
  }

  resetRenderer(): void {
    this.renderer.reset();
  }

  beginTurn(chatId: number): void {
    this.renderer.reset();
    this.pump = new StreamPump<number>({
      editFrameMs: this.editFrameMs,
      // Only the FINAL frame collapses the activity trace into its expandable
      // box — mid-stream frames keep it open so the user watches work land live.
      frame: (final) => composeFrame(this.renderer.snapshot({ collapse: final })),
      // The final flush must produce at least one message so the user isn't
      // left with the typing indicator dangling.
      emptyFinalText: '<i>(no output)</i>',
      // The sink does final-only work (split-overflow tails below), so the
      // final frame must reach it even when the text didn't change since the
      // last streamed edit.
      alwaysFlushFinal: true,
      sink: {
        send: (text, final) => this.sendFrame(chatId, text, final),
        edit: (messageId, text, final) => this.editFrame(chatId, messageId, text, final),
      },
    });
  }

  endTurn(): void {
    this.pump?.dispose();
    this.pump = null;
  }

  scheduleEdit(): void {
    this.pump?.scheduleEdit();
  }

  async flush(final: boolean): Promise<void> {
    if (!this.bot || !this.pump) return;
    await this.pump.flush(final);
  }

  /** First real content of this turn — send (don't edit a placeholder). On the
   *  final frame, overflow beyond Telegram's message limit goes out as
   *  follow-up messages. */
  private async sendFrame(chatId: number, text: string, final: boolean): Promise<number | null> {
    if (!this.bot) return null;
    const parts = splitForTelegram(text);
    const sent = await this.safeSend(chatId, parts[0]!);
    if (final && parts.length > 1) {
      for (const tail of parts.slice(1)) {
        await this.safeSend(chatId, tail);
      }
    }
    return sent;
  }

  private async editFrame(
    chatId: number,
    messageId: number,
    text: string,
    final: boolean,
  ): Promise<void> {
    if (!this.bot) return;
    const parts = splitForTelegram(text);
    await this.safeEdit(chatId, messageId, parts[0]!);
    if (final && parts.length > 1) {
      for (const tail of parts.slice(1)) {
        await this.safeSend(chatId, tail);
      }
    }
  }

  /**
   * `text` is already Telegram-flavored HTML (produced by
   * `composeFrame`). Try HTML; on parse-entity errors, strip tags and
   * send plain text so the message still lands instead of looping on
   * the same edit forever.
   */
  async safeEdit(chatId: number, messageId: number, text: string): Promise<void> {
    try {
      await this.bot!.api.editMessageText(chatId, messageId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      return;
    } catch (err) {
      if (err instanceof GrammyError && err.description?.includes('not modified')) return;
      if (err instanceof GrammyError && /can't parse entities|Bad Request: can't parse/i.test(err.description ?? '')) {
        try {
          await this.bot!.api.editMessageText(chatId, messageId, stripHtml(text));
          return;
        } catch (plainErr) {
          if (plainErr instanceof GrammyError && plainErr.description?.includes('not modified')) return;
          this.logger?.warn('editMessageText plain-fallback failed', { err: String(plainErr) });
          return;
        }
      }
      this.logger?.warn('editMessageText failed', { err: String(err) });
    }
  }

  /**
   * Send a new message (first frame of a turn or split-tail).
   * Returns the new message_id on success so callers can set
   * messageId for future edits.
   */
  async safeSend(chatId: number, text: string): Promise<number | null> {
    try {
      const sent = await this.bot!.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      return sent.message_id;
    } catch (err) {
      if (err instanceof GrammyError && /can't parse entities|Bad Request: can't parse/i.test(err.description ?? '')) {
        try {
          const sent = await this.bot!.api.sendMessage(chatId, stripHtml(text));
          return sent.message_id;
        } catch (plainErr) {
          this.logger?.warn('sendMessage plain-fallback failed', { err: String(plainErr) });
          return null;
        }
      }
      this.logger?.warn('sendMessage failed', { err: String(err) });
      return null;
    }
  }
}
