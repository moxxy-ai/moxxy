import { describe, expect, it, vi } from 'vitest';
import {
  asEventId,
  asSessionId,
  asToolCallId,
  asTurnId,
  estimateContextTokens as sdkEstimate,
} from '@moxxy/sdk';
import type { EventLogReader, MoxxyEvent } from '@moxxy/sdk';
import { estimateContextTokens, eventChars } from './context-estimate.js';

const sid = asSessionId('s1');
const t1 = asTurnId('t1');

/** Mutable EventLogReader test double (append + clear, seq === index). */
class TestLog implements EventLogReader {
  private events: MoxxyEvent[] = [];
  get length(): number {
    return this.events.length;
  }
  at(seq: number): MoxxyEvent | undefined {
    return this.events[seq];
  }
  slice(from = 0, to = this.events.length): ReadonlyArray<MoxxyEvent> {
    return this.events.slice(from, to);
  }
  ofType(): never[] {
    return [];
  }
  byTurn(): ReadonlyArray<MoxxyEvent> {
    return this.events;
  }
  toJSON(): ReadonlyArray<MoxxyEvent> {
    return [...this.events];
  }
  append(partial: Record<string, unknown>): void {
    const seq = this.events.length;
    this.events.push({
      id: asEventId(`${Math.random().toString(36).slice(2)}-${seq}`),
      seq,
      ts: seq,
      sessionId: sid,
      turnId: t1,
      ...partial,
    } as unknown as MoxxyEvent);
  }
  clear(): void {
    this.events = [];
  }
}

const user = (text: string) => ({ type: 'user_prompt', source: 'user', text });
const assistant = (content: string) => ({
  type: 'assistant_message',
  source: 'model',
  content,
  stopReason: 'end_turn',
});
const toolCall = (callId: string, name: string, input: unknown) => ({
  type: 'tool_call_requested',
  source: 'model',
  callId: asToolCallId(callId),
  name,
  input,
});
const toolResult = (callId: string, output: unknown) => ({
  type: 'tool_result',
  source: 'tool',
  callId: asToolCallId(callId),
  ok: true,
  output,
});
const elision = (elidedThrough: number) => ({
  type: 'elision',
  source: 'system',
  elidedThrough,
  stubbedRanges: [[0, elidedThrough]],
  elideConversational: true,
  conversationalRecallThreshold: 4,
  maxRecallBytes: 32_768,
  neverElideTools: [],
});
const compaction = (range: [number, number], summary: string) => ({
  type: 'compaction',
  source: 'compactor',
  compactor: 'summarize-old-turns',
  replacedRange: range,
  summary,
  tokensSaved: 999,
});

const big = 'X'.repeat(5000);

function seedConversation(log: TestLog): void {
  log.append(user('the original task'));
  log.append(toolCall('c1', 'Read', { file_path: '/a' }));
  log.append(toolResult('c1', big));
  log.append(assistant('old detailed answer '.repeat(20)));
}

describe('cached estimateContextTokens', () => {
  it('matches the SDK estimate across appends, elision, recall, and compaction', () => {
    const log = new TestLog();
    expect(estimateContextTokens(log)).toBe(0);

    seedConversation(log);
    expect(estimateContextTokens(log)).toBe(sdkEstimate(log));

    log.append(user('next question'));
    log.append(assistant('short answer'));
    expect(estimateContextTokens(log)).toBe(sdkEstimate(log));

    // Elision changes the contribution of OLD events → must still match.
    log.append(elision(3));
    expect(estimateContextTokens(log)).toBe(sdkEstimate(log));

    // A recall rewrites the stub of an old elided result → must still match.
    log.append(toolCall('r1', 'recall', { callId: 'c1' }));
    log.append(toolResult('r1', 'recalled full content'));
    expect(estimateContextTokens(log)).toBe(sdkEstimate(log));

    // Compaction replaces a past range with its summary → must still match.
    log.append(compaction([0, 3], 'compact summary of the first turn'));
    expect(estimateContextTokens(log)).toBe(sdkEstimate(log));

    // And plain growth after all of the above still matches.
    log.append(user('and one more thing'));
    log.append(toolCall('c2', 'Read', { file_path: '/b' }));
    log.append(toolResult('c2', { big, nested: [1, 2, 3] }));
    expect(estimateContextTokens(log)).toBe(sdkEstimate(log));
  });

  it('does not re-walk an unchanged log and folds only NEW events on append', () => {
    const log = new TestLog();
    seedConversation(log);

    const spy = vi.fn(eventChars);
    const first = estimateContextTokens(log, { perEventChars: spy });
    expect(spy).toHaveBeenCalledTimes(4); // initial full walk

    spy.mockClear();
    expect(estimateContextTokens(log, { perEventChars: spy })).toBe(first);
    expect(estimateContextTokens(log, { perEventChars: spy })).toBe(first);
    expect(spy).not.toHaveBeenCalled(); // unchanged log → pure cache hit

    log.append(user('follow-up'));
    log.append(assistant('reply'));
    spy.mockClear();
    const grown = estimateContextTokens(log, { perEventChars: spy });
    expect(grown).toBe(sdkEstimate(log));
    expect(spy).toHaveBeenCalledTimes(2); // only the two appended events
  });

  it('stays correct across clear/reset (mirror wipe) and a regrown log', () => {
    const log = new TestLog();
    seedConversation(log);
    const before = estimateContextTokens(log);
    expect(before).toBeGreaterThan(0);

    log.clear();
    expect(estimateContextTokens(log)).toBe(0);

    // Regrow with different content — fresh ids, so the stale prefix can't alias.
    log.append(user('a brand new conversation'));
    log.append(assistant('ok'));
    expect(estimateContextTokens(log)).toBe(sdkEstimate(log));
    expect(estimateContextTokens(log)).not.toBe(before);
  });

  it('detects a wipe even without an intervening call on the empty log', () => {
    const log = new TestLog();
    seedConversation(log);
    estimateContextTokens(log); // warm the cache

    // Wipe and regrow to the SAME length without calling the estimator in
    // between — only the event ids distinguish this from "unchanged".
    log.clear();
    log.append(user('different'));
    log.append(toolCall('z1', 'Read', { file_path: '/z' }));
    log.append(toolResult('z1', 'tiny'));
    log.append(assistant('done'));
    expect(estimateContextTokens(log)).toBe(sdkEstimate(log));
  });

  it('falls back to a full walk when an elision event lands (and matches)', () => {
    const log = new TestLog();
    seedConversation(log);
    const spy = vi.fn(eventChars);
    estimateContextTokens(log, { perEventChars: spy });

    log.append(elision(3));
    spy.mockClear();
    expect(estimateContextTokens(log, { perEventChars: spy })).toBe(sdkEstimate(log));
    // Full re-walk: old events that are NOT stubbed still go through the
    // estimator (the anchor prompt + the tool call at least).
    expect(spy.mock.calls.length).toBeGreaterThan(1);
  });
});
