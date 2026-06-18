import { describe, expect, it } from 'vitest';
import {
  asEventId,
  asSessionId,
  asToolCallId,
  asTurnId,
  type EventLogReader,
  type MoxxyEvent,
  type MoxxyEventOfType,
  type MoxxyEventType,
  type ToolContext,
  type TurnId,
} from '@moxxy/sdk';
import { recallTool } from './recall.js';

const sid = asSessionId('s');
const t1 = asTurnId('t1');

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

function ev(seq: number, partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>): MoxxyEvent {
  return { id: asEventId(`e${seq}`), seq, ts: seq, sessionId: sid, ...partial } as MoxxyEvent;
}

const ctx = (events: MoxxyEvent[], callId = 'cur'): ToolContext => ({
  sessionId: sid,
  turnId: t1,
  callId: asToolCallId(callId),
  cwd: '/tmp',
  signal: new AbortController().signal,
  log: reader(events),
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});

describe('recall tool', () => {
  const toolResult = ev(1, {
    type: 'tool_result',
    turnId: t1,
    source: 'tool',
    callId: asToolCallId('c1'),
    ok: true,
    output: 'the full file contents',
  });

  it('returns the full content for a callId', () => {
    const out = recallTool.handler({ callId: 'c1' }, ctx([toolResult])) as string;
    expect(out).toBe('the full file contents');
  });

  it('returns a pointer instead of re-injecting on a repeat recall (idempotency belt)', () => {
    const events = [
      toolResult,
      // a prior recall of the same target, recent
      ev(2, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: asToolCallId('prev'),
        name: 'recall',
        input: { callId: 'c1' },
      }),
      // the current recall call (its own event in the log)
      ev(3, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: asToolCallId('cur'),
        name: 'recall',
        input: { callId: 'c1' },
      }),
    ];
    const out = recallTool.handler({ callId: 'c1' }, ctx(events, 'cur')) as string;
    expect(out).toMatch(/already recalled/);
    expect(out).not.toContain('the full file contents');
  });

  it('throws for an unknown callId', () => {
    expect(() => recallTool.handler({ callId: 'nope' }, ctx([toolResult]))).toThrow(/no event/);
  });

  it('recalls by seq, rendering the event text', () => {
    const events = [
      ev(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'hello' }),
      ev(1, { type: 'assistant_message', turnId: t1, source: 'model', content: 'hi there' }),
    ];
    expect(recallTool.handler({ seq: 0 }, ctx(events)) as string).toBe('[user] hello');
    expect(recallTool.handler({ seq: 1 }, ctx(events)) as string).toBe('[assistant] hi there');
  });

  it('throws when no event exists at the given seq', () => {
    expect(() => recallTool.handler({ seq: 9 }, ctx([toolResult]))).toThrow(/no event at seq 9/);
  });

  it('throws when the event at seq has no recallable content', () => {
    const events = [ev(0, { type: 'turn_started', turnId: t1, source: 'system' } as never)];
    expect(() => recallTool.handler({ seq: 0 }, ctx(events))).toThrow(/no recallable content/);
  });

  it('recalls a whole turn, joining all renderable events', () => {
    const events = [
      ev(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'do it' }),
      ev(1, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: asToolCallId('c9'),
        name: 'read',
        input: { path: '/a' },
      }),
      ev(2, {
        type: 'tool_result',
        turnId: t1,
        source: 'tool',
        callId: asToolCallId('c9'),
        ok: true,
        output: 'contents',
      }),
      ev(3, { type: 'assistant_message', turnId: t1, source: 'model', content: 'done' }),
    ];
    const out = recallTool.handler({ turnId: 't1' }, ctx(events)) as string;
    expect(out).toBe(
      ['[user] do it', '[tool_use read] {"path":"/a"}', '[tool_result ok] contents', '[assistant] done'].join(
        '\n\n',
      ),
    );
  });

  it('throws when a turn has no recallable content', () => {
    expect(() => recallTool.handler({ turnId: 'tX' }, ctx([toolResult]))).toThrow(
      /no recallable content for turn/,
    );
  });

  it('throws when no addressing argument is provided', () => {
    expect(() => recallTool.handler({}, ctx([toolResult]))).toThrow(/provide one of/);
  });

  it('summarize truncates content longer than the summary cap', () => {
    const big = 'x'.repeat(5_000);
    const events = [ev(0, { type: 'assistant_message', turnId: t1, source: 'model', content: big })];
    const out = recallTool.handler({ seq: 0, summarize: true }, ctx(events)) as string;
    expect(out).toMatch(/more chars — call recall again without summarize/);
    expect(out.length).toBeLessThan(big.length);
  });
});
