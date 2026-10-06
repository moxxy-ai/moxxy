import { describe, expect, it } from 'vitest';
import { TurnCoordinator } from '@moxxy/channel-kit';
import type { MoxxyEvent, TurnId } from '@moxxy/sdk';
import { createTelegramMirror, type TelegramSender } from './mirror.js';

const prompt = (turnId: string, text: string) =>
  ({ type: 'user_prompt', turnId: turnId as TurnId, text }) as unknown as MoxxyEvent;
const reply = (turnId: string, content: string) =>
  ({ type: 'assistant_message', turnId: turnId as TurnId, content }) as unknown as MoxxyEvent;

function api() {
  const sent: Array<{ chatId: number; text: string; parseMode?: string }> = [];
  const sender: TelegramSender = {
    sendMessage: async (chatId, text, opts) => {
      sent.push({ chatId, text, ...(opts?.parse_mode ? { parseMode: opts.parse_mode } : {}) });
      return undefined;
    },
  };
  return { sent, sender };
}

describe('a message written in the app shows in the Telegram chat', () => {
  it("posts the app's prompt and its reply to the paired chat, formatted like the bot's replies", async () => {
    const { sent, sender } = api();
    const { mirror } = createTelegramMirror({ turns: new TurnCoordinator(), api: () => sender, pairedChat: () => 42 });

    mirror.accept(prompt('t1', 'what is on my calendar?'));
    mirror.accept(reply('t1', 'Two **meetings**.'));
    await mirror.idle();

    expect(sent).toEqual([
      { chatId: 42, text: '<i>typed in moxxy:</i> what is on my calendar?', parseMode: 'HTML' },
      { chatId: 42, text: 'Two <b>meetings</b>.', parseMode: 'HTML' },
    ]);
  });

  it('goes to the chat the owner last wrote from', async () => {
    const { sent, sender } = api();
    const { mirror, target } = createTelegramMirror({ turns: new TurnCoordinator(), api: () => sender, pairedChat: () => 42 });
    target.remember(7);

    mirror.accept(reply('t1', 'hello'));
    await mirror.idle();

    expect(sent.map((m) => m.chatId)).toEqual([7]);
  });

  it('stays quiet while no chat is paired or the bot is not running', async () => {
    const { sent, sender } = api();
    const unpaired = createTelegramMirror({ turns: new TurnCoordinator(), api: () => sender, pairedChat: () => null });
    const stopped = createTelegramMirror({ turns: new TurnCoordinator(), api: () => null, pairedChat: () => 42 });

    unpaired.mirror.accept(reply('t1', 'hello'));
    stopped.mirror.accept(reply('t2', 'hello'));
    await Promise.all([unpaired.mirror.idle(), stopped.mirror.idle()]);

    expect(sent).toEqual([]);
  });
});
