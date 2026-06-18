import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MoxxyEvent } from '@moxxy/sdk';
import {
  appendEvents,
  loadSegment,
  clearLog,
  migrate,
  seedChatIntoSession,
  migrateAllChatsToSessions,
} from './chat-log';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'moxxy-chatlog-'));
  process.env['MOXXY_CHATS_DIR'] = dir;
});

afterEach(async () => {
  delete process.env['MOXXY_CHATS_DIR'];
  await rm(dir, { recursive: true, force: true });
});

const ev = (i: number): MoxxyEvent =>
  ({ id: `e${i}`, type: 'user_prompt', text: `m${i}`, seq: i, ts: i, turnId: 'T', sessionId: 'S', source: 'user' }) as unknown as MoxxyEvent;

describe('chat-log NDJSON backend', () => {
  it('appends and loads the tail oldest-first', async () => {
    await appendEvents('w1', [ev(0), ev(1), ev(2)]);
    const seg = await loadSegment('w1', null, 10);
    expect(seg.events.map((e) => (e as { text: string }).text)).toEqual(['m0', 'm1', 'm2']);
    expect(seg.prevCursor).toBeNull();
  });

  it('appends never rewrite old lines (true append-only)', async () => {
    await appendEvents('w1', [ev(0)]);
    await appendEvents('w1', [ev(1)]);
    await appendEvents('w1', [ev(2)]);
    const seg = await loadSegment('w1', null, 10);
    expect(seg.events).toHaveLength(3);
  });

  it('paginates backwards with the cursor', async () => {
    await appendEvents('w1', Array.from({ length: 10 }, (_, i) => ev(i)));
    const tail = await loadSegment('w1', null, 4);
    expect(tail.events.map((e) => (e as { text: string }).text)).toEqual(['m6', 'm7', 'm8', 'm9']);
    expect(tail.prevCursor).toBe(6);
    const older = await loadSegment('w1', tail.prevCursor, 4);
    expect(older.events.map((e) => (e as { text: string }).text)).toEqual(['m2', 'm3', 'm4', 'm5']);
    expect(older.prevCursor).toBe(2);
    const oldest = await loadSegment('w1', older.prevCursor, 4);
    expect(oldest.events.map((e) => (e as { text: string }).text)).toEqual(['m0', 'm1']);
    expect(oldest.prevCursor).toBeNull();
  });

  it('returns empty for an unknown workspace', async () => {
    const seg = await loadSegment('nope', null, 10);
    expect(seg.events).toEqual([]);
    expect(seg.prevCursor).toBeNull();
  });

  it('clearLog truncates', async () => {
    await appendEvents('w1', [ev(0)]);
    await clearLog('w1');
    expect((await loadSegment('w1', null, 10)).events).toEqual([]);
  });

  it('migrate seeds new logs but never clobbers an existing one', async () => {
    await appendEvents('w1', [ev(99)]); // pre-existing
    await migrate([
      { workspaceId: 'w1', events: [ev(0)] }, // should be skipped
      { workspaceId: 'w2', events: [ev(5), ev(6)] }, // should be seeded
    ]);
    expect((await loadSegment('w1', null, 10)).events.map((e) => (e as { text: string }).text)).toEqual(['m99']);
    expect((await loadSegment('w2', null, 10)).events.map((e) => (e as { text: string }).text)).toEqual(['m5', 'm6']);
  });

  it('is idempotent by event id — a replayed history is not duplicated', async () => {
    // First "session": three events land live.
    await appendEvents('w1', [ev(0), ev(1), ev(2)]);
    // Simulate a restart: the runner replays the full history (same ids) and
    // the renderer re-appends every event. None should be written twice.
    await appendEvents('w1', [ev(0), ev(1), ev(2)]);
    await appendEvents('w1', [ev(0), ev(1), ev(2)]);
    const seg = await loadSegment('w1', null, 10);
    expect(seg.events.map((e) => (e as { text: string }).text)).toEqual(['m0', 'm1', 'm2']);
    expect(seg.prevCursor).toBeNull();
  });

  it('writes only the fresh events when a batch overlaps the log', async () => {
    await appendEvents('w1', [ev(0), ev(1)]);
    // A batch that replays e1 and adds e2 + e3 — only e2/e3 are new.
    await appendEvents('w1', [ev(1), ev(2), ev(3)]);
    const seg = await loadSegment('w1', null, 10);
    expect(seg.events.map((e) => (e as { text: string }).text)).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('keeps the pagination cursor stable across a re-appended history', async () => {
    await appendEvents('w1', Array.from({ length: 10 }, (_, i) => ev(i)));
    const before = await loadSegment('w1', null, 4);
    // Re-append the whole history (restart replay) — line count must not grow,
    // so the line-index cursor still points at the same boundary.
    await appendEvents('w1', Array.from({ length: 10 }, (_, i) => ev(i)));
    const after = await loadSegment('w1', null, 4);
    expect(after.events.map((e) => (e as { text: string }).text)).toEqual(
      before.events.map((e) => (e as { text: string }).text),
    );
    expect(after.prevCursor).toBe(before.prevCursor);
  });

  it('clearLog resets idempotency so the same ids can be written again', async () => {
    await appendEvents('w1', [ev(0), ev(1)]);
    await clearLog('w1');
    await appendEvents('w1', [ev(0), ev(1)]);
    const seg = await loadSegment('w1', null, 10);
    expect(seg.events.map((e) => (e as { text: string }).text)).toEqual(['m0', 'm1']);
  });

  it('dedupes against events already on disk from a previous process (cold cache)', async () => {
    // Write the log directly, as a prior process would, so the in-memory cache
    // never saw these ids — appendEvents must hydrate from the file and dedupe.
    const fs = await import('node:fs/promises');
    const file = path.join(dir, 'w3.jsonl');
    await fs.writeFile(file, [ev(0), ev(1)].map((e) => JSON.stringify(e)).join('\n') + '\n');
    await appendEvents('w3', [ev(0), ev(1), ev(2)]);
    const seg = await loadSegment('w3', null, 10);
    expect(seg.events.map((e) => (e as { text: string }).text)).toEqual(['m0', 'm1', 'm2']);
  });

  it('skips corrupt lines instead of losing the transcript', async () => {
    await appendEvents('w1', [ev(0)]);
    const file = path.join(dir, 'w1.jsonl');
    const body = await readFile(file, 'utf8');
    await import('node:fs/promises').then((fs) => fs.writeFile(file, body + 'not json\n' + JSON.stringify(ev(1)) + '\n'));
    const seg = await loadSegment('w1', null, 10);
    expect(seg.events.map((e) => (e as { text: string }).text)).toEqual(['m0', 'm1']);
  });

  it('keeps cursors stable when corrupt lines sit between pages', async () => {
    // Corrupt line in the middle: the cursor space must count only valid
    // event lines, exactly like the pre-index implementation did.
    const fs = await import('node:fs/promises');
    const file = path.join(dir, 'w1.jsonl');
    const lines = [ev(0), ev(1)].map((e) => JSON.stringify(e)).join('\n') + '\n' +
      '{broken\n' +
      [ev(2), ev(3)].map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.writeFile(file, lines);
    const tail = await loadSegment('w1', null, 2);
    expect(tail.events.map((e) => (e as { text: string }).text)).toEqual(['m2', 'm3']);
    expect(tail.prevCursor).toBe(2);
    const older = await loadSegment('w1', tail.prevCursor, 2);
    expect(older.events.map((e) => (e as { text: string }).text)).toEqual(['m0', 'm1']);
    expect(older.prevCursor).toBeNull();
  });

  it('pages from the cached line index without re-parsing the whole file', async () => {
    const { vi } = await import('vitest');
    await appendEvents('w1', Array.from({ length: 50 }, (_, i) => ev(i)));
    // First load builds the index (one full parse of the file).
    await loadSegment('w1', null, 5);
    const spy = vi.spyOn(JSON, 'parse');
    try {
      const tail = await loadSegment('w1', null, 5);
      const older = await loadSegment('w1', tail.prevCursor, 5);
      expect(tail.events.map((e) => (e as { text: string }).text)).toEqual(['m45', 'm46', 'm47', 'm48', 'm49']);
      expect(older.events.map((e) => (e as { text: string }).text)).toEqual(['m40', 'm41', 'm42', 'm43', 'm44']);
      // Two pages of 5 → at most 10 line parses, NOT 2×50 whole-file parses.
      expect(spy.mock.calls.length).toBeLessThanOrEqual(10);
    } finally {
      spy.mockRestore();
    }
  });

  it('line index stays correct across appends (cache extended, results identical)', async () => {
    await appendEvents('w1', Array.from({ length: 10 }, (_, i) => ev(i)));
    await loadSegment('w1', null, 4); // build + cache the index
    await appendEvents('w1', [ev(10), ev(11)]);
    const tail = await loadSegment('w1', null, 4);
    expect(tail.events.map((e) => (e as { text: string }).text)).toEqual(['m8', 'm9', 'm10', 'm11']);
    expect(tail.prevCursor).toBe(8);
    const older = await loadSegment('w1', tail.prevCursor, 4);
    expect(older.events.map((e) => (e as { text: string }).text)).toEqual(['m4', 'm5', 'm6', 'm7']);
  });

  it('line index invalidates on clearLog', async () => {
    await appendEvents('w1', [ev(0), ev(1)]);
    await loadSegment('w1', null, 10); // warm the index
    await clearLog('w1');
    expect((await loadSegment('w1', null, 10)).events).toEqual([]);
    await appendEvents('w1', [ev(5)]);
    expect((await loadSegment('w1', null, 10)).events.map((e) => (e as { text: string }).text)).toEqual(['m5']);
  });

  it('line index invalidates when the file changes out-of-band (size/mtime guard)', async () => {
    const fs = await import('node:fs/promises');
    await appendEvents('w1', [ev(0), ev(1)]);
    await loadSegment('w1', null, 10); // warm the index
    const file = path.join(dir, 'w1.jsonl');
    await fs.writeFile(file, JSON.stringify(ev(7)) + '\n');
    const seg = await loadSegment('w1', null, 10);
    expect(seg.events.map((e) => (e as { text: string }).text)).toEqual(['m7']);
  });
});

describe('chat-log concurrency (per-file write mutex)', () => {
  /** Every byte offset loadSegment derives must land on a parseable line. */
  const assertCursorsConsistent = async (workspaceId: string, expectedCount: number): Promise<void> => {
    // Walk the whole cursor space one event at a time — each single-event page
    // must parse cleanly, proving no offset points mid-line (a corrupted cursor
    // would either throw or skip/duplicate a line).
    const seen: string[] = [];
    let cursor: number | null = null;
    for (let guard = 0; guard <= expectedCount + 1; guard += 1) {
      const page: { events: MoxxyEvent[]; prevCursor: number | null } = await loadSegment(workspaceId, cursor, 1);
      if (page.events.length === 0) break;
      seen.unshift((page.events[0] as { id: string }).id);
      if (page.prevCursor === null) break;
      cursor = page.prevCursor;
    }
    expect(seen).toHaveLength(expectedCount);
    // No duplicate ids and every line decoded.
    expect(new Set(seen).size).toBe(expectedCount);
  };

  it('concurrent appends of disjoint batches lose no lines and keep cursors consistent', async () => {
    // Fire many overlapping appends for the SAME workspace in one tick. Without
    // the mutex they would read the same pre-append size and clobber each
    // other's line-index offsets / dedup set.
    const batches = Array.from({ length: 8 }, (_, b) =>
      appendEvents('w1', [ev(b * 2), ev(b * 2 + 1)]),
    );
    await Promise.all(batches);

    const seg = await loadSegment('w1', null, 100);
    expect(seg.events).toHaveLength(16);
    // Same total via a fresh process-view: the raw file has exactly 16 lines.
    const raw = await readFile(path.join(dir, 'w1.jsonl'), 'utf8');
    expect(raw.split('\n').filter((l) => l.length > 0)).toHaveLength(16);
    await assertCursorsConsistent('w1', 16);
  });

  it('concurrent appends sharing an id write exactly one copy of it', async () => {
    // Two overlapping batches both carry the shared id e0 plus disjoint fresh
    // ids. Serialised dedup → e0 appears once, both fresh ids land.
    await Promise.all([
      appendEvents('w1', [ev(0), ev(1)]),
      appendEvents('w1', [ev(0), ev(2)]),
    ]);
    const seg = await loadSegment('w1', null, 100);
    const ids = seg.events.map((e) => (e as { id: string }).id).sort();
    expect(ids).toEqual(['e0', 'e1', 'e2']);
    await assertCursorsConsistent('w1', 3);
  });

  it('overlapping appends extend the warmed line index without desync', async () => {
    // Warm the index first so concurrent appends exercise the extend-in-place
    // path (the one that reads idx.size before the write).
    await appendEvents('w1', [ev(0), ev(1)]);
    await loadSegment('w1', null, 10);
    await Promise.all([
      appendEvents('w1', [ev(2), ev(3)]),
      appendEvents('w1', [ev(4), ev(5)]),
      appendEvents('w1', [ev(6), ev(7)]),
    ]);
    const seg = await loadSegment('w1', null, 100);
    expect(seg.events).toHaveLength(8);
    await assertCursorsConsistent('w1', 8);
  });

  it('an append racing clearLog resolves cleanly (no half-cleared state)', async () => {
    await appendEvents('w1', [ev(0), ev(1)]);
    // Fire a clear and an append in the same tick. The mutex serialises them, so
    // whichever runs second sees a consistent file — the result is either the
    // appended events on top of a fresh log, or an empty log, never a corrupt
    // cursor space.
    await Promise.all([clearLog('w1'), appendEvents('w1', [ev(2), ev(3)])]);
    const seg = await loadSegment('w1', null, 100);
    // No corrupt/duplicated lines whatever the interleave landed on.
    const ids = seg.events.map((e) => (e as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
    await assertCursorsConsistent('w1', ids.length);
  });
});

describe('seedChatIntoSession (NDJSON → runner session migration)', () => {
  let sessionsDir: string;
  beforeEach(async () => {
    sessionsDir = await mkdtemp(path.join(tmpdir(), 'moxxy-sessions-'));
  });
  afterEach(async () => {
    await rm(sessionsDir, { recursive: true, force: true });
  });

  it('seeds the runner session log from the NDJSON mirror when the runner has none', async () => {
    await appendEvents('w1', [ev(0), ev(1), ev(2)]);
    expect(await seedChatIntoSession('w1', sessionsDir)).toBe(true);
    const body = await readFile(path.join(sessionsDir, 'w1.jsonl'), 'utf8');
    const lines = body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { text: string; seq: number });
    expect(lines.map((e) => e.text)).toEqual(['m0', 'm1', 'm2']);
    expect(lines.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('never overwrites a NON-EMPTY session the runner already owns; leaves the NDJSON intact', async () => {
    await appendEvents('w1', [ev(0)]);
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(path.join(sessionsDir, 'w1.jsonl'), '{"existing":true}\n', 'utf8');
    expect(await seedChatIntoSession('w1', sessionsDir)).toBe(false);
    expect(await readFile(path.join(sessionsDir, 'w1.jsonl'), 'utf8')).toBe('{"existing":true}\n');
    // NDJSON untouched — still the read fallback.
    expect((await loadSegment('w1', null, 10)).events).toHaveLength(1);
  });

  it('seeds over a 0-byte session log left by a prior spawn (the key migration case)', async () => {
    await appendEvents('w1', [ev(0), ev(1)]);
    await mkdir(sessionsDir, { recursive: true });
    // persistence.attach creates this empty file on every spawn — existence
    // alone must NOT block the seed.
    await writeFile(path.join(sessionsDir, 'w1.jsonl'), '', 'utf8');
    expect(await seedChatIntoSession('w1', sessionsDir)).toBe(true);
    const lines = (await readFile(path.join(sessionsDir, 'w1.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it('is a no-op when the workspace has no NDJSON history', async () => {
    expect(await seedChatIntoSession('never-chatted', sessionsDir)).toBe(false);
  });

  it('eagerly migrates every NDJSON-only chat, skipping ones the runner already owns', async () => {
    await appendEvents('w1', [ev(0), ev(1)]);
    await appendEvents('w2', [ev(0)]);
    await appendEvents('w3', [ev(0)]);
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(path.join(sessionsDir, 'w3.jsonl'), '{"owned":true}\n', 'utf8'); // runner owns w3
    expect(await migrateAllChatsToSessions(sessionsDir)).toBe(2); // w1 + w2, not w3
    expect(await readFile(path.join(sessionsDir, 'w3.jsonl'), 'utf8')).toBe('{"owned":true}\n');
    expect((await readFile(path.join(sessionsDir, 'w1.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(2);
    expect((await readFile(path.join(sessionsDir, 'w2.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('returns 0 when there are no NDJSON chats to migrate', async () => {
    expect(await migrateAllChatsToSessions(sessionsDir)).toBe(0);
  });
});
