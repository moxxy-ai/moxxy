import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { createSummarizeCompactor } from './index.js';

function ev(seq: number, turnId: string, text: string): MoxxyEvent {
  return {
    id: `e${seq}` as never,
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

function compaction(seq: number, range: [number, number], turnId: string): MoxxyEvent {
  return {
    id: `c${seq}` as never,
    seq,
    ts: 0,
    type: 'compaction',
    sessionId: 'sess' as never,
    turnId: turnId as never,
    source: 'compactor',
    compactor: 'summarize-old-turns',
    replacedRange: range,
    summary: 'prior summary',
    tokensSaved: 60,
  } as MoxxyEvent;
}

describe('summarizeCompactor', () => {
  it('compacts events from 0 up to keepRecent-most-recent on first call', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 2 });
    const events: MoxxyEvent[] = [
      ev(0, 't1', 'turn1-a'),
      ev(1, 't1', 'turn1-b'),
      ev(2, 't2', 'turn2-a'),
      ev(3, 't3', 'turn3-a'),
      ev(4, 't4', 'turn4-a'),
    ];
    const result = await compactor.compact(events);
    // Should compact t1 and t2; keep t3 + t4. So replacedRange covers seqs 0..2.
    expect(result.replacedRange).toEqual([0, 2]);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('respects high-water mark: does not re-compact a prefix covered by an earlier compaction', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 2 });
    // Earlier compaction covered seqs 0..2. New events seq 3..5 added after.
    const events: MoxxyEvent[] = [
      compaction(0, [0, 2], 't2'),
      ev(3, 't3', 'turn3'),
      ev(4, 't4', 'turn4'),
      ev(5, 't5', 'turn5'),
      ev(6, 't6', 'turn6'),
      ev(7, 't7', 'turn7'),
    ];
    const result = await compactor.compact(events);
    // Should only consider seqs 3..7, keep t6+t7, compact t3..t5 — so from=3.
    expect(result.replacedRange[0]).toBe(3);
    expect(result.replacedRange[1]).toBeGreaterThanOrEqual(3);
    // And the prior prefix's "turn1-a" / "turn2-a" must not appear in the
    // new summary (we're not re-summarizing them).
    expect(result.summary).not.toContain('turn1-a');
  });

  it('returns an empty compaction when there aren\'t enough new turns to compact', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 3 });
    const events: MoxxyEvent[] = [
      compaction(0, [0, 5], 't3'),
      ev(6, 't4', 'turn4'),
      ev(7, 't5', 'turn5'),
    ];
    const result = await compactor.compact(events);
    expect(result.replacedRange).toEqual([0, 0]);
    expect(result.tokensSaved).toBe(0);
  });
});
