import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { pageEvents, readEventPage, restoreEvents, seedSessionLog } from './persistence.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-page-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** A contiguous 0..n-1 log of user_prompt events with predictable text. */
function makeLog(n: number, sessionId = 'pagesession'): MoxxyEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    seq: i,
    ts: i,
    sessionId,
    turnId: `t${i}`,
    source: 'user',
    type: 'user_prompt',
    text: `m${i}`,
  })) as unknown as MoxxyEvent[];
}

async function writeLog(dir: string, id: string, events: MoxxyEvent[]): Promise<void> {
  const body = events.map((e) => JSON.stringify(e) + '\n').join('');
  await fs.writeFile(path.join(dir, `${id}.jsonl`), body, 'utf8');
}

describe('pageEvents (pure newest-first paging)', () => {
  it('newest page (before=null) returns the last `limit` events with a prevCursor', () => {
    const log = makeLog(10);
    const page = pageEvents(log, null, 3);
    expect(page.events.map((e) => e.seq)).toEqual([7, 8, 9]);
    // prevCursor is the seq of the oldest event in THIS page → pass it next.
    expect(page.prevCursor).toBe(7);
  });

  it('older page via prevCursor returns the events immediately preceding it', () => {
    const log = makeLog(10);
    const newest = pageEvents(log, null, 3); // [7,8,9], prevCursor 7
    const older = pageEvents(log, newest.prevCursor, 3);
    expect(older.events.map((e) => e.seq)).toEqual([4, 5, 6]);
    expect(older.prevCursor).toBe(4);
  });

  it('prevCursor is null once the page includes the start of history', () => {
    const log = makeLog(5);
    // Walk back from the newest until the start is reached.
    const p1 = pageEvents(log, null, 2); // [3,4] cursor 3
    expect(p1.prevCursor).toBe(3);
    const p2 = pageEvents(log, p1.prevCursor, 2); // [1,2] cursor 1
    expect(p2.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(p2.prevCursor).toBe(1);
    const p3 = pageEvents(log, p2.prevCursor, 2); // [0] — start reached
    expect(p3.events.map((e) => e.seq)).toEqual([0]);
    expect(p3.prevCursor).toBeNull();
  });

  it('limit larger than history returns the whole log and a null cursor', () => {
    const log = makeLog(4);
    const page = pageEvents(log, null, 100);
    expect(page.events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(page.prevCursor).toBeNull();
  });

  it('empty log returns no events and a null cursor regardless of before', () => {
    expect(pageEvents([], null, 5)).toEqual({ events: [], prevCursor: null });
    expect(pageEvents([], 3, 5)).toEqual({ events: [], prevCursor: null });
  });

  it('walking all pages reconstructs the full log exactly once, in order', () => {
    const log = makeLog(23);
    const collected: number[] = [];
    let before: number | null = null;
    // Guard the loop so a paging bug can't spin forever.
    for (let guard = 0; guard < 100; guard += 1) {
      const page: ReturnType<typeof pageEvents> = pageEvents(log, before, 5);
      collected.unshift(...page.events.map((e) => e.seq));
      if (page.prevCursor === null) break;
      before = page.prevCursor;
    }
    expect(collected).toEqual(log.map((e) => e.seq));
  });
});

describe('readEventPage (paged JSONL reader)', () => {
  it('pages the newest events off disk without materializing the whole log', async () => {
    const dir = await makeTempDir();
    const id = 'disk1';
    await writeLog(dir, id, makeLog(8, id));
    const page = await readEventPage(id, { before: null, limit: 3 }, dir);
    expect(page.events.map((e) => (e as { text?: string }).text)).toEqual(['m5', 'm6', 'm7']);
    expect(page.prevCursor).toBe(5);
  });

  it('steps to the older page via prevCursor', async () => {
    const dir = await makeTempDir();
    const id = 'disk2';
    await writeLog(dir, id, makeLog(8, id));
    const newest = await readEventPage(id, { before: null, limit: 3 }, dir);
    const older = await readEventPage(id, { before: newest.prevCursor, limit: 3 }, dir);
    expect(older.events.map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(older.prevCursor).toBe(2);
  });

  it('returns prevCursor=null at the start of history', async () => {
    const dir = await makeTempDir();
    const id = 'disk3';
    await writeLog(dir, id, makeLog(3, id));
    const page = await readEventPage(id, { before: 1, limit: 10 }, dir);
    expect(page.events.map((e) => e.seq)).toEqual([0]);
    expect(page.prevCursor).toBeNull();
  });

  it('treats a missing log file as empty history (no throw)', async () => {
    const dir = await makeTempDir();
    await expect(readEventPage('never-written', { before: null, limit: 5 }, dir)).resolves.toEqual({
      events: [],
      prevCursor: null,
    });
  });

  it('agrees with pageEvents on an empty/missing log for any before/limit (incl. limit 0)', async () => {
    // The disk reader delegates clamping to pageEvents, so the two paths cannot
    // diverge — pin it, including the limit===0 corner the wire schema forbids
    // but a direct in-process caller could still hit.
    const dir = await makeTempDir();
    for (const before of [null, 5] as const) {
      for (const limit of [0, 3]) {
        await expect(readEventPage('missing', { before, limit }, dir)).resolves.toEqual(
          pageEvents([], before, limit),
        );
      }
    }
  });

  it('skips a corrupt line and pages the survivors deterministically', async () => {
    const dir = await makeTempDir();
    const id = 'disk4';
    const events = makeLog(5, id);
    const body =
      events
        .slice(0, 2)
        .map((e) => JSON.stringify(e) + '\n')
        .join('') +
      '{not json\n' +
      events
        .slice(2)
        .map((e) => JSON.stringify(e) + '\n')
        .join('');
    await fs.writeFile(path.join(dir, `${id}.jsonl`), body, 'utf8');
    const page = await readEventPage(id, { before: null, limit: 10 }, dir);
    // The corrupt line is dropped; the four survivors page in seq order.
    expect(page.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(page.prevCursor).toBeNull();
  });

  it('does NOT rewrite the file on disk (read-only reader)', async () => {
    const dir = await makeTempDir();
    const id = 'disk5';
    // A gapped/corrupt log — restoreEvents would repair it, readEventPage must not.
    const body = '{corrupt\n' + makeLog(2, id).map((e) => JSON.stringify(e) + '\n').join('');
    await fs.writeFile(path.join(dir, `${id}.jsonl`), body, 'utf8');
    const before = await fs.readFile(path.join(dir, `${id}.jsonl`), 'utf8');
    await readEventPage(id, { before: null, limit: 10 }, dir);
    const after = await fs.readFile(path.join(dir, `${id}.jsonl`), 'utf8');
    expect(after).toBe(before);
  });
});

describe('seedSessionLog (NDJSON → runner-log migration)', () => {
  it('writes a fresh session log, re-sequenced to 0..n-1, ids + content preserved', async () => {
    const dir = await makeTempDir();
    // Gapped original seqs — as rendered events pulled from the desktop mirror
    // (which dropped the interleaved chunk/bookend events) would have.
    const events = [
      { id: 'a', seq: 3, ts: 0, sessionId: 'sess', turnId: 't0', source: 'user', type: 'user_prompt', text: 'q' },
      { id: 'b', seq: 7, ts: 1, sessionId: 'sess', turnId: 't0', source: 'model', type: 'assistant_message', content: 'reply' },
    ] as unknown as MoxxyEvent[];
    expect(await seedSessionLog('sess', events, dir)).toBe(true);
    // The runner restores it like any native log: contiguous seqs, ids preserved.
    const restored = await restoreEvents('sess', dir);
    expect(restored.map((e) => e.id)).toEqual(['a', 'b']);
    expect(restored.map((e) => e.seq)).toEqual([0, 1]);
    expect((restored[1] as { content?: string }).content).toBe('reply');
  });

  it('never overwrites a session the runner already owns', async () => {
    const dir = await makeTempDir();
    await writeLog(dir, 'sess', makeLog(2, 'sess')); // the runner already owns it
    expect(await seedSessionLog('sess', makeLog(5, 'sess'), dir)).toBe(false);
    const restored = await restoreEvents('sess', dir);
    expect(restored).toHaveLength(2); // untouched
  });

  it('is a no-op for an empty event list', async () => {
    const dir = await makeTempDir();
    expect(await seedSessionLog('sess', [], dir)).toBe(false);
  });
});
