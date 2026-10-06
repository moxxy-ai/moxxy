import { describe, expect, it } from 'vitest';
import {
  estimateContextTokens,
  projectMessagesFromLog,
  type CompactionEvent,
  type EventLogReader,
  type LLMProvider,
  type ProviderRequest,
  type MoxxyEvent,
  type MoxxyEventOfType,
  type MoxxyEventType,
  type TurnId,
} from '@moxxy/sdk';
import { buildSessionDocs, createSegmentsCompactor, sessionRecallTool } from './index.js';

function reader(events: ReadonlyArray<MoxxyEvent>): EventLogReader {
  return {
    length: events.length,
    at: (seq) => events.find((e) => e.seq === seq),
    slice: (from = 0, to = events.length) => events.slice(from, to),
    ofType: <T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>> =>
      events.filter((e): e is MoxxyEventOfType<T> => e.type === type),
    byTurn: (turnId: TurnId) => events.filter((e) => e.turnId === turnId),
    toJSON: () => events,
  };
}

const CONTEXT_WINDOW = 200_000;

function budgetFor(events: ReadonlyArray<MoxxyEvent>) {
  return {
    contextWindow: CONTEXT_WINDOW,
    estimatedTokens: estimateContextTokens(reader(events)),
    reserveForOutput: 4_000,
  };
}

/**
 * Drive the compactor the way a mode's loop does: after each turn, keep asking
 * until it says there is nothing left to do.
 */
async function settle(
  compactor: ReturnType<typeof createSegmentsCompactor>,
  events: MoxxyEvent[],
  nextSeq: () => number,
): Promise<void> {
  for (let guard = 0; guard < 10; guard++) {
    const budget = budgetFor(events);
    if (!compactor.shouldCompact(reader(events), budget)) return;
    const result = await compactor.compact(events, {
      log: reader(events),
      budget,
      signal: new AbortController().signal,
    });
    if (result.tokensSaved <= 0 || result.summary.trim().length === 0) return;
    events.push({ ...result, id: `c${nextSeq.length}` as never, seq: nextSeq(), ts: 0 } as MoxxyEvent);
  }
  throw new Error('compaction did not settle; the plan is not converging');
}

interface Session {
  readonly events: MoxxyEvent[];
  turn(label: string, size?: number): Promise<void>;
}

function session(summary?: (text: string, kind: 'segment' | 'chapter') => string): Session {
  const compactor = createSegmentsCompactor(
    summary ? { summary } : { summary: (_t, kind) => `${kind} record ${'r'.repeat(560)}` },
  );
  const events: MoxxyEvent[] = [];
  let seq = 0;
  const next = (): number => seq++;
  let turnNo = 0;
  return {
    events,
    async turn(label, size = 1_500) {
      turnNo += 1;
      const turnId = `t${turnNo}` as never;
      events.push({
        id: `u${seq}` as never,
        seq: next(),
        ts: 0,
        type: 'user_prompt',
        sessionId: 'sess' as never,
        turnId,
        source: 'user',
        text: label,
      } as MoxxyEvent);
      events.push({
        id: `a${seq}` as never,
        seq: next(),
        ts: 0,
        type: 'assistant_message',
        sessionId: 'sess' as never,
        turnId,
        source: 'model',
        content: `${label}: ${'x'.repeat(size)}`,
        stopReason: 'end_turn',
      } as MoxxyEvent);
      await settle(compactor, events, next);
    },
  };
}

describe('segments compactor: long-session boundedness', () => {
  it('keeps the projected context bounded over hundreds of turns', async () => {
    const s = session();
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      await s.turn(`task ${i}`);
      if (i % 10 === 9) samples.push(estimateContextTokens(reader(s.events)));
    }

    // The honest claim: context size is governed by the policy, not by session
    // length. Without compaction these 200 turns cost ~78k tokens and grow
    // linearly; here the last sample is no larger than the first few.
    const early = Math.max(...samples.slice(0, 3));
    const late = Math.max(...samples.slice(-3));
    expect(late).toBeLessThanOrEqual(early * 1.2);
    expect(Math.max(...samples)).toBeLessThan(8_000);

    // And it is genuinely doing the work, not just refusing to compact.
    const compactions = s.events.filter((e) => e.type === 'compaction');
    expect(compactions.length).toBeGreaterThan(50);
    expect(compactions.some((e) => e.summary.startsWith('[chapter '))).toBe(true);
  });

  it('caps the live record index regardless of how long the session runs', async () => {
    const s = session();
    for (let i = 0; i < 120; i++) await s.turn(`task ${i}`);
    // Live records = what projection actually emits as summaries.
    expect(buildSessionDocs(s.events).length).toBeLessThanOrEqual(12);
  });

  it('drops superseded records from the projection once they fold', async () => {
    const s = session();
    for (let i = 0; i < 120; i++) await s.turn(`task ${i}`);
    const messages = projectMessagesFromLog({ log: reader(s.events) });
    const summaryMessages = messages.filter((m) =>
      m.content.some((c) => c.type === 'text' && c.text.startsWith('[summary of earlier turns]')),
    );
    expect(summaryMessages.length).toBe(buildSessionDocs(s.events).length);
  });
});

describe('segments compactor: the records themselves', () => {
  it('stamps each record with the turns it replaces, so recall can address it', async () => {
    const s = session();
    for (let i = 0; i < 5; i++) await s.turn(`task ${i}`);
    const first = s.events.find((e) => e.type === 'compaction');
    expect(first).toBeDefined();
    // These turns are individually below `minSegmentChars`, so the first
    // sub-session spans two of them, and the header names both.
    expect(first!.type === 'compaction' && first!.summary).toMatch(
      /^\[segment 1 · turn t1, t2 · seq 0-3\]/,
    );
  });

  it('never lets a verbose summarizer grow the context', async () => {
    // A summarizer that ignores the brief and writes an essay.
    const s = session(() => 'z'.repeat(50_000));
    for (let i = 0; i < 6; i++) await s.turn(`task ${i}`);
    const records = s.events.filter((e) => e.type === 'compaction');
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      if (record.type !== 'compaction') continue;
      expect(record.tokensSaved).toBeGreaterThan(0);
    }
  });

  it('re-throws when the turn is cancelled mid-summary instead of rewriting history', async () => {
    const controller = new AbortController();
    const compactor = createSegmentsCompactor({
      summary: () => {
        controller.abort();
        return 'a record written just as the user hit stop';
      },
    });
    const events: MoxxyEvent[] = [];
    let seq = 0;
    for (let i = 0; i < 5; i++) {
      const turnId = `t${i}` as never;
      events.push({
        id: `u${seq}` as never, seq: seq++, ts: 0, type: 'user_prompt',
        sessionId: 'sess' as never, turnId, source: 'user', text: 'q'.repeat(1_200),
      } as MoxxyEvent);
      events.push({
        id: `a${seq}` as never, seq: seq++, ts: 0, type: 'assistant_message',
        sessionId: 'sess' as never, turnId, source: 'model',
        content: 'a'.repeat(1_200), stopReason: 'end_turn',
      } as MoxxyEvent);
    }
    await expect(
      compactor.compact(events, {
        log: reader(events),
        budget: budgetFor(events),
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });
});

/** A finished turn: the user's words, then a reply long enough to be worth recording. */
function turnEvents(turnId: string, firstSeq: number, text: string, replyChars = 1_200): MoxxyEvent[] {
  return [
    {
      id: `u${firstSeq}` as never, seq: firstSeq, ts: 0, type: 'user_prompt',
      sessionId: 'sess' as never, turnId: turnId as never, source: 'user', text,
    } as MoxxyEvent,
    {
      id: `a${firstSeq + 1}` as never, seq: firstSeq + 1, ts: 0, type: 'assistant_message',
      sessionId: 'sess' as never, turnId: turnId as never, source: 'model',
      content: 'a'.repeat(replyChars), stopReason: 'end_turn',
    } as MoxxyEvent,
  ];
}

function history(prompts: ReadonlyArray<string>, replyChars?: number): MoxxyEvent[] {
  return prompts.flatMap((text, i) => turnEvents(`t${i}`, i * 2, text, replyChars));
}

async function firstRecord(
  events: ReadonlyArray<MoxxyEvent>,
  options: Parameters<typeof createSegmentsCompactor>[0],
  budget = budgetFor(events),
): Promise<Omit<CompactionEvent, 'id' | 'seq' | 'ts'>> {
  const compactor = createSegmentsCompactor(options);
  return compactor.compact(events, { log: reader(events), budget, signal: new AbortController().signal });
}

describe('segments compactor: what the user settled survives the record', () => {
  it("keeps the user's own words in the record even when the summary leaves them out", async () => {
    const events = history([
      'Ustaw lot tylko w jedną stronę, 7 października.',
      'next',
      'and next',
      'and the last one',
    ], 2_400);
    const record = await firstRecord(events, { summary: () => 'Asked: flights. Did: searched.' });

    expect(record.summary).toMatch(/^\[segment 1 · turn t0 · seq 0-1\]\nUser: Ustaw lot tylko w jedną stronę, 7 października\.\n/);
  });

  it('shortens a long message and still shrinks the context', async () => {
    const events = history(['w'.repeat(5_000), 'next', 'and next', 'and the last one']);
    const record = await firstRecord(events, { summary: () => 'Asked: a long paste.' });

    const userLine = record.summary.split('\n').find((line) => line.startsWith('User: '));
    expect(userLine).toBe(`User: ${'w'.repeat(300)}…`);
    expect(record.tokensSaved).toBeGreaterThan(0);
  });

  it('never lets the kept words grow the context, even with a low record threshold', async () => {
    const events = history(['u'.repeat(280), 'next', 'and next', 'and the last one'], 30);
    const record = await firstRecord(events, { minSegmentChars: 300, summary: () => 'Asked: a short one.' });
    expect(record.tokensSaved).toBeGreaterThan(0);
  });

  it('asks the summarizer for the choices the user settled', async () => {
    const received: ProviderRequest[] = [];
    const provider: LLMProvider = {
      name: 'stub',
      models: [{ id: 'stub-model', contextWindow: 200_000, maxOutputTokens: 1_000, supportsTools: false, supportsStreaming: true }],
      async *stream(req) {
        received.push(req);
        yield { type: 'message_start', model: 'stub-model' };
        yield { type: 'text_delta', delta: 'Asked: flights.' };
        yield { type: 'message_end', stopReason: 'end_turn' };
      },
      countTokens: async () => 0,
    };
    const events = history(['one-way please', 'next', 'and next', 'and the last one'], 2_400);
    await createSegmentsCompactor().compact(events, {
      log: reader(events), budget: budgetFor(events), signal: new AbortController().signal,
      provider, model: 'stub-model',
    });

    expect(received[0]?.system).toMatch(/^Settled: /m);
    expect(received[0]?.system).toMatch(/one-way or return/);
  });
});

describe('segments compactor: routine records', () => {
  it('marks the record of a finished turn as routine, so surfaces need not announce it', async () => {
    const events = history(['first', 'second', 'third', 'fourth'], 2_400);
    const record = await firstRecord(events, { summary: () => 'Asked: something.' });
    expect(record.routine).toBe(true);
  });

  it('does not mark a record written because the context is nearly full', async () => {
    const events = history(['first', 'second', 'third', 'fourth'], 2_400);
    const full = { contextWindow: 10_000, estimatedTokens: 9_000, reserveForOutput: 500 };
    const record = await firstRecord(events, { summary: () => 'Asked: something.' }, full);
    expect(record.tokensSaved).toBeGreaterThan(0);
    expect(record.routine).toBeUndefined();
  });

  it('marks a chapter fold as routine too', async () => {
    const s = session();
    for (let i = 0; i < 40; i++) await s.turn(`task ${i}`);
    const chapter = s.events.find((e) => e.type === 'compaction' && e.summary.startsWith('[chapter '));
    expect(chapter).toMatchObject({ routine: true });
  });
});

describe('session_recall', () => {
  it('finds the sub-session that mentions what the user is asking about', async () => {
    const compactor = createSegmentsCompactor({
      summary: (digest) => `record of: ${digest.slice(0, 300)}`,
    });
    const events: MoxxyEvent[] = [];
    let seq = 0;
    const topics = ['postgres migration plan', 'stripe webhook retries', 'icon set redesign'];
    for (let i = 0; i < topics.length + 3; i++) {
      const turnId = `t${i}` as never;
      events.push({
        id: `u${seq}` as never, seq: seq++, ts: 0, type: 'user_prompt',
        sessionId: 'sess' as never, turnId, source: 'user',
        text: `${topics[i] ?? 'unrelated chatter'} ${'d'.repeat(1_100)}`,
      } as MoxxyEvent);
      events.push({
        id: `a${seq}` as never, seq: seq++, ts: 0, type: 'assistant_message',
        sessionId: 'sess' as never, turnId, source: 'model',
        content: 'a'.repeat(1_200), stopReason: 'end_turn',
      } as MoxxyEvent);
      await settle(compactor, events, () => seq++);
    }

    const out = await sessionRecallTool.handler(
      { query: 'what did we decide about the stripe webhooks?', limit: 3 },
      { log: reader(events) } as never,
    );
    expect(typeof out).toBe('object');
    const matches = (out as { matches: Array<{ turnIds: string[]; record: string }> }).matches;
    expect(matches[0]!.record).toContain('stripe webhook retries');
    expect(matches[0]!.turnIds).toEqual(['t1']);
  });

  it('says so plainly when nothing has been recorded yet', async () => {
    const out = await sessionRecallTool.handler(
      { query: 'anything', limit: 4 },
      { log: reader([]) } as never,
    );
    expect(String(out)).toMatch(/still visible in your context/);
  });
});
