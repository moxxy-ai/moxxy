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
    // Should consider seqs 3..7, keep t6+t7, compact t3..t5. The range is in
    // seq space, so [3, 5] — and crucially seqs 3 and 4 must NOT be skipped
    // (the old index-based math started at array index 3 = seq 5, dropping
    // ev3/ev4 entirely; this fixture has seq ≠ arrayIndex to catch that).
    expect(result.replacedRange).toEqual([3, 5]);
    expect(result.summary).toContain('turn3');
    expect(result.summary).toContain('turn4');
    expect(result.summary).toContain('turn5');
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

  it('summarizes via the session provider from CompactContext when no custom summarizer is set', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 2 });
    const seen: { system?: string; model?: string; text?: string } = {};
    const provider = {
      name: 'fake',
      models: [{ id: 'fake-model', contextWindow: 100_000, supportsTools: true, supportsStreaming: true }],
      stream: async function* (req: {
        model: string;
        system?: string;
        messages: ReadonlyArray<{ content: ReadonlyArray<{ type: string; text?: string }> }>;
      }) {
        seen.model = req.model;
        seen.system = req.system;
        seen.text = req.messages[0]?.content[0]?.text;
        yield { type: 'text_delta' as const, delta: 'a real model-written ' };
        yield { type: 'text_delta' as const, delta: 'summary' };
        yield { type: 'message_end' as const, stopReason: 'end_turn' as const };
      },
      countTokens: () => Promise.resolve(0),
    };
    const events: MoxxyEvent[] = [
      ev(0, 't1', 'turn1-' + 'x'.repeat(400)),
      ev(1, 't2', 'turn2-' + 'y'.repeat(400)),
      ev(2, 't3', 'turn3'),
      ev(3, 't4', 'turn4'),
    ];
    const result = await compactor.compact(events, {
      log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
      budget: { contextWindow: 100_000, estimatedTokens: 90_000, reserveForOutput: 0 },
      signal: new AbortController().signal,
      provider: provider as never,
      model: 'fake-model',
    });
    expect(result.summary).toBe('a real model-written summary');
    expect(seen.model).toBe('fake-model');
    expect(seen.text).toContain('turn1');
    expect(seen.text).toContain('turn2');
    // Honest accounting: original ~812 chars replaced by a 28-char summary.
    expect(result.tokensSaved).toBe(Math.ceil((812 - result.summary.length) / 4));
  });

  it('falls back to a LABELED digest truncation (no fabricated savings) without a provider', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 2 });
    const events: MoxxyEvent[] = [
      ev(0, 't1', 'turn1-' + 'x'.repeat(400)),
      ev(1, 't2', 'turn2'),
      ev(2, 't3', 'turn3'),
      ev(3, 't4', 'turn4'),
    ];
    const result = await compactor.compact(events);
    expect(result.summary).toContain('not a summary'); // honest label
    expect(result.summary).toContain('turn1');
    // tokensSaved derives from real char deltas, never `slice.length * 30`.
    const originalChars = 406 + 5; // the two compacted assistant messages
    expect(result.tokensSaved).toBe(Math.max(0, Math.ceil((originalChars - result.summary.length) / 4)));
  });

  it('reports zero savings when the "summary" would be longer than the original', async () => {
    const compactor = createSummarizeCompactor({
      keepRecentTurns: 2,
      summary: () => 'Z'.repeat(5_000),
    });
    const events: MoxxyEvent[] = [
      ev(0, 't1', 'tiny1'),
      ev(1, 't2', 'tiny2'),
      ev(2, 't3', 'turn3'),
      ev(3, 't4', 'turn4'),
    ];
    const result = await compactor.compact(events);
    expect(result.tokensSaved).toBe(0); // dispatcher will discard it
  });
});
