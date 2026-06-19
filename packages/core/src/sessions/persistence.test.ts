import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../events/log.js';
import type { Logger } from '../logger.js';
import {
  SessionPersistence,
  deleteSession,
  readEventPage,
  readIndex,
  restoreEvents,
  type SessionMeta,
} from './persistence.js';

interface CapturedLine {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly msg: string;
  readonly meta?: Record<string, unknown>;
}

function captureLogger(): { logger: Logger; lines: CapturedLine[] } {
  const lines: CapturedLine[] = [];
  const logger: Logger = {
    debug: (msg, meta) => lines.push({ level: 'debug', msg, meta }),
    info: (msg, meta) => lines.push({ level: 'info', msg, meta }),
    warn: (msg, meta) => lines.push({ level: 'warn', msg, meta }),
    error: (msg, meta) => lines.push({ level: 'error', msg, meta }),
    child: () => logger,
  };
  return { logger, lines };
}

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-sessions-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function meta(id: string, eventCount = 0): SessionMeta {
  return {
    id,
    cwd: '/tmp/project',
    startedAt: '2026-05-21T00:00:00.000Z',
    lastActivity: '2026-05-21T00:00:00.000Z',
    eventCount,
    firstPrompt: eventCount > 0 ? 'hello' : null,
    provider: null,
    model: null,
  };
}

describe('SessionPersistence', () => {
  it('readIndex ignores rows whose event log file is missing', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'present.jsonl'), '', 'utf8');
    await fs.writeFile(
      path.join(dir, 'index.json'),
      JSON.stringify([meta('missing'), meta('present')], null, 2),
      'utf8',
    );

    await expect(readIndex(dir)).resolves.toEqual([meta('present')]);
  });

  it('creates a resumable empty event log when a session is indexed before any events', async () => {
    const dir = await makeTempDir();
    const id = '01EMPTYSESSION000000000000';
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/project', dir });
    const detach = persistence.attach(new EventLog());

    await waitForFile(path.join(dir, `${id}.jsonl`));
    await expect(restoreEvents(id, dir)).resolves.toEqual([]);

    detach();
  });

  it('writes a per-session sidecar that readIndex assembles', async () => {
    const dir = await makeTempDir();
    const id = '01SIDECAR00000000000000000';
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });
    const detach = persistence.attach(new EventLog());
    await waitForFile(path.join(dir, `${id}.meta.json`));
    const ids = (await readIndex(dir)).map((m) => m.id);
    expect(ids).toContain(id);
    detach();
  });

  it('log.clear() truncates the JSONL so wiped history cannot resurrect on resume', async () => {
    const dir = await makeTempDir();
    const id = '01CLEARTRUNCATE00000000000';
    const log = new EventLog();
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });
    const detach = persistence.attach(log);

    await log.append({
      type: 'user_prompt',
      sessionId: id as never,
      turnId: 't1' as never,
      source: 'user',
      text: 'wiped by /new',
    });
    await waitForCondition(async () => (await restoreEvents(id, dir)).length === 1);

    // /new — the in-memory wipe must reach the sidecar.
    log.clear();
    await waitForCondition(async () => (await restoreEvents(id, dir)).length === 0);

    // Post-reset events land in the fresh file from seq 0, so a later
    // --resume restores exactly the new conversation (no duplicate seqs).
    await log.append({
      type: 'user_prompt',
      sessionId: id as never,
      turnId: 't2' as never,
      source: 'user',
      text: 'fresh start',
    });
    await waitForCondition(async () => (await restoreEvents(id, dir)).length === 1);
    const restored = await restoreEvents(id, dir);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.seq).toBe(0);
    expect((restored[0] as { text?: string }).text).toBe('fresh start');

    detach();
  });

  it('warns once (not per event) on event-log write failure, recovers on success', async () => {
    const dir = await makeTempDir();
    const id = '01WRITEFAIL000000000000000';
    // Make `<id>.jsonl` a DIRECTORY so fs.appendFile fails with EISDIR.
    await fs.mkdir(path.join(dir, `${id}.jsonl`), { recursive: true });

    const { logger, lines } = captureLogger();
    const log = new EventLog();
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir, logger });
    const detach = persistence.attach(log);

    const prompt = (text: string) =>
      log.append({ type: 'user_prompt', sessionId: id as never, turnId: 't1' as never, source: 'user', text });

    await prompt('first failing write');
    await prompt('second failing write');
    await waitForCondition(() => Promise.resolve(persistence.degraded));
    // Drain the queue so BOTH failing appends have actually been attempted (and
    // failed) before we remove the obstruction below — otherwise a still-queued
    // append could run after the rmdir and succeed, persisting an event the test
    // expects to have been lost (a scheduler-timing-dependent flake).
    await persistence.settleWrites();
    // Both appends failed, but the structured warning fired exactly once.
    await waitForCondition(() =>
      Promise.resolve(lines.some((l) => l.level === 'warn' && l.msg.includes('write failed'))),
    );
    const failureWarns = () =>
      lines.filter((l) => l.level === 'warn' && l.msg.includes('write failed'));
    expect(failureWarns()).toHaveLength(1);
    expect(failureWarns()[0]!.meta).toMatchObject({ path: path.join(dir, `${id}.jsonl`) });
    expect(failureWarns()[0]!.meta?.error).toBeTruthy();
    expect(persistence.degraded).toBe(true);

    // Remove the obstruction — the next successful write clears the degraded
    // latch (re-arming warn-once) and logs a recovery line.
    await fs.rmdir(path.join(dir, `${id}.jsonl`));
    await prompt('now it works');
    await waitForCondition(() => Promise.resolve(!persistence.degraded));
    expect(lines.some((l) => l.level === 'info' && l.msg.includes('recovered'))).toBe(true);
    expect(failureWarns()).toHaveLength(1);
    // The surviving event was minted at seq 2 (the first two appends were
    // lost to the failing disk) — restore re-sequences it to 0.
    const restored = await restoreEvents(id, dir, captureLogger().logger);
    expect(restored.map((e) => (e as { text?: string }).text)).toEqual(['now it works']);
    expect(restored[0]!.seq).toBe(0);

    detach();
  });

  it('restore re-sequences around a corrupt middle line and repairs the file on disk', async () => {
    const dir = await makeTempDir();
    const id = '01RESEQ0000000000000000000';
    const mk = (seq: number, text: string) => ({
      id: `e${seq}`,
      seq,
      ts: seq,
      sessionId: id,
      turnId: 't1',
      source: 'user',
      type: 'user_prompt',
      text,
    });
    // seq 2's line was corrupted on disk; 3 and 4 are intact.
    const lines = [
      JSON.stringify(mk(0, 'zero')),
      JSON.stringify(mk(1, 'one')),
      '{this line was corrupted',
      JSON.stringify(mk(3, 'three')),
      JSON.stringify(mk(4, 'four')),
    ];
    await fs.writeFile(path.join(dir, `${id}.jsonl`), lines.join('\n') + '\n', 'utf8');

    const { logger, lines: logged } = captureLogger();
    const restored = await restoreEvents(id, dir, logger);

    // Contiguous 0..n-1, order + ids + payloads preserved.
    expect(restored.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(restored.map((e) => e.id)).toEqual(['e0', 'e1', 'e3', 'e4']);
    expect(restored.map((e) => (e as { text?: string }).text)).toEqual([
      'zero',
      'one',
      'three',
      'four',
    ]);
    const gapWarn = logged.find((l) => l.level === 'warn');
    expect(gapWarn?.meta).toMatchObject({ corruptLines: 1, resequencedEvents: 2 });

    // Every restored event replays into a fresh mirror (ingest requires
    // seq === length) — nothing after the gap is dropped.
    const mirror = new EventLog();
    for (const e of restored) mirror.ingest(e);
    expect(mirror.length).toBe(4);
    expect((mirror.at(3) as { text?: string } | undefined)?.text).toBe('four');

    // The file was rewritten, so the NEXT restore is clean (no warning) and
    // new appends (seq = length) line up with what's on disk.
    const again = captureLogger();
    const second = await restoreEvents(id, dir, again.logger);
    expect(second.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(again.lines).toHaveLength(0);
  });

  it('rejects a path-traversal session id before touching the filesystem', async () => {
    const dir = await makeTempDir();
    // A secret file OUTSIDE the sessions dir that a traversal id would target.
    const secretName = `traversal-target-${Date.now()}.jsonl`;
    const secret = path.join(dir, '..', secretName);
    await fs.writeFile(secret, 'do not delete me', 'utf8');
    try {
      await expect(restoreEvents('../etc/passwd', dir)).rejects.toThrow(/invalid session id/i);
      await expect(readEventPage('a/../../b', { before: null, limit: 5 }, dir)).rejects.toThrow(
        /invalid session id/i,
      );
      // deleteSession uses force:true — a traversal delete would otherwise
      // silently succeed. The id resolving to our secret must be rejected so
      // the file stays intact.
      const evil = `..${path.sep}${secretName.replace(/\.jsonl$/, '')}`;
      await expect(deleteSession(evil, dir)).rejects.toThrow(/invalid session id/i);
      await expect(fs.readFile(secret, 'utf8')).resolves.toBe('do not delete me');
    } finally {
      await fs.rm(secret, { force: true });
    }
  });

  it('firstPrompt label is sliced on code-point boundaries (no split surrogate pair)', async () => {
    const dir = await makeTempDir();
    const id = '01SURROGATE0000000000000AA';
    const log = new EventLog();
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });
    const detach = persistence.attach(log);
    // 80 emoji (each a surrogate pair) + a trailing char. A naive
    // `slice(0, 80)` on UTF-16 code units would cut emoji #41 in half, leaving a
    // lone surrogate at the boundary.
    const text = '😀'.repeat(90) + 'x';
    await log.append({
      type: 'user_prompt',
      sessionId: id as never,
      turnId: 't1' as never,
      source: 'user',
      text,
    });
    await persistence.flush();
    const [row] = await readIndex(dir);
    const label = row!.firstPrompt!;
    // Exactly 80 code points, all whole emoji — the cut never split a surrogate
    // pair. A naive slice(0, 80) would yield 80 UTF-16 units = 40 emoji and the
    // label would round-trip fine, but the worst case (cut INSIDE a pair) is
    // what we guard: rebuild from code points must reproduce the label exactly.
    expect([...label]).toHaveLength(80);
    expect([...label].every((cp) => cp === '😀')).toBe(true);
    // No lone (unpaired) surrogate survives a JSON round-trip as itself.
    expect(JSON.parse(JSON.stringify(label))).toBe(label);

    detach();
  });

  it('two concurrent sessions both survive (no shared-index clobber)', async () => {
    const dir = await makeTempDir();
    const idA = '01AAAA00000000000000000001';
    const idB = '01BBBB00000000000000000002';
    const detachA = new SessionPersistence({ sessionId: idA as never, cwd: '/a', dir }).attach(
      new EventLog(),
    );
    const detachB = new SessionPersistence({ sessionId: idB as never, cwd: '/b', dir }).attach(
      new EventLog(),
    );
    await waitForFile(path.join(dir, `${idA}.meta.json`));
    await waitForFile(path.join(dir, `${idB}.meta.json`));
    const ids = (await readIndex(dir)).map((m) => m.id);
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
    detachA();
    detachB();
  });
});

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  for (;;) {
    try {
      await fs.access(file);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/** Poll an async predicate until it holds (writes are queued + debounced). */
async function waitForCondition(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      if (await predicate()) return;
    } catch {
      // file may not exist yet — keep polling
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
