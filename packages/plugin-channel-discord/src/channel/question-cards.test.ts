/**
 * Question cards in Discord: a card goes out with a row of buttons per
 * question, picks edit it in place, and a closed question loses its buttons.
 * The Discord channel is the boundary, so it is the one thing faked here.
 */
import { describe, expect, it } from 'vitest';
import type { QuestionCard } from '@moxxy/channel-kit';
import type { OutboundPayload, SendableChannelLike } from './discord-like.js';
import { DiscordQuestionCards } from './question-cards.js';

function fakeChannel() {
  const sent: Array<string | OutboundPayload> = [];
  const edits: Array<string | OutboundPayload> = [];
  const channel: SendableChannelLike = {
    send: async (payload) => {
      sent.push(payload);
      return { edit: async (next: string | OutboundPayload) => edits.push(next) };
    },
  };
  return { channel, sent, edits };
}

const card = (text: string, rows: QuestionCard['rows']): QuestionCard => ({ questionId: 'qa', text, rows });
const red = { kind: 'answer' as const, label: 'Red', data: 'q:qa:0:0', chosen: false };
const send = { kind: 'send' as const, label: 'Send', data: 'q:qa:send', chosen: false };

describe('DiscordQuestionCards', () => {
  it('sends a card with its buttons, marks a pick in place and drops the buttons once it closes', async () => {
    const { channel, sent, edits } = fakeChannel();
    const cards = new DiscordQuestionCards({ target: async () => channel });

    await cards.render({ kind: 'show', card: card('❓ Question', [[red], [send]]) });
    await cards.render({ kind: 'refresh', card: card('❓ Question', [[{ ...red, label: '✓ Red', chosen: true }], [send]]) });
    await cards.render({ kind: 'closed', card: card('✓ Answered: Red', []) });

    expect(sent).toEqual([
      {
        content: '❓ Question',
        components: [
          { type: 1, components: [{ type: 2, style: 2, label: 'Red', custom_id: 'q:qa:0:0' }] },
          { type: 1, components: [{ type: 2, style: 3, label: 'Send', custom_id: 'q:qa:send' }] },
        ],
      },
    ]);
    expect(edits).toEqual([
      {
        content: '❓ Question',
        components: [
          { type: 1, components: [{ type: 2, style: 1, label: '✓ Red', custom_id: 'q:qa:0:0' }] },
          { type: 1, components: [{ type: 2, style: 3, label: 'Send', custom_id: 'q:qa:send' }] },
        ],
      },
      { content: '✓ Answered: Red', components: [] },
    ]);
  });

  it('says why a reply did not go out in a message of its own', async () => {
    const { channel, sent } = fakeChannel();
    const cards = new DiscordQuestionCards({ target: async () => channel });

    await cards.render({ kind: 'problem', text: 'This question is no longer open.' });

    expect(sent).toEqual(['This question is no longer open.']);
  });

  it('draws nothing while there is nowhere to post', async () => {
    const cards = new DiscordQuestionCards({ target: async () => null });

    await expect(cards.render({ kind: 'show', card: card('❓ Question', [[red]]) })).resolves.toBeUndefined();
  });
});
