import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EventLog } from './log.js';
import { asSessionId, asTurnId, asToolCallId } from '@moxxy/sdk';

const sid = asSessionId('s1');
const tid = asTurnId('t1');

describe('EventLog', () => {
  it('appends events and assigns seq + id', async () => {
    const log = new EventLog();
    const a = await log.append({
      type: 'user_prompt',
      sessionId: sid,
      turnId: tid,
      source: 'user',
      text: 'hello',
    });
    const b = await log.append({
      type: 'assistant_message',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      content: 'hi',
      stopReason: 'end_turn',
    });
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(a.id).not.toBe(b.id);
    expect(log.length).toBe(2);
  });

  it('filters via ofType', async () => {
    const log = new EventLog();
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'a' });
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'b' });
    await log.append({
      type: 'assistant_message',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      content: '',
      stopReason: 'end_turn',
    });
    const prompts = log.ofType('user_prompt');
    expect(prompts).toHaveLength(2);
    expect(prompts[0].text).toBe('a');
  });

  it('filters by turnId', async () => {
    const log = new EventLog();
    const t2 = asTurnId('t2');
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'a' });
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: t2, source: 'user', text: 'b' });
    expect(log.byTurn(tid)).toHaveLength(1);
    expect(log.byTurn(t2)).toHaveLength(1);
  });

  it('notifies subscribers and supports unsubscribe', async () => {
    const log = new EventLog();
    const listener = vi.fn();
    const off = log.subscribe(listener);
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'x' });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'y' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('survives listener throws', async () => {
    const log = new EventLog();
    log.subscribe(() => {
      throw new Error('boom');
    });
    await expect(
      log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'x' }),
    ).resolves.toBeDefined();
  });

  it('does not hang the append when a listener never resolves (bounded watchdog)', async () => {
    vi.useFakeTimers();
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const log = new EventLog();
      // A listener that never settles must not block append forever.
      log.subscribe(() => new Promise<void>(() => {}));
      const fast = vi.fn();
      log.subscribe(fast);

      const pending = log.append({
        type: 'user_prompt',
        sessionId: sid,
        turnId: tid,
        source: 'user',
        text: 'x',
      });

      // Drive the watchdog past its window; the hung listener is abandoned and
      // the fan-out continues to the next (fast) listener.
      await vi.advanceTimersByTimeAsync(31_000);
      await expect(pending).resolves.toBeDefined();
      expect(fast).toHaveBeenCalledTimes(1);
      expect(stderr).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      vi.useRealTimers();
    }
  });

  it('clears the watchdog timer for a fast async listener (no leaked timers)', async () => {
    vi.useFakeTimers();
    try {
      const log = new EventLog();
      const fast = vi.fn(async () => {});
      log.subscribe(fast);
      await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'x' });
      expect(fast).toHaveBeenCalledTimes(1);
      // A fast listener settles immediately; no watchdog timer should remain.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('seeds preserve existing events but new appends start at length()', async () => {
    const seedLog = new EventLog();
    const e1 = await seedLog.append({
      type: 'user_prompt',
      sessionId: sid,
      turnId: tid,
      source: 'user',
      text: 'seed',
    });
    const replay = new EventLog([e1]);
    expect(replay.length).toBe(1);
    const next = await replay.append({
      type: 'assistant_message',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      content: '',
      stopReason: 'end_turn',
    });
    expect(next.seq).toBe(1);
  });

  it('seeding a tail slice aligns base to seed[0].seq (seq-addressing stays correct)', async () => {
    // u39-2: a log seeded with events that start above seq 0 must align its
    // base so at()/slice()/ingest() address by seq, not by raw array index.
    const seedLog = new EventLog();
    // Build three events at seq 0..2, then seed a new log with the tail (5,6,7).
    const tail: Array<Awaited<ReturnType<EventLog['append']>>> = [];
    for (let i = 0; i < 8; i += 1) {
      const e = await seedLog.append({
        type: 'user_prompt',
        sessionId: sid,
        turnId: tid,
        source: 'user',
        text: `e${i}`,
      });
      if (i >= 5) tail.push(e);
    }
    const log = new EventLog(tail);
    expect(log.baseSeq).toBe(5);
    expect(log.length).toBe(3);
    // seq-addressed lookups line up with the original seqs.
    expect(log.at(5)).toBe(tail[0]);
    expect(log.at(7)).toBe(tail[2]);
    expect(log.at(4)).toBeUndefined();
    expect(log.slice(6).map((e) => e.seq)).toEqual([6, 7]);
    // ingest() of the next contiguous seq (8) is accepted.
    const next = await seedLog.append({
      type: 'user_prompt',
      sessionId: sid,
      turnId: tid,
      source: 'user',
      text: 'e8',
    });
    expect(next.seq).toBe(8);
    log.ingest(next);
    expect(log.at(8)).toBe(next);
  });

  it('toJSON exposes a copy', async () => {
    const log = new EventLog();
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'a' });
    const json = log.toJSON();
    expect(json).toHaveLength(1);
    // proven via reference inequality after another append
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'b' });
    expect(json).toHaveLength(1);
    expect(log.length).toBe(2);
  });

  it('ingest preserves the original id/seq/ts and de-dupes by seq', async () => {
    const source = new EventLog();
    const ev = await source.append({
      type: 'user_prompt',
      sessionId: sid,
      turnId: tid,
      source: 'user',
      text: 'mirrored',
    });

    const mirror = new EventLog();
    const seen: number[] = [];
    mirror.subscribe((e) => seen.push(e.seq));
    mirror.ingest(ev);
    // Same identity preserved (not re-materialized).
    expect(mirror.length).toBe(1);
    expect(mirror.at(ev.seq)).toBe(ev);
    expect(mirror.at(ev.seq)?.id).toBe(ev.id);
    // Re-ingesting the same seq is a no-op (idempotent replay/overlap).
    mirror.ingest(ev);
    expect(mirror.length).toBe(1);
    expect(seen).toEqual([ev.seq]);
  });

  it('clear empties the log, fires onClear, and re-arms ingest at seq 0', async () => {
    const source = new EventLog();
    const before = await source.append({
      type: 'user_prompt',
      sessionId: sid,
      turnId: tid,
      source: 'user',
      text: 'pre-reset',
    });

    const mirror = new EventLog();
    mirror.ingest(before);
    const cleared = vi.fn();
    const off = mirror.onClear(cleared);
    mirror.clear();
    expect(mirror.length).toBe(0);
    expect(cleared).toHaveBeenCalledTimes(1);

    // Post-reset events restart at seq 0 — an empty mirror accepts them.
    source.clear();
    const after = await source.append({
      type: 'user_prompt',
      sessionId: sid,
      turnId: tid,
      source: 'user',
      text: 'post-reset',
    });
    expect(after.seq).toBe(0);
    mirror.ingest(after);
    expect(mirror.length).toBe(1);
    expect(mirror.at(0)?.id).toBe(after.id);

    off();
    mirror.clear();
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('ingest survives a rejecting async listener (same swallow policy as append)', async () => {
    const source = new EventLog();
    const ev = await source.append({
      type: 'user_prompt',
      sessionId: sid,
      turnId: tid,
      source: 'user',
      text: 'mirrored',
    });

    // append(): an async listener rejection is awaited + swallowed.
    const appender = new EventLog();
    appender.subscribe(async () => {
      throw new Error('async boom (append)');
    });
    await expect(
      appender.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'x' }),
    ).resolves.toBeDefined();

    // ingest(): the same rejection must NOT become an unhandled rejection
    // (vitest fails the run on one), and ingestion must continue to later
    // listeners and later events.
    const mirror = new EventLog();
    const seen: number[] = [];
    mirror.subscribe(async () => {
      throw new Error('async boom (ingest)');
    });
    mirror.subscribe((e) => {
      seen.push(e.seq);
    });
    expect(() => mirror.ingest(ev)).not.toThrow();
    expect(mirror.length).toBe(1);
    expect(seen).toEqual([ev.seq]);
    // Let the rejected listener promise settle inside this test's scope.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('rebase lets an empty mirror ingest a partial (tail) replay contiguously', async () => {
    // Author a few events so we have authoritative seqs to mirror.
    const source = new EventLog();
    const events = [];
    for (const text of ['a', 'b', 'c', 'd']) {
      events.push(await source.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text }));
    }

    // A mirror primed by `replay: { tail: 2 }` — the runner announces fromSeq 2.
    const mirror = new EventLog();
    mirror.rebase(2);
    expect(mirror.baseSeq).toBe(2);

    // Below-base events (already-seen history) are dropped, not mis-indexed.
    mirror.ingest(events[0]!);
    expect(mirror.length).toBe(0);
    // A gap (seq 3 before seq 2) is refused.
    mirror.ingest(events[3]!);
    expect(mirror.length).toBe(0);
    // The contiguous tail lands, seq-addressed reads line up with the source.
    mirror.ingest(events[2]!);
    mirror.ingest(events[3]!);
    expect(mirror.length).toBe(2);
    expect(mirror.at(2)?.id).toBe(events[2]!.id);
    expect(mirror.at(3)?.id).toBe(events[3]!.id);
    expect(mirror.at(0)).toBeUndefined();
    expect(mirror.slice().map((e) => e.seq)).toEqual([2, 3]);
    expect(mirror.slice(3)).toHaveLength(1);
    // New appends continue at base + length (seq stays authoritative).
    const next = await mirror.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'e' });
    expect(next.seq).toBe(4);
  });

  it('rebase throws on a non-empty log and on an invalid seq', async () => {
    const log = new EventLog();
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'x' });
    expect(() => log.rebase(5)).toThrow(/already holds/);
    const empty = new EventLog();
    expect(() => empty.rebase(-1)).toThrow(/non-negative/);
    expect(() => empty.rebase(1.5)).toThrow(/non-negative integer/);
  });

  it('clear resets the rebase so post-reset events restart at seq 0', async () => {
    const source = new EventLog();
    await source.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'old' });

    const mirror = new EventLog();
    mirror.rebase(1); // attached with replay 'none' after one event
    mirror.clear(); // session.reset
    expect(mirror.baseSeq).toBe(0);

    source.clear();
    const fresh = await source.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'new' });
    expect(fresh.seq).toBe(0);
    mirror.ingest(fresh);
    expect(mirror.length).toBe(1);
    expect(mirror.at(0)?.id).toBe(fresh.id);
  });

  it('clear survives a throwing onClear listener', () => {
    const log = new EventLog();
    log.onClear(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    log.onClear(ok);
    expect(() => log.clear()).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  // ensure unused import is exercised for typecheck stability
  void z;
  void asToolCallId;
});

describe('EventLog indexed ofType/byTurn equal the naive filter (property test)', () => {
  // The lazy type/turn indexes must return arrays deep-equal to the prior
  // `events.filter(...)` for ANY sequence of append/ingest/rebase/clear — same
  // matching events, same append order, fresh copy each call.
  const turns = [asTurnId('t1'), asTurnId('t2'), asTurnId('t3')];

  // A tiny deterministic PRNG so the "random" sequences are reproducible.
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904329) >>> 0;
      return s / 0x100000000;
    };
  }

  // Reference oracle: the exact semantics ofType/byTurn had before the index.
  const naiveOfType = (events: ReadonlyArray<{ type: string }>, type: string) =>
    events.filter((e) => e.type === type);
  const naiveByTurn = (events: ReadonlyArray<{ turnId: unknown }>, turnId: unknown) =>
    events.filter((e) => e.turnId === turnId);

  function mkPartial(rand: () => number) {
    const turnId = turns[Math.floor(rand() * turns.length)]!;
    const kind = rand();
    if (kind < 0.34) {
      return { type: 'user_prompt', sessionId: sid, turnId, source: 'user', text: 'u' } as const;
    }
    if (kind < 0.67) {
      return {
        type: 'assistant_message',
        sessionId: sid,
        turnId,
        source: 'model',
        content: 'a',
        stopReason: 'end_turn',
      } as const;
    }
    return {
      type: 'tool_call_requested',
      sessionId: sid,
      turnId,
      source: 'model',
      callId: asToolCallId(`c${Math.floor(rand() * 1000)}`),
      name: rand() < 0.5 ? 'load_tool' : 'Read',
      input: { name: 'x' },
    } as const;
  }

  const checkInvariant = (log: EventLog, mirror: { type: string; turnId: unknown }[]) => {
    for (const t of ['user_prompt', 'assistant_message', 'tool_call_requested', 'elision']) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(log.ofType(t as any)).toEqual(naiveOfType(mirror, t));
    }
    for (const tid2 of [...turns, asTurnId('absent')]) {
      expect(log.byTurn(tid2)).toEqual(naiveByTurn(mirror, tid2));
    }
  };

  it('append-driven authoring log matches the filter at every step', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rand = rng(seed);
      const log = new EventLog();
      const mirror: { type: string; turnId: unknown }[] = [];
      const steps = 5 + Math.floor(rand() * 40);
      for (let i = 0; i < steps; i++) {
        // Occasionally clear mid-stream to exercise the index reset.
        if (rand() < 0.06 && mirror.length > 0) {
          log.clear();
          mirror.length = 0;
          checkInvariant(log, mirror);
          continue;
        }
        const ev = await log.append(mkPartial(rand));
        mirror.push(ev);
        // Query (cold→warm and warm) every few appends so the lazy build,
        // first-query, and incremental-maintenance paths all get exercised.
        if (i % 3 === 0) checkInvariant(log, mirror);
      }
      checkInvariant(log, mirror);
    }
  });

  it('ingest-driven mirror (with rebase) matches the filter at every step', async () => {
    for (let seed = 100; seed <= 110; seed++) {
      const rand = rng(seed);
      // Author an authoritative source so seqs are real.
      const source = new EventLog();
      const authored: MoxxyEventForTest[] = [];
      const n = 5 + Math.floor(rand() * 40);
      for (let i = 0; i < n; i++) {
        authored.push((await source.append(mkPartial(rand))) as MoxxyEventForTest);
      }
      // Mirror rebased to a random tail start, then ingest from there.
      const start = Math.floor(rand() * authored.length);
      const mirror = new EventLog();
      mirror.rebase(authored[start]!.seq);
      const mirrorRef: { type: string; turnId: unknown }[] = [];
      for (let i = start; i < authored.length; i++) {
        // Throw in a duplicate ingest occasionally — must be de-duped (no
        // double-indexing) so the index still equals the filter.
        if (rand() < 0.2 && i > start) mirror.ingest(authored[i - 1]!);
        mirror.ingest(authored[i]!);
        mirrorRef.push(authored[i]!);
        if (i % 2 === 0) checkInvariant(mirror, mirrorRef);
      }
      checkInvariant(mirror, mirrorRef);
      // A clear re-arms at seq 0; fresh ingests still index correctly.
      mirror.clear();
      mirrorRef.length = 0;
      source.clear();
      const fresh = (await source.append(mkPartial(rand))) as MoxxyEventForTest;
      mirror.ingest(fresh);
      mirrorRef.push(fresh);
      checkInvariant(mirror, mirrorRef);
    }
  });

  it('seeded (cold) log builds the index lazily and matches the filter', async () => {
    // A log constructed from a seed array must index correctly on first query
    // (the build runs over the pre-existing array, not just future appends).
    const author = new EventLog();
    const seed: MoxxyEventForTest[] = [];
    const rand = rng(7);
    for (let i = 0; i < 20; i++) seed.push((await author.append(mkPartial(rand))) as MoxxyEventForTest);
    const log = new EventLog(seed);
    const mirror = [...seed] as { type: string; turnId: unknown }[];
    checkInvariant(log, mirror);
    // A further append on top of the warmed index must extend correctly.
    const more = await log.append(mkPartial(rand));
    mirror.push(more);
    checkInvariant(log, mirror);
  });

  // ofType/byTurn must hand back a defensive copy (the old filter() did), so a
  // caller mutating the result can't corrupt the index.
  it('returns a fresh array the caller cannot use to mutate the index', async () => {
    const log = new EventLog();
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'a' });
    const first = log.ofType('user_prompt');
    (first as unknown[]).push('garbage');
    expect(log.ofType('user_prompt')).toHaveLength(1);
    const byT = log.byTurn(tid);
    (byT as unknown[]).push('garbage');
    expect(log.byTurn(tid)).toHaveLength(1);
  });
});

type MoxxyEventForTest = { seq: number } & Record<string, unknown>;
