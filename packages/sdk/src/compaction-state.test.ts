import { describe, expect, it } from 'vitest';
import { activeCompactionRanges, makeCompactionLookup } from './compaction-state.js';
import { estimateContextTokens } from './compactor-helpers.js';
import { asEventId, asSessionId, asTurnId } from './ids.js';
import type { EventLogReader } from './log.js';
import type { MoxxyEvent, MoxxyEventOfType, MoxxyEventType } from './events.js';
import type { TurnId } from './ids.js';

const sid = asSessionId('s1');

function event(seq: number, partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>): MoxxyEvent {
  return { id: asEventId(`e${seq}`), seq, ts: seq, sessionId: sid, ...partial } as MoxxyEvent;
}

function compaction(
  seq: number,
  range: readonly [number, number],
  summary: string,
  tokensSaved = 100,
): MoxxyEvent {
  return event(seq, {
    type: 'compaction',
    turnId: asTurnId('t1'),
    source: 'compactor',
    compactor: 'test',
    replacedRange: range,
    summary,
    tokensSaved,
  } as Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>);
}

function prompt(seq: number, turnId: string, text: string): MoxxyEvent {
  return event(seq, { type: 'user_prompt', turnId: asTurnId(turnId), source: 'user', text } as Omit<
    MoxxyEvent,
    'id' | 'seq' | 'ts' | 'sessionId'
  >);
}

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

describe('activeCompactionRanges', () => {
  it('keeps every well-formed, non-overlapping range', () => {
    const ranges = activeCompactionRanges([
      compaction(10, [0, 4], 'first'),
      compaction(11, [5, 9], 'second'),
    ]);
    expect(ranges.map((r) => r.summary)).toEqual(['first', 'second']);
  });

  it('drops inert compactions (no savings, empty summary, inverted range)', () => {
    const ranges = activeCompactionRanges([
      compaction(10, [0, 4], 'saved nothing', 0),
      compaction(11, [5, 9], '   '),
      compaction(12, [9, 5], 'inverted'),
      compaction(13, [10, 14], 'kept'),
    ]);
    expect(ranges.map((r) => r.summary)).toEqual(['kept']);
  });

  it('supersedes ranges a LATER range fully contains (chapter rollup)', () => {
    const ranges = activeCompactionRanges([
      compaction(10, [0, 4], 'segment 1'),
      compaction(11, [5, 9], 'segment 2'),
      compaction(12, [0, 9], 'chapter of 1-2'),
      compaction(13, [20, 24], 'segment 3'),
    ]);
    expect(ranges.map((r) => r.summary)).toEqual(['chapter of 1-2', 'segment 3']);
  });

  it('does not let an EARLIER wide range swallow a later one', () => {
    // Order matters: only a range emitted after the one it contains supersedes
    // it. The reverse would drop a fresh summary in favour of a stale rollup.
    const ranges = activeCompactionRanges([
      compaction(10, [0, 9], 'wide first'),
      compaction(11, [2, 4], 'narrow later'),
    ]);
    expect(ranges.map((r) => r.summary)).toEqual(['wide first', 'narrow later']);
  });

  it('a superseded range stays covered by the rollup that replaced it', () => {
    const ranges = activeCompactionRanges([
      compaction(10, [0, 4], 'segment 1'),
      compaction(11, [0, 9], 'chapter'),
    ]);
    const lookup = makeCompactionLookup(ranges);
    expect(lookup(3)?.summary).toBe('chapter');
    expect(lookup(7)?.summary).toBe('chapter');
    expect(lookup(12)).toBeNull();
  });
});

describe('estimateContextTokens with superseded ranges', () => {
  it('counts the rollup summary once, not the summaries it replaced', () => {
    const events = [
      prompt(0, 't1', 'a'.repeat(400)),
      prompt(1, 't2', 'b'.repeat(400)),
      compaction(2, [0, 0], 'S'.repeat(100)),
      compaction(3, [1, 1], 'T'.repeat(100)),
      compaction(4, [0, 1], 'C'.repeat(40)),
    ];
    // Only the chapter summary is live: 40 chars / 4 = 10 tokens. The replaced
    // prompts and the superseded segment summaries contribute nothing.
    expect(estimateContextTokens(reader(events))).toBe(10);
  });
});
