import { describe, expect, it } from 'vitest';
import type { Bot, Context } from 'grammy';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { publishBotCommands, runSlash, type SlashCallbacks } from './slash-handler.js';

const session = () => new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });

async function send(text: string, over: Partial<SlashCallbacks> = {}) {
  const replies: string[] = [];
  const ctx = { reply: async (t: string) => void replies.push(t) } as unknown as Context;
  await runSlash(ctx, text, { session: session(), voiceReplies: false }, {
    toggleYolo: async () => true,
    setVoiceReplies: async () => undefined,
    model: { run: async () => '', choices: async () => ({ current: null, options: [] }) },
    performSessionAction: async () => undefined,
    ...over,
  });
  return replies;
}

describe('/auto-approve on Telegram', () => {
  it.each(['/auto-approve', '/auto_approve', '/yolo'])('%s switches the shared auto-approve', async (command) => {
    let toggled = 0;
    const replies = await send(command, {
      toggleYolo: async () => {
        toggled += 1;
        return true;
      },
    });

    expect(toggled).toBe(1);
    expect(replies[0]).toMatch(/auto-approve ON/);
  });

  it('says tool prompts resume when it is switched off', async () => {
    const replies = await send('/auto-approve', { toggleYolo: async () => false });
    expect(replies[0]).toMatch(/auto-approve OFF/);
  });
});

describe('/call on Telegram', () => {
  it('explains that Telegram bots cannot call, and offers a voice message instead', async () => {
    const [reply] = await send('/call');
    expect(reply).toMatch(/Telegram does not let bots/);
    expect(reply).toMatch(/voice message/);
  });
});

describe('the command menu Telegram shows', () => {
  it('lists /auto_approve (Telegram command names take no hyphen) and /call, not the /yolo alias', async () => {
    let published: Array<{ command: string }> = [];
    const bot = {
      api: {
        setMyCommands: async (commands: Array<{ command: string }>) => {
          published = commands;
          return true;
        },
      },
    } as unknown as Bot;

    await publishBotCommands(bot, session());

    const names = published.map((c) => c.command);
    expect(names).toEqual(expect.arrayContaining(['auto_approve', 'call', 'model', 'voice']));
    expect(names).not.toContain('yolo');
    expect(names.every((n) => /^[a-z0-9_]{1,32}$/.test(n))).toBe(true);
  });
});
