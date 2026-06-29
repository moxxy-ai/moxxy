import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../events/log.js';
import type { Logger } from '../logger.js';
import {
  SessionPersistence,
  defaultSessionsDir,
  deleteSession,
  readEventPage,
  readIndex,
  listSessionMetas,
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
  it('honors MOXXY_HOME for the default sessions directory', async () => {
    const original = process.env.MOXXY_HOME;
    const home = await makeTempDir();
    process.env.MOXXY_HOME = home;
    try {
      expect(defaultSessionsDir()).toBe(path.join(home, 'sessions'));
    } finally {
      if (original === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = original;
    }
  });

  it('readIndex ignores rows whose event log file is missing', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    // `present` has a metadata file AND an event log; `missing` has only the
    // metadata file. readIndex drops the one whose `.jsonl` is gone.
    await fs.writeFile(path.join(dir, 'present.jsonl'), '', 'utf8');
    await fs.writeFile(path.join(dir, 'present.json'), JSON.stringify(meta('present')), 'utf8');
    await fs.writeFile(path.join(dir, 'missing.json'), JSON.stringify(meta('missing')), 'utf8');

    await expect(readIndex(dir)).resolves.toEqual([meta('present')]);
  });

  it('readIndex recovers a missing firstPrompt from the event log', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    const id = '01HYDRATEPROMPT0000000000';
    await fs.writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify({ ...meta(id, 3), firstPrompt: null }, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, `${id}.jsonl`),
      JSON.stringify({
        id: 'e1',
        seq: 0,
        ts: 1,
        sessionId: id,
        turnId: 't1',
        source: 'user',
        type: 'user_prompt',
        text: 'restored from log',
      }) + '\n',
      'utf8',
    );

    const [restored] = await readIndex(dir);

    expect(restored?.firstPrompt).toBe('restored from log');
  });

  it('hydrates stale sidecar stats when attaching to a restored log', async () => {
    const dir = await makeTempDir();
    const id = '01RESTOREDMETAHYDRATE00000';
    const restoredLog = new EventLog([
      {
        id: 'e1',
        seq: 0,
        ts: 1,
        sessionId: id as never,
        turnId: 't1' as never,
        source: 'user',
        type: 'user_prompt',
        text: 'restored prompt becomes sidebar title',
      },
      {
        id: 'e2',
        seq: 1,
        ts: 2,
        sessionId: id as never,
        turnId: 't1' as never,
        source: 'system',
        type: 'provider_request',
        provider: 'openai-codex',
        model: 'gpt-5.5',
      },
    ]);
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });
    const detach = persistence.attach(restoredLog);

    await persistence.flush();
    const sidecar = JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8')) as SessionMeta;

    expect(sidecar).toMatchObject({
      id,
      eventCount: 2,
      firstPrompt: 'restored prompt becomes sidebar title',
      provider: 'openai-codex',
      model: 'gpt-5.5',
    });

    detach();
  });

  it('keeps user-owned title and groupId when hydrating restored log stats', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    const id = '01RESTOREDKEEPSTITLE000000';
    await fs.writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify(
        {
          ...meta(id),
          title: 'Manual title',
          groupId: 'desk-a',
          firstPrompt: null,
          eventCount: 0,
        },
        null,
        2,
      ),
      'utf8',
    );
    const restoredLog = new EventLog([
      {
        id: 'e1',
        seq: 0,
        ts: 1,
        sessionId: id as never,
        turnId: 't1' as never,
        source: 'user',
        type: 'user_prompt',
        text: 'automatic prompt title',
      },
    ]);
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });
    const detach = persistence.attach(restoredLog);

    await persistence.flush();
    const sidecar = JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8')) as SessionMeta;

    expect(sidecar).toMatchObject({
      title: 'Manual title',
      groupId: 'desk-a',
      firstPrompt: 'automatic prompt title',
      eventCount: 1,
    });

    detach();
  });

  it('readIndex refreshes provider and model from the latest provider event', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    const id = '01HYDRATEPROVIDER00000000';
    await fs.writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify({ ...meta(id, 2), provider: 'old-provider', model: 'old-model' }, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, `${id}.jsonl`),
      [
        JSON.stringify({
          id: 'e1',
          seq: 0,
          ts: 1,
          sessionId: id,
          turnId: 't1',
          source: 'system',
          type: 'provider_request',
          provider: 'first-provider',
          model: 'first-model',
        }),
        JSON.stringify({
          id: 'e2',
          seq: 1,
          ts: 2,
          sessionId: id,
          turnId: 't1',
          source: 'system',
          type: 'provider_response',
          provider: 'session-provider',
          model: 'session-model',
          inputTokens: 1,
          outputTokens: 1,
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    const [restored] = await readIndex(dir);

    expect(restored).toMatchObject({
      provider: 'session-provider',
      model: 'session-model',
    });
  });

  it('deduplicates canonical and legacy metadata files by session id', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    const id = '01DEDUPMETA00000000000000';
    await fs.writeFile(path.join(dir, `${id}.jsonl`), '', 'utf8');
    await fs.writeFile(
      path.join(dir, `${id}.meta.json`),
      JSON.stringify({ ...meta(id), title: 'Legacy title', firstPrompt: 'legacy prompt', eventCount: 1 }),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify({ ...meta(id), title: 'Canonical title', firstPrompt: 'canonical prompt', eventCount: 2 }),
      'utf8',
    );

    const rows = await listSessionMetas(dir);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      title: 'Canonical title',
      firstPrompt: 'canonical prompt',
      eventCount: 2,
    });
  });

  it('readIndex preserves a sidecar firstPrompt when the event log is still empty', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    const id = '01SIDECARPROMPT0000000000';
    await fs.writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify({ ...meta(id, 2), firstPrompt: 'sidecar title', eventCount: 2 }, null, 2),
      'utf8',
    );
    await fs.writeFile(path.join(dir, `${id}.jsonl`), '', 'utf8');

    const [restored] = await readIndex(dir);

    expect(restored?.firstPrompt).toBe('sidecar title');
    expect(restored?.eventCount).toBe(2);
  });

  it('readIndex uses only matching-session prompts when hydrating titles', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    const id = '01MATCHPROMPT000000000000';
    await fs.writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify({ ...meta(id, 2), firstPrompt: 'foreign title', eventCount: 2 }, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, `${id}.jsonl`),
      [
        {
          id: 'foreign',
          seq: 0,
          ts: 1,
          sessionId: 'other-session',
          turnId: 't1',
          source: 'user',
          type: 'user_prompt',
          text: 'foreign title',
        },
        {
          id: 'matching',
          seq: 1,
          ts: 2,
          sessionId: id,
          turnId: 't2',
          source: 'user',
          type: 'user_prompt',
          text: 'real matching title',
        },
      ].map((event) => JSON.stringify(event)).join('\n') + '\n',
      'utf8',
    );

    const [restored] = await readIndex(dir);

    expect(restored?.firstPrompt).toBe('real matching title');
    expect(restored?.eventCount).toBe(1);
  });

  it('readIndex does not hydrate a visible title from a foreign-only log', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(dir, { recursive: true });
    const id = '01FOREIGNONLY00000000000';
    await fs.writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify({ ...meta(id, 1), firstPrompt: 'foreign prompt', eventCount: 1 }, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, `${id}.jsonl`),
      JSON.stringify({
        id: 'foreign',
        seq: 0,
        ts: 1,
        sessionId: 'other-session',
        turnId: 't1',
        source: 'user',
        type: 'user_prompt',
        text: 'foreign prompt',
      }) + '\n',
      'utf8',
    );

    const [restored] = await readIndex(dir);

    expect(restored?.firstPrompt).toBeNull();
    expect(restored?.eventCount).toBe(0);
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
    await waitForFile(path.join(dir, `${id}.json`));
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

  it('does not persist foreign-session events into the current session log', async () => {
    const dir = await makeTempDir();
    const id = '01CURRENTSESSION0000000000';
    const log = new EventLog();
    const { logger, lines } = captureLogger();
    const persistence = new SessionPersistence({
      sessionId: id as never,
      cwd: '/tmp/p',
      dir,
      logger,
    });
    const detach = persistence.attach(log);

    await log.append({
      type: 'user_prompt',
      sessionId: 'other-session' as never,
      turnId: 't1' as never,
      source: 'user',
      text: 'should not persist',
    });

    await waitForCondition(async () =>
      lines.some((line) => line.level === 'warn' && line.msg.includes('foreign-session')),
    );
    await waitForCondition(async () => (await readIndex(dir))[0]?.id === id);

    expect(await restoreEvents(id, dir)).toEqual([]);
    expect((await readIndex(dir))[0]).toMatchObject({ eventCount: 0, firstPrompt: null });

    detach();
  });

  it('normalizes legacy in-memory events without sessionId to the current session before persisting', async () => {
    const dir = await makeTempDir();
    const id = '01LEGACYNOSESSION00000000';
    const log = new EventLog();
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir });
    const detach = persistence.attach(log);

    await log.append({
      type: 'user_prompt',
      turnId: 't1' as never,
      source: 'user',
      text: 'legacy prompt without session id',
    } as never);

    await waitForCondition(async () => (await restoreEvents(id, dir)).length === 1);
    const [event] = await restoreEvents(id, dir);
    await waitForCondition(async () => (await readIndex(dir))[0]?.eventCount === 1);

    expect(event?.sessionId).toBe(id);
    expect((await readIndex(dir))[0]).toMatchObject({
      id,
      eventCount: 1,
      firstPrompt: 'legacy prompt without session id',
    });

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

  it('restore removes foreign-session events, creates a backup, and re-sequences survivors', async () => {
    const dir = await makeTempDir();
    const id = '01RESTOREFILTER000000000';
    await fs.mkdir(dir, { recursive: true });
    const logPath = path.join(dir, `${id}.jsonl`);
    const events = [
      {
        id: 'foreign',
        seq: 0,
        ts: 1,
        sessionId: 'other-session',
        turnId: 't1',
        source: 'user',
        type: 'user_prompt',
        text: 'foreign prompt',
      },
      {
        id: 'matching',
        seq: 5,
        ts: 2,
        sessionId: id,
        turnId: 't2',
        source: 'user',
        type: 'user_prompt',
        text: 'matching prompt',
      },
    ];
    await fs.writeFile(logPath, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');

    const { logger, lines } = captureLogger();
    const restored = await restoreEvents(id, dir, logger);

    expect(restored.map((event) => event.id)).toEqual(['matching']);
    expect(restored.map((event) => event.seq)).toEqual([0]);
    expect(lines.some((line) => line.level === 'warn' && line.msg.includes('foreign-session'))).toBe(true);
    await expect(fs.access(`${logPath}.foreign-session.bak`)).resolves.toBeUndefined();
    const repaired = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(repaired.map((event) => event.id)).toEqual(['matching']);
    expect(repaired.map((event) => event.seq)).toEqual([0]);
  });

  it('restore rewrites a foreign-only log to an empty session with a backup', async () => {
    const dir = await makeTempDir();
    const id = '01RESTOREEMPTY0000000000';
    await fs.mkdir(dir, { recursive: true });
    const logPath = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(
      logPath,
      JSON.stringify({
        id: 'foreign',
        seq: 0,
        ts: 1,
        sessionId: 'other-session',
        turnId: 't1',
        source: 'user',
        type: 'user_prompt',
        text: 'foreign prompt',
      }) + '\n',
      'utf8',
    );

    const restored = await restoreEvents(id, dir, captureLogger().logger);

    expect(restored).toEqual([]);
    expect(await fs.readFile(logPath, 'utf8')).toBe('');
    await expect(fs.access(`${logPath}.foreign-session.bak`)).resolves.toBeUndefined();
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

  it('a user_prompt with a non-string text does not crash the persistence listener', async () => {
    const dir = await makeTempDir();
    const id = '01BADTEXT00000000000000000';
    const { logger } = captureLogger();
    const log = new EventLog();
    const persistence = new SessionPersistence({ sessionId: id as never, cwd: '/tmp/p', dir, logger });
    const detach = persistence.attach(log);

    // A hostile / hand-built event whose `text` is not a string. `firstPromptLabel`
    // runs `[...text]` inside the log listener chain — without the coercion this
    // throws, latching the misleading "persistence degraded" warning and dropping
    // the row. It must instead degrade gracefully (label coerced, write succeeds).
    await log.append({
      type: 'user_prompt',
      sessionId: id as never,
      turnId: 't1' as never,
      source: 'user',
      text: null as unknown as string,
    });
    await persistence.flush();
    await persistence.settleWrites();

    // The disk write was not poisoned by the bad label.
    expect(persistence.degraded).toBe(false);
    const [row] = await readIndex(dir);
    expect(row?.id).toBe(id);
    expect(typeof row?.firstPrompt).toBe('string');

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
    await waitForFile(path.join(dir, `${idA}.json`));
    await waitForFile(path.join(dir, `${idB}.json`));
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
