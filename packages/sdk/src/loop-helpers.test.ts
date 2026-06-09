import { describe, expect, it } from 'vitest';
import {
  asEventId,
  asSessionId,
  asTurnId,
  projectMessagesFromLog,
  type EventLogReader,
  type MoxxyEvent,
  type MoxxyEventOfType,
  type MoxxyEventType,
  type TurnId,
} from './index.js';

const sid = asSessionId('s1');
const t1 = asTurnId('t1');
const t2 = asTurnId('t2');

describe('projectMessagesFromLog', () => {
  it('replaces compacted event ranges with the compaction summary', () => {
    const log = reader([
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'old prompt' }),
      event(1, {
        type: 'assistant_message',
        turnId: t1,
        source: 'model',
        content: 'old answer',
        stopReason: 'end_turn',
      }),
      event(2, {
        type: 'compaction',
        turnId: t1,
        source: 'compactor',
        compactor: 'summarize-old-turns',
        replacedRange: [0, 1],
        summary: 'summary of old prompt and answer',
        tokensSaved: 120,
      }),
      event(3, { type: 'user_prompt', turnId: t2, source: 'user', text: 'current prompt' }),
    ]);

    const messages = projectMessagesFromLog({ log });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: expect.stringContaining('summary of old prompt') }],
    });
    expect(messages[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'current prompt' }],
    });
  });

  it('omits the empty text block from a tool-only assistant turn (keeps tool_use + results)', () => {
    // Historical wedged-log shape: end_turn with tool calls and no prose
    // produced an assistant_message with empty content. Providers (Anthropic)
    // reject empty text blocks on the NEXT request — the projection must drop
    // the block so even existing logs become valid again.
    const log = reader([
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'run the tool' }),
      event(1, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: 'call-1',
        name: 'do_thing',
        input: { a: 1 },
      }),
      event(2, {
        type: 'assistant_message',
        turnId: t1,
        source: 'model',
        content: '',
        stopReason: 'end_turn',
      }),
      event(3, {
        type: 'tool_result',
        turnId: t1,
        source: 'tool',
        callId: 'call-1',
        ok: true,
        output: 'done',
      }),
    ]);

    const messages = projectMessagesFromLog({ log });

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool_result']);
    expect(messages[1]!.content).toEqual([
      { type: 'tool_use', id: 'call-1', name: 'do_thing', input: { a: 1 } },
    ]);
    // No empty text block anywhere in the projected conversation.
    for (const m of messages) {
      for (const block of m.content) {
        if (block.type === 'text') expect(block.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('skips a whitespace-only assistant message even without tool calls', () => {
    const log = reader([
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'hi' }),
      event(1, {
        type: 'assistant_message',
        turnId: t1,
        source: 'model',
        content: '  \n',
        stopReason: 'end_turn',
      }),
      event(2, { type: 'user_prompt', turnId: t2, source: 'user', text: 'still there?' }),
    ]);

    const messages = projectMessagesFromLog({ log });

    expect(messages.map((m) => m.role)).toEqual(['user', 'user']);
  });

  it('still projects non-empty assistant messages alongside tool calls', () => {
    const log = reader([
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'run it' }),
      event(1, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: 'call-2',
        name: 'do_thing',
        input: {},
      }),
      event(2, {
        type: 'assistant_message',
        turnId: t1,
        source: 'model',
        content: 'running it now',
        stopReason: 'end_turn',
      }),
      event(3, {
        type: 'tool_result',
        turnId: t1,
        source: 'tool',
        callId: 'call-2',
        ok: true,
        output: 'ok',
      }),
    ]);

    const messages = projectMessagesFromLog({ log });

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant', 'tool_result']);
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'running it now' }],
    });
  });
});

function reader(events: ReadonlyArray<MoxxyEvent>): EventLogReader {
  return {
    length: events.length,
    at: (seq) => events[seq],
    slice: (from = 0, to = events.length) => events.slice(from, to),
    ofType: <T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>> =>
      events.filter((e): e is MoxxyEventOfType<T> => e.type === type),
    byTurn: (turnId: TurnId) => events.filter((e) => e.turnId === turnId),
    toJSON: () => events,
  };
}

function event(
  seq: number,
  partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>,
): MoxxyEvent {
  return {
    id: asEventId(`e${seq}`),
    seq,
    ts: seq,
    sessionId: sid,
    ...partial,
  } as MoxxyEvent;
}
