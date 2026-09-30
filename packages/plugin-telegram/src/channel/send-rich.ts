import { GrammyError } from 'grammy';
import { markdownToTelegramHtml } from '../format.js';
import { splitForTelegram } from '../render.js';
import { stripHtml } from './html.js';

/** The slice of grammy's `Api` a text message needs (the real client satisfies it). */
export interface TelegramSender {
  sendMessage(
    chatId: number,
    text: string,
    opts?: {
      parse_mode?: 'HTML' | 'MarkdownV2' | 'Markdown';
      link_preview_options?: { is_disabled: boolean };
    },
  ): Promise<unknown>;
}

const PARSE_ERROR = /can't parse entities|Bad Request: can't parse/i;

/**
 * Send Markdown with the same rich look as interactive replies (bold, code,
 * callouts, spoilers), split to Telegram's size cap. A part Telegram can't
 * parse (rare) goes out as plain text instead. Returns how many messages went out.
 */
export async function sendMarkdown(api: TelegramSender, chatId: number, markdown: string): Promise<number> {
  const parts = splitForTelegram(markdownToTelegramHtml(markdown));
  for (const part of parts) {
    try {
      await api.sendMessage(chatId, part, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (err) {
      if (!(err instanceof GrammyError && PARSE_ERROR.test(err.description ?? ''))) throw err;
      await api.sendMessage(chatId, stripHtml(part));
    }
  }
  return parts.length;
}
