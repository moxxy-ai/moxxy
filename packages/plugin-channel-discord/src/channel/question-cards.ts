import type { QuestionCard, QuestionUpdate } from '@moxxy/channel-kit';
import { BUTTON_STYLE, button, type ApiActionRow } from './components.js';
import type { ChannelLogger, SendableChannelLike, SentMessageLike } from './discord-like.js';

/** Discord allows 2000 characters a message; a card stays under it. */
const CARD_LIMIT = 1900;

/**
 * Draws the Questions `ChatQuestions` hands over as Discord messages: a card
 * with a row of buttons per question (a picked answer filled, Send green),
 * edited in place as picks change and stripped of its buttons once the
 * question closes.
 */
export class DiscordQuestionCards {
  private readonly messages = new Map<string, SentMessageLike>();

  constructor(
    private readonly deps: {
      /** Where the card goes: the chat the bot last talked in, or the owner's DM. */
      readonly target: () => Promise<SendableChannelLike | null>;
      readonly logger?: ChannelLogger;
    },
  ) {}

  async render(update: QuestionUpdate): Promise<void> {
    try {
      if (update.kind === 'problem') {
        const target = await this.deps.target();
        if (target) await target.send(update.text);
        return;
      }
      const payload = { content: clip(update.card.text), components: rows(update.card) };
      const message = this.messages.get(update.card.questionId);
      if (update.kind === 'show' || !message) {
        const target = await this.deps.target();
        if (!target) return;
        this.messages.set(update.card.questionId, await target.send(payload));
      } else {
        await message.edit(payload);
      }
      if (update.kind === 'closed') this.messages.delete(update.card.questionId);
    } catch (err) {
      this.deps.logger?.warn('discord question card failed', { err: String(err) });
    }
  }
}

function rows(card: QuestionCard): ApiActionRow[] {
  return card.rows.map((row) => ({
    type: 1,
    components: row.map((each) =>
      button(
        each.data,
        each.label,
        each.kind === 'send'
          ? BUTTON_STYLE.success
          : each.chosen
            ? BUTTON_STYLE.primary
            : BUTTON_STYLE.secondary,
      ),
    ),
  }));
}

function clip(text: string): string {
  return text.length > CARD_LIMIT ? `${text.slice(0, CARD_LIMIT - 1)}…` : text;
}
