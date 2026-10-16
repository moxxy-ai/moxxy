import type { QuestionCard, QuestionUpdate } from '@moxxy/channel-kit';
import { truncate } from './html.js';

// Mutable arrays: the shape grammy's `bot.api` takes.
interface InlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/** The two Bot API calls a Question card needs (grammy's `bot.api` has both). */
export interface QuestionCardApi {
  sendMessage(
    chatId: number,
    text: string,
    other?: { readonly reply_markup?: InlineKeyboardMarkup },
  ): Promise<{ readonly message_id: number }>;
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    other?: { readonly reply_markup?: InlineKeyboardMarkup },
  ): Promise<unknown>;
}

/** Telegram allows 4096 characters a message; a card stays well under it. */
const CARD_LIMIT = 3500;

/**
 * Draws the Questions `ChatQuestions` hands over as Telegram messages: a card
 * with an inline keyboard, edited in place as picks change and stripped of
 * its buttons once the question closes.
 */
export class TelegramQuestionCards {
  private readonly messages = new Map<string, number>();

  constructor(
    private readonly deps: {
      readonly api: () => QuestionCardApi | null;
      readonly chatId: () => number | null;
      readonly logger?: { warn(msg: string, meta?: Record<string, unknown>): void };
    },
  ) {}

  async render(update: QuestionUpdate): Promise<void> {
    const api = this.deps.api();
    const chatId = this.deps.chatId();
    if (!api || chatId === null) return;
    try {
      if (update.kind === 'problem') {
        await api.sendMessage(chatId, update.text);
        return;
      }
      const text = truncate(update.card.text, CARD_LIMIT);
      const markup = keyboard(update.card);
      const messageId = this.messages.get(update.card.questionId);
      if (update.kind === 'show' || messageId === undefined) {
        const sent = await api.sendMessage(chatId, text, { reply_markup: markup });
        this.messages.set(update.card.questionId, sent.message_id);
      } else {
        await api.editMessageText(chatId, messageId, text, { reply_markup: markup });
      }
      if (update.kind === 'closed') this.messages.delete(update.card.questionId);
    } catch (err) {
      this.deps.logger?.warn('telegram question card failed', { err: String(err) });
    }
  }
}

function keyboard(card: QuestionCard): InlineKeyboardMarkup {
  return { inline_keyboard: card.rows.map((row) => row.map((button) => ({ text: button.label, callback_data: button.data }))) };
}
