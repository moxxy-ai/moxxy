/**
 * Question cards in Telegram: a card goes out with an inline keyboard, picks
 * edit it in place, and a closed question loses its buttons. The Bot API is
 * the boundary, so it is the one thing faked here.
 */
import { describe, expect, it } from 'vitest';
import type { QuestionCard } from '@moxxy/channel-kit';
import { TelegramQuestionCards, type QuestionCardApi } from './question-cards.js';

function fakeApi() {
  const calls: Array<{ method: string; chatId: number; messageId?: number; text: string; keyboard: unknown }> = [];
  const api: QuestionCardApi = {
    sendMessage: async (chatId, text, other) => {
      calls.push({ method: 'send', chatId, text, keyboard: other?.reply_markup?.inline_keyboard });
      return { message_id: 41 + calls.length };
    },
    editMessageText: async (chatId, messageId, text, other) => {
      calls.push({ method: 'edit', chatId, messageId, text, keyboard: other?.reply_markup?.inline_keyboard });
      return true;
    },
  };
  return { api, calls };
}

const card = (text: string, rows: QuestionCard['rows']): QuestionCard => ({ questionId: 'qa', text, rows });
const red = { kind: 'answer' as const, label: 'Red', data: 'q:qa:0:0', chosen: false };

describe('TelegramQuestionCards', () => {
  it('sends a new card with its buttons, edits it on a pick and drops the buttons once it closes', async () => {
    const { api, calls } = fakeApi();
    const cards = new TelegramQuestionCards({ api: () => api, chatId: () => 7 });

    await cards.render({ kind: 'show', card: card('❓ Question', [[red]]) });
    await cards.render({ kind: 'refresh', card: card('❓ Question', [[{ ...red, label: '✓ Red', chosen: true }]]) });
    await cards.render({ kind: 'closed', card: card('✓ Answered: Red', []) });

    expect(calls).toEqual([
      { method: 'send', chatId: 7, text: '❓ Question', keyboard: [[{ text: 'Red', callback_data: 'q:qa:0:0' }]] },
      { method: 'edit', chatId: 7, messageId: 42, text: '❓ Question', keyboard: [[{ text: '✓ Red', callback_data: 'q:qa:0:0' }]] },
      { method: 'edit', chatId: 7, messageId: 42, text: '✓ Answered: Red', keyboard: [] },
    ]);
  });

  it('says why a reply did not go out in a message of its own', async () => {
    const { api, calls } = fakeApi();
    const cards = new TelegramQuestionCards({ api: () => api, chatId: () => 7 });

    await cards.render({ kind: 'problem', text: 'This question is no longer open.' });

    expect(calls).toEqual([{ method: 'send', chatId: 7, text: 'This question is no longer open.', keyboard: undefined }]);
  });

  it('draws nothing before a chat is paired', async () => {
    const { api, calls } = fakeApi();
    const cards = new TelegramQuestionCards({ api: () => api, chatId: () => null });

    await cards.render({ kind: 'show', card: card('❓ Question', [[red]]) });

    expect(calls).toEqual([]);
  });
});
