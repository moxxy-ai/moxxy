import { constants as fsConstants, promises as fs, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MoxxyEvent, SessionId } from '@moxxy/sdk';
import { PRIVATE_FILE_MODE, writeFileAtomic } from '@moxxy/sdk/server';
import { removeDir } from '@moxxy/vitest-preset/fs';
import type { Logger } from '../logger.js';
import { isMoxxyEventShape } from './event-shape.js';
import { readLines } from './jsonl-lines.js';
import {
  pageEvents,
  readEventPage,
  readSessionMeta,
  restoreEvents,
  type EventPage,
  type SessionMeta,
} from './persistence.js';

// The session readers now read a log line by line instead of as one string.
// Below, the readers as they were before that change are kept verbatim as the
// reference, and every log in the corpus must give the same events, warnings,
// pages, index rows and repaired file bytes from both.

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeDir(dir)));
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-streaming-'));
  tempDirs.push(dir);
  return dir;
}

interface Line {
  readonly level: string;
  readonly msg: string;
  readonly meta?: Record<string, unknown>;
}

function captureLogger(): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  const logger: Logger = {
    debug: (msg, meta) => lines.push({ level: 'debug', msg, meta }),
    info: (msg, meta) => lines.push({ level: 'info', msg, meta }),
    warn: (msg, meta) => lines.push({ level: 'warn', msg, meta }),
    error: (msg, meta) => lines.push({ level: 'error', msg, meta }),
    child: () => logger,
  };
  return { logger, lines };
}

// ---- The readers before the change, kept verbatim as the reference ----------

function legacyEventBelongsToSession(event: MoxxyEvent, sessionId: string): boolean {
  const eventSessionId = (event as { sessionId?: unknown }).sessionId;
  return eventSessionId == null || eventSessionId === sessionId;
}

function legacyEventForSession(event: MoxxyEvent, sessionId: string): MoxxyEvent | null {
  if (!legacyEventBelongsToSession(event, sessionId)) return null;
  if ((event as { sessionId?: unknown }).sessionId === sessionId) return event;
  return { ...event, sessionId: sessionId as SessionId } as MoxxyEvent;
}

function legacyFirstPromptLabel(text: string): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  return [...s].slice(0, 80).join('');
}

function legacyProviderHeader(event: MoxxyEvent): { provider?: string | null; model?: string | null } {
  if (event.type !== 'provider_request' && event.type !== 'provider_response') return {};
  return { provider: event.provider, model: event.model };
}

async function legacyStats(sessionId: string, logPath: string) {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch {
    return null;
  }
  const events: MoxxyEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isMoxxyEventShape(parsed)) events.push(parsed);
    } catch {
      // skipped
    }
  }
  let eventCount = 0;
  let parsedEvents = 0;
  let firstPrompt: string | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  for (const event of events) {
    parsedEvents += 1;
    if (!legacyEventBelongsToSession(event, sessionId)) continue;
    eventCount += 1;
    if (firstPrompt === null && event.type === 'user_prompt') firstPrompt = legacyFirstPromptLabel(event.text);
    const header = legacyProviderHeader(event);
    if (header.provider !== undefined) provider = header.provider;
    if (header.model !== undefined) model = header.model;
  }
  return { eventCount, firstPrompt, parsedEvents, provider, model };
}

async function legacyHydrate(meta: SessionMeta, dir: string): Promise<SessionMeta> {
  const stats = await legacyStats(meta.id, path.join(dir, `${meta.id}.jsonl`));
  if (!stats) return meta;
  if (stats.parsedEvents === 0) return meta;
  return {
    ...meta,
    eventCount: stats.eventCount,
    firstPrompt: stats.firstPrompt,
    provider: stats.provider ?? meta.provider,
    model: stats.model ?? meta.model,
  };
}

async function legacyReadEventPage(
  sessionId: string,
  opts: { before: number | null; limit: number },
  dir: string,
): Promise<EventPage> {
  const logPath = path.join(dir, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch {
    return { events: [], prevCursor: null };
  }
  const all: MoxxyEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isMoxxyEventShape(parsed)) all.push(parsed);
    } catch {
      // skipped
    }
  }
  return pageEvents(all, opts.before, opts.limit);
}

async function legacyBackupForeign(logPath: string): Promise<void> {
  try {
    await fs.copyFile(logPath, `${logPath}.foreign-session.bak`, fsConstants.COPYFILE_EXCL);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw err;
  }
}

async function legacyRestoreEvents(sessionId: string, dir: string, logger: Logger): Promise<MoxxyEvent[]> {
  const logPath = path.join(dir, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const events: MoxxyEvent[] = [];
  let corruptLines = 0;
  let invalidShapeLines = 0;
  let foreignEvents = 0;
  let normalizedSessionIds = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isMoxxyEventShape(parsed)) {
        invalidShapeLines += 1;
        continue;
      }
      const ownedEvent = legacyEventForSession(parsed, sessionId);
      if (ownedEvent) {
        if (ownedEvent !== parsed) normalizedSessionIds += 1;
        events.push(ownedEvent);
      } else {
        foreignEvents += 1;
      }
    } catch {
      corruptLines += 1;
    }
  }
  let resequenced = 0;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i] as MoxxyEvent;
    if (event.seq !== i) {
      events[i] = { ...event, seq: i } as MoxxyEvent;
      resequenced += 1;
    }
  }
  if (corruptLines > 0 || invalidShapeLines > 0 || resequenced > 0 || foreignEvents > 0 || normalizedSessionIds > 0) {
    const message =
      foreignEvents > 0
        ? 'session log restored with foreign-session events removed — re-sequenced to keep full history replayable'
        : 'session log restored with gaps — re-sequenced to keep full history replayable';
    logger.warn(message, {
      sessionId,
      path: logPath,
      corruptLines,
      invalidShapeLines,
      foreignEvents,
      normalizedSessionIds,
      resequencedEvents: resequenced,
      restoredEvents: events.length,
    });
    let canRewrite = true;
    if (foreignEvents > 0) {
      try {
        await legacyBackupForeign(logPath);
      } catch (err) {
        canRewrite = false;
        logger.warn('failed to backup foreign-session log before repair', {
          sessionId,
          path: logPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    try {
      const current = await fs.readFile(logPath, 'utf8').catch(() => null);
      if (!canRewrite) {
        /* skipped */
      } else if (current !== raw) {
        logger.warn('skipped repaired-log rewrite — file changed under us (another process attached?)', {
          sessionId,
          path: logPath,
        });
      } else {
        const repaired = events.map((e) => JSON.stringify(e) + '\n').join('');
        await writeFileAtomic(logPath, repaired, { mode: PRIVATE_FILE_MODE });
      }
    } catch (err) {
      logger.warn('failed to rewrite repaired session log on disk', {
        sessionId,
        path: logPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return events;
}

// ---- Corpus ------------------------------------------------------------------

const SID = '01STREAMINGSESSION0000000';

function ev(seq: number, fields: Record<string, unknown>, sessionId: string | null = SID): string {
  return JSON.stringify({
    id: `e${seq}-${String(fields.type)}`,
    seq,
    ts: 1_700_000_000_000 + seq,
    ...(sessionId === null ? {} : { sessionId }),
    turnId: 't1',
    source: 'system',
    ...fields,
  });
}

const prompt = (seq: number, text: string, sid: string | null = SID): string => ev(seq, { type: 'user_prompt', source: 'user', text }, sid);
const request = (seq: number, provider: string, model: string): string => ev(seq, { type: 'provider_request', provider, model });
const response = (seq: number, provider: string, model: string): string =>
  ev(seq, { type: 'provider_response', provider, model, inputTokens: 1, outputTokens: 1 });
const toolResult = (seq: number, size: number): string =>
  ev(seq, { type: 'tool_result', callId: `c${seq}`, ok: true, output: 'y'.repeat(size) });

const text = (lines: string[], end = '\n'): Uint8Array => new TextEncoder().encode(lines.join('\n') + end);

const CORPUS: Record<string, Uint8Array> = {
  empty: new Uint8Array(0),
  'blank lines only': text(['', '   ', '\t']),
  clean: text([prompt(0, 'Zażółć gęślą jaźń 🚀 '.repeat(10)), request(1, 'p1', 'm1'), response(2, 'p2', 'm2'), toolResult(3, 5000)]),
  'no trailing newline': text([prompt(0, 'hello'), response(1, 'p', 'm')], ''),
  crlf: new TextEncoder().encode([prompt(0, 'crlf'), response(1, 'p', 'm'), ''].join('\r\n')),
  'bom on the first line': new TextEncoder().encode('﻿' + [prompt(0, 'bom'), prompt(1, 'after bom')].join('\n') + '\n'),
  gapped: text([prompt(0, 'a'), prompt(2, 'b'), response(5, 'p', 'm')]),
  'corrupt middle line': text([prompt(0, 'a'), '{"broken', prompt(2, 'c')]),
  'wrong-shape lines': text([prompt(0, 'a'), JSON.stringify({ hello: 'world' }), ev(2, { type: 'compaction' }), prompt(3, 'd')]),
  'foreign events': text([prompt(0, 'mine'), prompt(1, 'theirs', 'SOMEONE-ELSE'), response(2, 'p', 'm')]),
  'foreign only': text([prompt(0, 'theirs', 'SOMEONE-ELSE')]),
  'unstamped events': text([prompt(0, 'no id', null), response(1, 'p', 'm')]),
  'unknown future type': text([prompt(0, 'a'), ev(1, { type: 'from_the_future', payload: 1 })]),
  'invalid utf-8 in a line': Uint8Array.from([...text([prompt(0, 'ok')]), 0x7b, 0xe2, 0x82, 0x0a, ...text([prompt(1, 'after')])]),
  'large lines': text([prompt(0, 'big'), toolResult(1, 2_000_000), toolResult(2, 1_500_000), prompt(3, 'end')]),
  'many small lines': text(Array.from({ length: 3000 }, (_, i) => (i % 3 === 0 ? prompt(i, `p${i}`) : response(i, 'p', `m${i}`)))),
};

function sidecar(fields: Partial<SessionMeta> = {}): string {
  return JSON.stringify({
    version: 1,
    id: SID,
    cwd: '/tmp/project',
    startedAt: '2026-11-16T00:00:00.000Z',
    lastActivity: '2026-11-16T00:00:01.000Z',
    eventCount: 9,
    firstPrompt: 'from sidecar',
    provider: 'sidecar-provider',
    model: 'sidecar-model',
    ...fields,
  });
}

async function twoCopies(bytes: Uint8Array): Promise<{ oldDir: string; newDir: string }> {
  const oldDir = await makeTempDir();
  const newDir = await makeTempDir();
  for (const dir of [oldDir, newDir]) {
    await fs.writeFile(path.join(dir, `${SID}.jsonl`), bytes);
    await fs.writeFile(path.join(dir, `${SID}.json`), sidecar());
  }
  return { oldDir, newDir };
}

function withoutDir(lines: Line[], dir: string): Line[] {
  return JSON.parse(JSON.stringify(lines).split(JSON.stringify(dir).slice(1, -1)).join('<dir>')) as Line[];
}

async function filesIn(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await fs.readdir(dir)).sort()) {
    out[name] = (await fs.readFile(path.join(dir, name))).toString('base64');
  }
  return out;
}

describe('session readers give the same results line by line as whole-file', () => {
  for (const [name, bytes] of Object.entries(CORPUS)) {
    it(`restoreEvents: ${name}`, async () => {
      const { oldDir, newDir } = await twoCopies(bytes);
      const before = captureLogger();
      const after = captureLogger();
      const expected = await legacyRestoreEvents(SID, oldDir, before.logger);
      const actual = await restoreEvents(SID, newDir, after.logger);
      expect(actual).toEqual(expected);
      expect(withoutDir(after.lines, newDir)).toEqual(withoutDir(before.lines, oldDir));
      expect(await filesIn(newDir)).toEqual(await filesIn(oldDir));
    });

    it(`readEventPage: ${name}`, async () => {
      const { oldDir, newDir } = await twoCopies(bytes);
      for (const [before, limit] of [[null, 1], [null, 2], [null, 50], [2, 1], [3, 10], [1, 5], [10_000, 3]] as const) {
        expect(await readEventPage(SID, { before, limit }, newDir)).toEqual(
          await legacyReadEventPage(SID, { before, limit }, oldDir),
        );
      }
    });

    it(`index row: ${name}`, async () => {
      const { oldDir, newDir } = await twoCopies(bytes);
      const meta = JSON.parse(sidecar()) as SessionMeta;
      expect(await readSessionMeta(SID, newDir)).toEqual(await legacyHydrate(meta, oldDir));
    });
  }

  it('a missing log reads as before', async () => {
    const dir = await makeTempDir();
    await expect(restoreEvents(SID, dir)).rejects.toThrow(`Session not found: ${SID}`);
    await expect(readEventPage(SID, { before: null, limit: 5 }, dir)).resolves.toEqual({ events: [], prevCursor: null });
  });

  it.each(['append', 'same-size edit', 'trailing newline'])('preserves a concurrent %s instead of repairing over it', async (change) => {
    const dir = await makeTempDir();
    const file = path.join(dir, `${SID}.jsonl`);
    const original = prompt(2, 'old') + '\n';
    const updated = change === 'append'
      ? original + prompt(3, 'new') + '\n'
      : change === 'same-size edit' ? original.replace('old', 'new') : original.slice(0, -1);
    await fs.writeFile(file, original);
    const captured = captureLogger();
    const logger: Logger = {
      ...captured.logger,
      warn(message, meta) {
        captured.logger.warn(message, meta);
        if (message.startsWith('session log restored')) writeFileSync(file, updated);
      },
    };
    expect(await restoreEvents(SID, dir, logger)).toHaveLength(1);
    expect(await fs.readFile(file, 'utf8')).toBe(updated);
    expect(captured.lines.some((line) => line.msg.startsWith('skipped repaired-log rewrite'))).toBe(true);
  });
});

// A log longer than the longest string Node can hold (about 512 MiB) used to
// read as missing: the conversation opened empty and its history page was
// blank. It writes ~540 MiB, so it runs only with MOXXY_SCALE_TESTS=1.
describe.skipIf(!process.env['MOXXY_SCALE_TESTS'])('a session log over the string limit', () => {
  it('restores, pages and indexes the whole conversation', async () => {
    const dir = await makeTempDir();
    const handle = await fs.open(path.join(dir, `${SID}.jsonl`), 'w');
    const output = 'z'.repeat(1024 * 1024);
    const events = 540;
    try {
      await handle.write(prompt(0, 'first prompt') + '\n');
      for (let seq = 1; seq < events; seq += 1) {
        await handle.write(ev(seq, { type: 'tool_result', callId: `c${seq}`, ok: true, output }) + '\n');
      }
    } finally {
      await handle.close();
    }
    await fs.writeFile(path.join(dir, `${SID}.json`), sidecar({ eventCount: 0, firstPrompt: null }));
    expect((await fs.stat(path.join(dir, `${SID}.jsonl`))).size).toBeGreaterThan(536_870_888);

    const restored = await restoreEvents(SID, dir);
    expect(restored).toHaveLength(events);
    expect(restored.at(-1)?.seq).toBe(events - 1);

    const page = await readEventPage(SID, { before: null, limit: 3 }, dir);
    expect(page.events.map((e) => e.seq)).toEqual([events - 3, events - 2, events - 1]);

    expect(await readSessionMeta(SID, dir)).toMatchObject({ eventCount: events, firstPrompt: 'first prompt' });

    // The recovery path must also write more than one JS string can hold,
    // preserving every event and leaving no failed-repair warning or temp file.
    await fs.appendFile(path.join(dir, `${SID}.jsonl`), '{broken\n');
    const captured = captureLogger();
    expect(await restoreEvents(SID, dir, captured.logger)).toHaveLength(events);
    expect(captured.lines.map((line) => line.msg)).toEqual([
      'session log restored with gaps — re-sequenced to keep full history replayable',
    ]);
    let lines = 0;
    for await (const line of readLines(path.join(dir, `${SID}.jsonl`))) {
      if (!line) continue;
      expect(JSON.parse(line).seq).toBe(lines++);
    }
    expect(lines).toBe(events);
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  }, 300_000);
});
