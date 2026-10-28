import { describe, expect, it } from 'vitest';
import {
  asEventId,
  asSessionId,
  asTurnId,
  type MoxxyEvent,
} from '@moxxy/sdk';
import {
  GPT_LIVE_HISTORY_MAX_ITEMS,
  GPT_LIVE_HISTORY_MAX_ITEM_CHARS,
  buildGptLiveHistory,
} from './gpt-live-history.js';

let seq = 0;
function base(turn: string) {
  seq += 1;
  return {
    id: asEventId(`event-${seq}`),
    seq,
    ts: seq,
    sessionId: asSessionId('session-1'),
    turnId: asTurnId(turn),
  };
}

function prompt(text: string, turn = `turn-${seq}`): MoxxyEvent {
  return { ...base(turn), type: 'user_prompt', source: 'user', text };
}

function reply(content: string, turn = `turn-${seq}`): MoxxyEvent {
  return { ...base(turn), type: 'assistant_message', source: 'model', content, stopReason: 'end_turn' };
}

describe('buildGptLiveHistory', () => {
  it('maps the chat conversation to ordered user and assistant items', () => {
    const history = buildGptLiveHistory([
      prompt('Sekretne słowo to pomarańcza.'),
      { ...base('turn-x'), type: 'tool_result', source: 'tool', callId: 'c1', output: 'ignored' } as unknown as MoxxyEvent,
      reply('Zapamiętałem sekretne słowo.'),
    ]);

    expect(history).toEqual([
      { role: 'user', text: 'Sekretne słowo to pomarańcza.' },
      { role: 'assistant', text: 'Zapamiętałem sekretne słowo.' },
    ]);
  });

  it('skips blank messages and mid-turn checkpoint prompts', () => {
    const checkpoint = {
      ...prompt('Verify your work before finishing.'),
      origin: { kind: 'checkpoint', name: 'verify' },
    } as MoxxyEvent;

    const history = buildGptLiveHistory([prompt('   '), checkpoint, reply('Gotowe.')]);

    expect(history).toEqual([{ role: 'assistant', text: 'Gotowe.' }]);
  });

  it('keeps only the newest items when the conversation exceeds the item limit', () => {
    const events = Array.from({ length: GPT_LIVE_HISTORY_MAX_ITEMS + 10 }, (_, index) =>
      prompt(`wiadomość ${index}`),
    );

    const history = buildGptLiveHistory(events);

    expect(history).toHaveLength(GPT_LIVE_HISTORY_MAX_ITEMS);
    expect(history.at(-1)).toEqual({ role: 'user', text: `wiadomość ${GPT_LIVE_HISTORY_MAX_ITEMS + 9}` });
    expect(history[0]).toEqual({ role: 'user', text: 'wiadomość 10' });
  });

  it('keeps the newest messages that fit the token budget', () => {
    const long = 'x'.repeat(GPT_LIVE_HISTORY_MAX_ITEM_CHARS);
    const events = Array.from({ length: 40 }, (_, index) => prompt(`${index}:${long}`));

    const history = buildGptLiveHistory(events);
    const approxTokens = history.reduce((sum, item) => sum + Math.ceil(item.text.length / 4), 0);

    expect(history.length).toBeLessThan(40);
    expect(approxTokens).toBeLessThanOrEqual(8_192);
    expect(history.at(-1)?.text.startsWith('39:')).toBe(true);
  });

  it('truncates a single oversized message instead of dropping it', () => {
    const history = buildGptLiveHistory([reply('y'.repeat(GPT_LIVE_HISTORY_MAX_ITEM_CHARS * 3))]);

    expect(history).toHaveLength(1);
    expect(history[0]?.text.length).toBeLessThanOrEqual(GPT_LIVE_HISTORY_MAX_ITEM_CHARS);
    expect(history[0]?.text.endsWith('…')).toBe(true);
  });
});
