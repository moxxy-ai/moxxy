import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { planCompaction, resolveOptions, DEFAULTS } from './segments.js';

function userPrompt(seq: number, turnId: string, text: string): MoxxyEvent {
  return {
    id: `u${seq}` as never,
    seq,
    ts: 0,
    type: 'user_prompt',
    sessionId: 'sess' as never,
    turnId: turnId as never,
    source: 'user',
    text,
  } as MoxxyEvent;
}

function assistant(seq: number, turnId: string, text: string): MoxxyEvent {
  return {
    id: `a${seq}` as never,
    seq,
    ts: 0,
    type: 'assistant_message',
    sessionId: 'sess' as never,
    turnId: turnId as never,
    source: 'model',
    content: text,
    stopReason: 'end_turn',
  } as MoxxyEvent;
}

function compaction(
  seq: number,
  range: [number, number],
  summary: string,
  turnId = 't-last',
): MoxxyEvent {
  return {
    id: `c${seq}` as never,
    seq,
    ts: 0,
    type: 'compaction',
    sessionId: 'sess' as never,
    turnId: turnId as never,
    source: 'compactor',
    compactor: 'segments',
    replacedRange: range,
    summary,
    tokensSaved: 100,
  } as MoxxyEvent;
}

/** A turn big enough to clear `minSegmentChars` on its own. */
function fatTurn(startSeq: number, turnId: string, label: string): MoxxyEvent[] {
  return [
    userPrompt(startSeq, turnId, `${label}: ${'q'.repeat(1_200)}`),
    assistant(startSeq + 1, turnId, `${label} answer: ${'a'.repeat(1_200)}`),
  ];
}

const opts = resolveOptions();

describe('planCompaction: the verbatim window', () => {
  it('plans nothing while every turn is inside the window', () => {
    const events = [...fatTurn(0, 't1', 'one'), ...fatTurn(2, 't2', 'two'), ...fatTurn(4, 't3', 'three')];
    expect(planCompaction(events, opts)).toBeNull();
  });

  it('compacts the oldest turn once it falls out of the window', () => {
    const events = [
      ...fatTurn(0, 't1', 'one'),
      ...fatTurn(2, 't2', 'two'),
      ...fatTurn(4, 't3', 'three'),
      ...fatTurn(6, 't4', 'four'),
    ];
    const plan = planCompaction(events, opts);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('segment');
    expect(plan).toMatchObject({ from: 0, to: 1 });
    expect((plan as { turnIds: string[] }).turnIds).toEqual(['t1']);
  });

  it('never touches the in-progress (last) turn even under pressure', () => {
    const events = [...fatTurn(0, 't1', 'one'), ...fatTurn(2, 't2', 'live')];
    const plan = planCompaction(events, { ...opts, keepRecentTurns: 1 });
    // keepRecentTurns=1 protects only the live turn, so t1 is eligible…
    expect(plan).toMatchObject({ kind: 'segment', from: 0, to: 1 });
    // …and the live turn's events are never inside the window.
    expect(plan!.to).toBeLessThan(2);
  });

  it('skips a turn that is already covered by a live summary', () => {
    const events = [
      ...fatTurn(0, 't1', 'one'),
      ...fatTurn(2, 't2', 'two'),
      ...fatTurn(4, 't3', 'three'),
      ...fatTurn(6, 't4', 'four'),
      compaction(8, [0, 1], '[segment 1 · turn t1 · seq 0-1]\nrecord'),
    ];
    const plan = planCompaction(events, opts);
    expect(plan).toMatchObject({ kind: 'segment', from: 2, to: 3 });
  });
});

describe('planCompaction: small turns', () => {
  it('waits rather than summarizing a sub-session that saves nothing', () => {
    const tiny = (seq: number, turn: string): MoxxyEvent[] => [
      userPrompt(seq, turn, 'ok'),
      assistant(seq + 1, turn, 'done'),
    ];
    const events = [...tiny(0, 't1'), ...tiny(2, 't2'), ...tiny(4, 't3'), ...tiny(6, 't4')];
    expect(planCompaction(events, opts)).toBeNull();
  });

  it('groups consecutive small turns into one sub-session once they add up', () => {
    const medium = (seq: number, turn: string): MoxxyEvent[] => [
      userPrompt(seq, turn, 'q'.repeat(400)),
      assistant(seq + 1, turn, 'a'.repeat(400)),
    ];
    const events = [
      ...medium(0, 't1'),
      ...medium(2, 't2'),
      ...medium(4, 't3'),
      ...medium(6, 't4'),
      ...medium(8, 't5'),
      ...medium(10, 't6'),
    ];
    const plan = planCompaction(events, opts);
    expect(plan).not.toBeNull();
    expect((plan as { turnIds: string[] }).turnIds).toEqual(['t1', 't2', 't3']);
    expect(plan).toMatchObject({ from: 0, to: 5 });
  });
});

describe('planCompaction: chapter folding', () => {
  it('folds the oldest summaries once the index passes the cap', () => {
    const events: MoxxyEvent[] = [];
    // 13 summarized sub-sessions (cap is 12) covering seq 0..25, then a live turn.
    for (let i = 0; i < 13; i++) {
      events.push(userPrompt(i * 2, `t${i}`, 'x'.repeat(10)));
      events.push(assistant(i * 2 + 1, `t${i}`, 'y'.repeat(10)));
    }
    for (let i = 0; i < 13; i++) {
      events.push(
        compaction(100 + i, [i * 2, i * 2 + 1], `[segment ${i + 1} · turn t${i} · seq ${i * 2}-${i * 2 + 1}]\nrecord ${i}`),
      );
    }
    const plan = planCompaction(events, opts);
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe('chapter');
    // The oldest `foldSegments` records, and only those.
    expect(plan).toMatchObject({ from: 0, to: 11, ordinal: 1 });
    expect((plan as { summaries: string[] }).summaries).toHaveLength(DEFAULTS.foldSegments);
  });

  it('stops a fold before a window that would swallow an unsummarized turn', () => {
    const events: MoxxyEvent[] = [];
    // 14 turns, but t3 is never summarized. It sits verbatim in the middle of
    // the record index, so a fold spanning past it would drop it from context.
    for (let i = 0; i < 14; i++) {
      events.push(userPrompt(i * 2, `t${i}`, 'x'.repeat(10)));
      events.push(assistant(i * 2 + 1, `t${i}`, 'y'.repeat(10)));
    }
    for (let i = 0; i < 14; i++) {
      if (i === 3) continue;
      events.push(
        compaction(100 + i, [i * 2, i * 2 + 1], `[segment ${i + 1} · turn t${i} · seq ${i * 2}-${i * 2 + 1}]\nrecord ${i}`),
      );
    }
    const plan = planCompaction(events, opts);
    expect(plan!.kind).toBe('chapter');
    // Folds t0-t2 and stops: t3 (seq 6-7) is uncovered, so the window may not
    // reach t4's record.
    expect(plan).toMatchObject({ from: 0, to: 5 });
    expect((plan as { summaries: string[] }).summaries).toHaveLength(3);
  });
});

describe('resolveOptions', () => {
  it('clamps hostile values instead of disabling the bound', () => {
    const resolved = resolveOptions({
      keepRecentTurns: 0,
      maxSegments: Number.NaN,
      foldSegments: 1,
      minSegmentChars: -5,
    });
    expect(resolved.keepRecentTurns).toBe(1);
    expect(resolved.maxSegments).toBe(DEFAULTS.maxSegments);
    expect(resolved.foldSegments).toBe(2);
    expect(resolved.minSegmentChars).toBe(200);
  });

  it('never lets a fold exceed the cap it is restoring', () => {
    expect(resolveOptions({ maxSegments: 3, foldSegments: 50 }).foldSegments).toBe(3);
  });
});
