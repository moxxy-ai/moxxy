import { describe, expect, it, vi } from 'vitest';
import { AGENT_CONNECTION_PLUGIN_ID, AGENT_NO_REPLY_SUBTYPE, type MoxxyEvent, type TurnId } from '@moxxy/sdk';
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
    formatAgentTurn: (name) => `agent continued: ${name}`,
    onReply: (text) => said.push(text),
  });
  return { mirror, posted, said, turns };
}

const agentTurn = (turnId: string, name: string) =>
  ({ type: 'user_prompt', turnId: id(turnId), text: name, origin: { kind: 'agent', name } }) as unknown as MoxxyEvent;
const noReply = (turnId: string) =>
  ({ type: 'plugin_event', turnId: id(turnId), pluginId: AGENT_CONNECTION_PLUGIN_ID, subtype: AGENT_NO_REPLY_SUBTYPE, payload: {} }) as unknown as MoxxyEvent;
const subagentDone = (turnId: string, text: string) =>
  ({ type: 'plugin_event', turnId: id(turnId), pluginId: '@moxxy/subagents', subtype: 'subagent_completed', payload: { childSessionId: 'c1', text } }) as unknown as MoxxyEvent;

describe('ForeignTurnMirror (a turn the agent took up by itself shows on the channel)', () => {
  it('says what the agent took up, then what its background helper answered and what it said', async () => {
    const { mirror, posted } = mirrorWith();

    mirror.accept(agentTurn('a1', 'check later finished in the background'));
    mirror.accept(subagentDone('a1', 'DONE-7'));
    mirror.accept(reply('a1', 'The helper is done.'));
    await mirror.idle();

    expect(posted.map((p) => p.text)).toEqual(['agent continued: check later finished in the background', 'DONE-7', 'The helper is done.']);
  });

  it('says the agent finished without replying when its turn showed nothing, and does not read the note aloud', async () => {
    const { mirror, posted, said } = mirrorWith();

    mirror.accept(agentTurn('a1', 'A command Codex left running finished'));
    mirror.accept(noReply('a1'));
    await mirror.idle();

    expect(posted.map((p) => p.text)).toEqual(['agent continued: A command Codex left running finished', 'The agent finished without replying.']);
    expect(said).toEqual([]);
  });

  it("leaves a helper's answer in a turn the person started to the reply that uses it", async () => {
    const { mirror, posted } = mirrorWith();

    mirror.accept(prompt('t1', 'hi'));
    mirror.accept(subagentDone('t1', 'DONE-7'));
    await mirror.idle();

    expect(posted.map((p) => p.text)).toEqual(['typed in moxxy: hi']);
  });
});

describe('TurnCoordinator.mirrorReply (channels that mirror replies only)', () => {
  it('says what the agent took up by itself, then its helper and its reply', () => {
    const turns = new TurnCoordinator();

    expect([agentTurn('a1', 'A command Codex left running finished'), subagentDone('a1', 'DONE-7'), reply('a1', 'Done.')].map((e) => turns.mirrorReply(e))).toEqual([
      'Agent continued: A command Codex left running finished',
      'DONE-7',
      'Done.',
    ]);
  });

  it('says the agent finished without replying, only in a turn it took up by itself', () => {
    const turns = new TurnCoordinator();

    expect([agentTurn('a1', 'Task finished'), noReply('a1'), noReply('t9')].map((e) => turns.mirrorReply(e))).toEqual([
      'Agent continued: Task finished',
      'The agent finished without replying.',
      null,
    ]);
  });
});

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
      formatAgentTurn: (name) => name,
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
      formatAgentTurn: (name) => name,
    });

    mirror.accept(reply('t1', 'hello'));
    await mirror.idle();

    expect(post).not.toHaveBeenCalled();
  });
});
