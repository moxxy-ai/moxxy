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

function toolCall(seq: number, turnId: string, name: string, input: unknown): MoxxyEvent {
  return {
    id: `t${seq}` as never,
    seq,
    ts: 0,
    type: 'tool_call_requested',
    sessionId: 'sess' as never,
    turnId: turnId as never,
    source: 'model',
    callId: `call-${seq}` as never,
    name,
    input,
  } as MoxxyEvent;
}

function toolResult(seq: number, turnId: string, output: unknown): MoxxyEvent {
  return {
    id: `r${seq}` as never,
    seq,
    ts: 0,
    type: 'tool_result',
    sessionId: 'sess' as never,
    turnId: turnId as never,
    source: 'tool',
    callId: `call-${seq}` as never,
    ok: true,
    output,
  } as MoxxyEvent;
}

function userPrompt(
  seq: number,
  turnId: string,
  text: string,
  attachments?: ReadonlyArray<{ kind: string; content: string }>,
): MoxxyEvent {
  return {
    id: `u${seq}` as never,
    seq,
    ts: 0,
    type: 'user_prompt',
    sessionId: 'sess' as never,
    turnId: turnId as never,
    source: 'user',
    text,
    ...(attachments ? { attachments } : {}),
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
    // No-op range uses a sentinel that can never alias a live seq (seq 0 is a
    // real event), so a caller that forgot to pre-filter still can't drop it.
    expect(result.replacedRange).toEqual([
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ]);
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

  it('throws on an empty event log instead of fabricating a compaction', async () => {
    const compactor = createSummarizeCompactor();
    await expect(compactor.compact([])).rejects.toThrow(/no events/);
  });

  it('survives a tool_call with circular / undefined input (no crash, degrades to a marker)', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 1 });
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify would throw
    const events: MoxxyEvent[] = [
      toolCall(0, 't1', 'Read', circular),
      toolCall(1, 't1', 'NoArgs', undefined), // JSON.stringify(undefined) is not a string
      ev(2, 't2', 'turn2'),
    ];
    // Must not throw, and must compact t1 (the oldest turn).
    const result = await compactor.compact(events);
    expect(result.replacedRange).toEqual([0, 1]);
    expect(result.summary).toContain('Read');
    expect(result.summary).not.toContain('undefined(');
  });

  it('falls back to a labeled digest when the provider stream emits an error event', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 2 });
    const provider = {
      name: 'fake',
      models: [{ id: 'm', contextWindow: 100_000, supportsTools: true, supportsStreaming: true }],
      stream: async function* () {
        yield { type: 'error' as const, message: 'boom', retryable: true };
      },
      countTokens: () => Promise.resolve(0),
    };
    const events: MoxxyEvent[] = [
      ev(0, 't1', 'turn1-' + 'x'.repeat(400)),
      ev(1, 't2', 'turn2'),
      ev(2, 't3', 'turn3'),
      ev(3, 't4', 'turn4'),
    ];
    const result = await compactor.compact(events, {
      log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
      budget: { contextWindow: 100_000, estimatedTokens: 90_000, reserveForOutput: 0 },
      signal: new AbortController().signal,
      provider: provider as never,
      model: 'm',
    });
    expect(result.summary).toContain('not a summary'); // honest fallback label
    expect(result.summary).toContain('turn1');
  });

  it('does NOT rewrite history when the turn is already aborted — it throws', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 2 });
    const controller = new AbortController();
    controller.abort();
    let streamed = false;
    const provider = {
      name: 'fake',
      models: [{ id: 'm', contextWindow: 100_000, supportsTools: true, supportsStreaming: true }],
      stream: async function* () {
        streamed = true;
        yield { type: 'text_delta' as const, delta: 'should not be used' };
      },
      countTokens: () => Promise.resolve(0),
    };
    const events: MoxxyEvent[] = [
      ev(0, 't1', 'turn1'),
      ev(1, 't2', 'turn2'),
      ev(2, 't3', 'turn3'),
      ev(3, 't4', 'turn4'),
    ];
    await expect(
      compactor.compact(events, {
        log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
        budget: { contextWindow: 100_000, estimatedTokens: 90_000, reserveForOutput: 0 },
        signal: controller.signal,
        provider: provider as never,
        model: 'm',
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(streamed).toBe(false); // bailed before touching the provider
  });

  it('does NOT degrade a cancelled custom summarizer to a fallback digest — it throws', async () => {
    const controller = new AbortController();
    const compactor = createSummarizeCompactor({
      keepRecentTurns: 2,
      summary: () => {
        controller.abort(); // cancel mid-summary
        return 'partial';
      },
    });
    const events: MoxxyEvent[] = [
      ev(0, 't1', 'turn1'),
      ev(1, 't2', 'turn2'),
      ev(2, 't3', 'turn3'),
      ev(3, 't4', 'turn4'),
    ];
    await expect(
      compactor.compact(events, {
        log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
        budget: { contextWindow: 100_000, estimatedTokens: 90_000, reserveForOutput: 0 },
        signal: controller.signal,
      } as never),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('clamps keepRecentTurns=0 to >=1 so the active turn is never compacted away', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 0 });
    const events: MoxxyEvent[] = [
      ev(0, 't1', 'turn1'),
      ev(1, 't2', 'turn2'),
    ];
    const result = await compactor.compact(events);
    // With keepRecent floored to 1, only t1 is compacted; t2 (most recent) kept.
    expect(result.replacedRange).toEqual([0, 0]);
    expect(result.turnId).toBe('t1');
  });

  it('treats a NaN thresholdRatio as the 0.75 default so compaction still fires', () => {
    const compactor = createSummarizeCompactor({ thresholdRatio: Number.NaN });
    // estimatedTokens 80k of a 100k window > 0.75*100k → compaction triggers.
    expect(
      compactor.shouldCompact({} as never, {
        contextWindow: 100_000,
        estimatedTokens: 80_000,
        reserveForOutput: 0,
      }),
    ).toBe(true);
  });

  it('only compacts the contiguous leading run under interleaved turnIds (never engulfs a kept turn)', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 2 });
    // Interleaved: A, C, A, D. first-occurrence unique = [A, C, D]; keepRecent=2
    // keeps C+D, compacts only A. C (KEPT) sits at seq 1, BETWEEN A's two events
    // (seq 0 and seq 2). A last-match scan would set the range to [0,2], dropping
    // C's seq 1 from projection. The leading-run stops at the first kept event,
    // so the emitted range is [0,0] and never engulfs C.
    const events: MoxxyEvent[] = [
      ev(0, 'A', 'a-first'),
      ev(1, 'C', 'c-kept'),
      ev(2, 'A', 'a-second'),
      ev(3, 'D', 'd'),
    ];
    const result = await compactor.compact(events);
    expect(result.replacedRange).toEqual([0, 0]);
    // C's seq 1 is NOT inside the replaced range.
    const [from, to] = result.replacedRange;
    expect(1 >= from && 1 <= to).toBe(false);
  });

  it('sizes a rich ToolDisplayResult tool_result by forModel, not the bulky display payload', async () => {
    // A file-diff tool_result only sends its short `forModel` string to the
    // model; `display` is a large channel-only payload. Accounting must credit
    // the small `forModel` length, NOT what JSON.stringify(display) would
    // measure — otherwise tokensSaved is wildly over-reported for diff turns.
    const compactor = createSummarizeCompactor({
      keepRecentTurns: 1,
      summary: () => 'S', // 1-char summary so tokensSaved ≈ originalChars/4
    });
    const bigDisplay = {
      kind: 'file-diff',
      path: '/x',
      mode: 'update',
      added: 2_000,
      removed: 0,
      hunks: [
        {
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 2_000,
          lines: Array.from({ length: 2_000 }, (_, i) => ({
            kind: 'add',
            text: `line ${i} ${'x'.repeat(20)}`,
            newNo: i + 1,
          })),
        },
      ],
    };
    const events: MoxxyEvent[] = [
      toolResult(0, 't1', { forModel: 'edited 3 lines', display: bigDisplay }),
      ev(1, 't2', 'turn2'),
    ];
    const result = await compactor.compact(events);
    // forModel is 14 chars; tokensSaved = ceil((14 - 1)/4) = 4. If the bulky
    // display were stringified (tens of KB) this would be in the thousands.
    expect(result.tokensSaved).toBe(Math.ceil((14 - 1) / 4));
    expect(result.tokensSaved).toBeLessThan(100);
  });

  it('credits inlined file/stdin attachment text in a compacted user_prompt', async () => {
    // A user_prompt that pasted a large file carries the bytes in
    // attachments[].content; those cost real prompt tokens. The replaced-cost
    // accounting must include them so a compacted file-bearing prompt is not
    // under-credited (image/document base64 is intentionally NOT counted).
    const compactor = createSummarizeCompactor({
      keepRecentTurns: 1,
      summary: () => 'S',
    });
    const fileBody = 'F'.repeat(1_000);
    const events: MoxxyEvent[] = [
      userPrompt(0, 't1', 'review this', [
        { kind: 'file', content: fileBody },
        { kind: 'image', content: 'B'.repeat(5_000) }, // base64 — NOT counted
      ]),
      ev(1, 't2', 'turn2'),
    ];
    const result = await compactor.compact(events);
    // originalChars = 'review this'(11) + file(1000) = 1011; image excluded.
    const originalChars = 11 + 1_000;
    expect(result.tokensSaved).toBe(Math.max(0, Math.ceil((originalChars - 1) / 4)));
  });

  it('does not crash and degrades to a marker for a tool_call with a BigInt input', async () => {
    // BigInt makes JSON.stringify throw (TypeError) — the digest line must
    // degrade to a marker rather than abort the whole compaction.
    const compactor = createSummarizeCompactor({ keepRecentTurns: 1 });
    const events: MoxxyEvent[] = [
      toolCall(0, 't1', 'Compute', { n: 10n }),
      ev(1, 't2', 'turn2'),
    ];
    const result = await compactor.compact(events);
    expect(result.replacedRange).toEqual([0, 0]);
    expect(result.summary).toContain('Compute');
    expect(result.summary).toContain('[unserializable]');
  });

  it('truncates an oversized digest with a head+tail marker before sending to the provider', async () => {
    // When the digest exceeds MAX_SUMMARIZE_INPUT_CHARS the provider input must
    // be a bounded head+tail window with a truncation marker — never the full
    // unbounded text (which could blow the provider's own context).
    const compactor = createSummarizeCompactor({ keepRecentTurns: 1 });
    let seenInput = '';
    const provider = {
      name: 'fake',
      models: [{ id: 'm', contextWindow: 100_000, supportsTools: true, supportsStreaming: true }],
      stream: async function* (req: {
        messages: ReadonlyArray<{ content: ReadonlyArray<{ type: string; text?: string }> }>;
      }) {
        seenInput = req.messages[0]?.content[0]?.text ?? '';
        yield { type: 'text_delta' as const, delta: 'ok' };
        yield { type: 'message_end' as const, stopReason: 'end_turn' as const };
      },
      countTokens: () => Promise.resolve(0),
    };
    // Many old-turn events whose digest lines (each capped at ~200 chars by
    // describeEvent) together exceed the 48k input ceiling. 400 * ~212 ≈ 85k.
    const events: MoxxyEvent[] = [];
    for (let i = 0; i < 400; i++) events.push(ev(i, 't1', 'Z'.repeat(300)));
    events.push(ev(400, 't2', 'turn2'));
    await compactor.compact(events, {
      log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
      budget: { contextWindow: 100_000, estimatedTokens: 90_000, reserveForOutput: 0 },
      signal: new AbortController().signal,
      provider: provider as never,
      model: 'm',
    });
    expect(seenInput).toContain('[... digest truncated ...]');
    // Bounded: well under the raw 60k+ digest length.
    expect(seenInput.length).toBeLessThan(50_000);
  });

  it('aborts mid-stream: stops consuming the provider and throws instead of rewriting history', async () => {
    const compactor = createSummarizeCompactor({ keepRecentTurns: 2 });
    const controller = new AbortController();
    let yields = 0;
    const provider = {
      name: 'fake',
      models: [{ id: 'm', contextWindow: 100_000, supportsTools: true, supportsStreaming: true }],
      // A provider that ignores the signal and keeps yielding — the compactor
      // must still bail promptly (not drain the stream, not rewrite history).
      stream: async function* () {
        for (let i = 0; i < 1_000; i++) {
          yields++;
          if (i === 1) controller.abort(); // cancel after the 2nd chunk
          yield { type: 'text_delta' as const, delta: 'x' };
        }
      },
      countTokens: () => Promise.resolve(0),
    };
    const events: MoxxyEvent[] = [
      ev(0, 't1', 'turn1'),
      ev(1, 't2', 'turn2'),
      ev(2, 't3', 'turn3'),
      ev(3, 't4', 'turn4'),
    ];
    await expect(
      compactor.compact(events, {
        log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
        budget: { contextWindow: 100_000, estimatedTokens: 90_000, reserveForOutput: 0 },
        signal: controller.signal,
        provider: provider as never,
        model: 'm',
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    // Bailed out long before draining all 1000 chunks.
    expect(yields).toBeLessThan(10);
  });
});
