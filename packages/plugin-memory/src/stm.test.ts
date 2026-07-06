import { describe, expect, it } from 'vitest';
import { asPluginId, asSessionId, asToolCallId, asTurnId, assertDefined, type MoxxyEvent } from '@moxxy/sdk';
import { recentExchanges, summarizeSession } from './stm.js';

const sid = asSessionId('s');
const tid = asTurnId('t');
const c1 = asToolCallId('c1');
const p1 = asPluginId('p1');

const stubLog = (events: MoxxyEvent[]) => ({
  length: events.length,
  at: (n: number) => events[n],
  slice: () => events.slice(),
  ofType: <T extends MoxxyEvent['type']>(type: T) =>
    events.filter((e): e is Extract<MoxxyEvent, { type: T }> => e.type === type),
  byTurn: () => events.slice(),
  toJSON: () => events.slice(),
});

const ev = (e: Partial<MoxxyEvent> & Pick<MoxxyEvent, 'type'>, seq: number): MoxxyEvent =>
  ({
    sessionId: sid,
    turnId: tid,
    source: 'system',
    id: `e${seq}` as never,
    seq,
    ts: 0,
    ...e,
  }) as MoxxyEvent;

describe('recentExchanges', () => {
  it('returns the most recent N user+assistant messages', () => {
    const log = stubLog([
      ev({ type: 'user_prompt', text: 'hi', source: 'user' }, 0),
      ev({ type: 'assistant_message', content: 'hello', stopReason: 'end_turn', source: 'model' }, 1),
      ev({ type: 'user_prompt', text: 'next', source: 'user' }, 2),
    ]);
    const recent = recentExchanges(log, 2);
    expect(recent.map((r) => r.source)).toEqual(['assistant', 'user']);
    const second = recent[1];
    assertDefined(second, 'recentExchanges returns two exchanges');
    expect(second.text).toBe('next');
  });

  it('ignores non-message events', () => {
    const log = stubLog([
      ev({ type: 'user_prompt', text: 'a', source: 'user' }, 0),
      ev({ type: 'tool_call_requested', callId: c1, name: 'X', input: {}, source: 'model' }, 1),
      ev({ type: 'assistant_message', content: 'done', stopReason: 'end_turn', source: 'model' }, 2),
    ]);
    expect(recentExchanges(log).map((r) => r.source)).toEqual(['user', 'assistant']);
  });
});

describe('summarizeSession', () => {
  it('counts turns, tool calls, errors, skills, plugins', () => {
    const log = stubLog([
      ev({ type: 'user_prompt', text: '', source: 'user' }, 0),
      ev({ type: 'tool_call_requested', callId: c1, name: 'X', input: {}, source: 'model' }, 1),
      ev({ type: 'error', kind: 'fatal', message: '!', source: 'system' }, 2),
      ev({ type: 'plugin_registered', pluginId: p1, name: 'p', version: '1', kind: ['tools'], source: 'system' }, 3),
    ]);
    expect(summarizeSession(log)).toEqual({
      turns: 1,
      toolCalls: 1,
      errors: 1,
      skillsCreated: 0,
      pluginsLoaded: 1,
    });
  });
});
