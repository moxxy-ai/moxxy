import { describe, expect, it } from 'vitest';
import { asTurnId, type MoxxyEvent, type RunTurnOptions } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { Context } from 'grammy';
import { TELEGRAM_TURN_CONTEXT, TELEGRAM_VOICE_CONTEXT, runUserTurn } from './turn-runner.js';

function recordingSession() {
  const runs: RunTurnOptions[] = [];
  const session = {
    log: { subscribe: () => () => undefined },
    runTurn: (_prompt: string, opts: RunTurnOptions) => {
      runs.push(opts);
      return (async function* () {
        yield undefined as unknown as MoxxyEvent;
      })();
    },
  } as unknown as Session;
  return { session, runs };
}

const typing = { start: () => undefined, stop: () => undefined } as never;

function pumpWith(body: string) {
  return {
    beginTurn: () => undefined,
    endTurn: () => undefined,
    scheduleEdit: () => undefined,
    flush: async () => undefined,
    renderState: { accept: () => ({ hasUpdate: false }), snapshot: () => ({ body }) },
  } as never;
}

async function run(opts: { spoken?: boolean } = {}, spoken: string[] = []) {
  const { session, runs } = recordingSession();
  const deps = {
    session,
    bot: null,
    framePump: pumpWith('Cześć!'),
    typing,
    speakReply: async (text: string) => {
      spoken.push(text);
    },
  };
  await runUserTurn({ reply: async () => undefined } as unknown as Context, deps, {
    chatId: 42,
    text: 'hi',
    model: 'a-large',
    controller: new AbortController(),
    turnId: asTurnId('t1'),
    ...opts,
  });
  return runs[0];
}

describe('a Telegram turn tells the model where it replies', () => {
  it('passes the Telegram context with the model the bot runs', async () => {
    const opts = await run();

    expect(opts?.systemPrompt).toBe(TELEGRAM_TURN_CONTEXT);
    expect(opts?.model).toBe('a-large');
    expect(TELEGRAM_TURN_CONTEXT).toContain('`telegram_send_message` with `files:');
  });

  it('asks for a short spoken answer when the prompt was a voice message', async () => {
    const opts = await run({ spoken: true });

    expect(opts?.systemPrompt).toBe(`${TELEGRAM_TURN_CONTEXT}\n\n${TELEGRAM_VOICE_CONTEXT}`);
    expect(TELEGRAM_VOICE_CONTEXT).toMatch(/voice message/);
  });
});

describe('/voice decides whether a Telegram reply is spoken', () => {
  it('sends the reply as a voice note while voice replies are on', async () => {
    const spoken: string[] = [];
    await run({ spoken: true }, spoken);
    expect(spoken).toEqual(['Cześć!']);
  });

  it('answers in text only while voice replies are off, even to a voice message', async () => {
    const spoken: string[] = [];
    await run({}, spoken);
    expect(spoken).toEqual([]);
  });
});
