import { describe, expect, it, vi } from 'vitest';
import type { MoxxyEvent, TurnId } from '@moxxy/sdk';
import { ForeignTurnMirror, MirrorTarget } from './mirror.js';
import { TurnCoordinator } from './turn.js';

const id = (s: string) => s as TurnId;
const prompt = (turnId: string, text: string) =>
  ({ type: 'user_prompt', turnId: id(turnId), text }) as unknown as MoxxyEvent;
const reply = (turnId: string, content: string) =>
  ({ type: 'assistant_message', turnId: id(turnId), content }) as unknown as MoxxyEvent;

describe('MirrorTarget (where replies to turns from the app go)', () => {
  it('uses the chat the owner last wrote from', async () => {
    const openOwnerChat = vi.fn(async () => 'owner-dm');
    const target = new MirrorTarget(openOwnerChat);
    target.remember('group-thread');

    expect(await target.resolve()).toBe('group-thread');
    expect(openOwnerChat).not.toHaveBeenCalled();
  });

  it("falls back to the paired owner's chat before anyone wrote since the bot started", async () => {
    const openOwnerChat = vi.fn(async () => 'owner-dm');
    const target = new MirrorTarget(openOwnerChat);

    expect(await target.resolve()).toBe('owner-dm');
    expect(await target.resolve()).toBe('owner-dm');
    expect(openOwnerChat).toHaveBeenCalledTimes(1);
  });

  it('has nowhere to post while the bot is not paired', async () => {
    const target = new MirrorTarget(async () => null);
    expect(await target.resolve()).toBeNull();
  });
});

function mirrorWith(turns = new TurnCoordinator()) {
  const posted: Array<{ target: string; text: string }> = [];
  const said: string[] = [];
  const mirror = new ForeignTurnMirror<string>({
    turns,
    target: new MirrorTarget(async () => 'owner-dm'),
    post: async (target, text) => {
      posted.push({ target, text });
    },
    formatPrompt: (text) => `typed in moxxy: ${text}`,
    onReply: (text) => said.push(text),
  });
  return { mirror, posted, said, turns };
}

describe('ForeignTurnMirror (a message written in the app shows on the channel)', () => {
  it("posts the app's prompt and then its reply to the owner's chat, in order", async () => {
    const { mirror, posted } = mirrorWith();

    mirror.accept(prompt('t1', 'what is the weather?'));
    mirror.accept(reply('t1', 'Sunny.'));
    await mirror.idle();

    expect(posted).toEqual([
      { target: 'owner-dm', text: 'typed in moxxy: what is the weather?' },
      { target: 'owner-dm', text: 'Sunny.' },
    ]);
  });

  it("skips the channel's own turns — they already render there", async () => {
    const turns = new TurnCoordinator();
    const { mirror, posted } = mirrorWith(turns);
    turns.begin(id('mine'))?.end();

    mirror.accept(prompt('mine', 'hi'));
    mirror.accept(reply('mine', 'hello'));
    await mirror.idle();

    expect(posted).toEqual([]);
  });

  it('hands each mirrored reply to onReply (a call says it aloud)', async () => {
    const { mirror, said } = mirrorWith();

    mirror.accept(prompt('t1', 'hi'));
    mirror.accept(reply('t1', 'hello'));
    await mirror.idle();

    expect(said).toEqual(['hello']);
  });

  it('keeps going after a failed post and reports it', async () => {
    const onError = vi.fn();
    const posted: string[] = [];
    const mirror = new ForeignTurnMirror<string>({
      turns: new TurnCoordinator(),
      target: new MirrorTarget(async () => 'owner-dm'),
      post: async (_target, text) => {
        if (text === 'boom') throw new Error('network');
        posted.push(text);
      },
      formatPrompt: (text) => text,
      onError,
    });

    mirror.accept(reply('t1', 'boom'));
    mirror.accept(reply('t2', 'after'));
    await mirror.idle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(posted).toEqual(['after']);
  });

  it('posts nothing while the bot has nowhere to post', async () => {
    const post = vi.fn(async () => undefined);
    const mirror = new ForeignTurnMirror<string>({
      turns: new TurnCoordinator(),
      target: new MirrorTarget(async () => null),
      post,
      formatPrompt: (text) => text,
    });

    mirror.accept(reply('t1', 'hello'));
    await mirror.idle();

    expect(post).not.toHaveBeenCalled();
  });
});
