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
