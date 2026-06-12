/**
 * Session persistence — appends each event in `session.log` to a
 * per-session JSONL file under `~/.moxxy/sessions/`, and maintains an
 * `index.json` of session metadata so `moxxy resume` can list and
 * pick a prior session without scanning every event file.
 *
 * Layout:
 *   ~/.moxxy/sessions/
 *     <sessionId>.meta.json      per-session metadata sidecar (one per session)
 *     <sessionId>.jsonl          one MoxxyEvent per line
 *
 * Each session writes only its OWN `.meta.json` sidecar (write-temp-rename), so
 * two concurrent moxxy processes can't drop each other's row the way a shared
 * `index.json` read-modify-write would. `readIndex` assembles the sidecars (and
 * a legacy `index.json`, if present, for back-compat). JSONL appends are
 * best-effort (lose at most the last in-flight event on a crash).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createMutex, type Mutex, type MoxxyEvent, type SessionId } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import type { EventLog } from '../events/log.js';
import { createLogger, type Logger } from '../logger.js';

export interface SessionMeta {
  readonly id: string;
  readonly cwd: string;
  readonly startedAt: string;
  readonly lastActivity: string;
  readonly eventCount: number;
  /** First 80 chars of the first user_prompt. Used as the picker label. */
  readonly firstPrompt: string | null;
  readonly provider: string | null;
  readonly model: string | null;
}

export interface SessionPersistenceOpts {
  readonly sessionId: SessionId;
  readonly cwd: string;
  /** Override the storage root. Defaults to `~/.moxxy/sessions`. */
  readonly dir?: string;
  /** Currently-active provider name — captured into the index for the picker. */
  readonly providerName?: string;
  /** Currently-active model id — captured into the index for the picker. */
  readonly modelId?: string;
  /**
   * Structured logger for persistence-degradation warnings. Defaults to a
   * stderr JSON logger — event-log write failures are the session's source
   * of truth going dark, so they must be loud even when nothing injects one.
   */
  readonly logger?: Logger;
}

export function defaultSessionsDir(): string {
  return moxxyPath('sessions');
}

/**
 * Attaches a listener that streams every appended event to disk and
 * keeps the index in sync. Returns an `unsubscribe` callback the
 * caller should run on shutdown.
 */
export class SessionPersistence {
  private readonly dir: string;
  private readonly id: string;
  private readonly logPath: string;
  private meta: SessionMeta;
  private indexUpdateScheduled = false;
  /** Handle for the in-flight debounce timer, so `flush()` can cancel it. */
  private indexTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * In-flight writes are serialized through this mutex so the file
   * stays append-ordered even when events arrive faster than the disk
   * can flush.
   */
  private writeQueue: Mutex = createMutex();
  /**
   * Memoized one-time setup: `mkdir -p` the sessions dir and create the empty
   * `.jsonl` (so resume lists the session before any event). Awaited by both
   * `attach` and `writeIndex` so an early debounced index flush can't race the
   * initial creation — but it runs the open+close syscalls ONCE, not on every
   * 250ms flush as before.
   */
  private ready: Promise<void> | null = null;
  private closed = false;
  private readonly logger: Logger;
  /**
   * Latched while event-log writes are failing. Doubles as the warn-once
   * gate: only the first failure of a streak logs; a subsequent successful
   * write clears the latch (and re-arms the warning).
   */
  private writeDegraded = false;

  constructor(opts: SessionPersistenceOpts) {
    this.dir = opts.dir ?? defaultSessionsDir();
    this.id = String(opts.sessionId);
    this.logger = opts.logger ?? createLogger();
    this.logPath = path.join(this.dir, `${this.id}.jsonl`);
    const now = new Date().toISOString();
    this.meta = {
      id: this.id,
      cwd: opts.cwd,
      startedAt: now,
      lastActivity: now,
      eventCount: 0,
      firstPrompt: null,
      provider: opts.providerName ?? null,
      model: opts.modelId ?? null,
    };
  }

  /**
   * Subscribe to the log; returns the unsubscribe callback. The first
   * call also writes the initial index row so `moxxy resume` lists
   * the session before any events arrive.
   *
   * Also subscribes to the log's `clear()`, truncating the JSONL in
   * lockstep so a `/new` wipe can't resurrect on `--resume`. The
   * session keeps its id and file: post-reset events restart at seq 0
   * in the same (now empty) JSONL, matching how the in-memory log
   * reuses the same Session object.
   */
  attach(log: EventLog): () => void {
    void this.ensureReady()
      .then(() => this.scheduleIndexWrite())
      .catch(() => undefined);
    const unsub = log.subscribe((event) => {
      if (this.closed) return;
      this.enqueueAppend(event);
    });
    const unsubClear = log.onClear(() => {
      if (this.closed) return;
      this.enqueueTruncate();
    });
    return () => {
      this.closed = true;
      unsub();
      unsubClear();
      // Schedule a final index write so lastActivity reflects the close time
      // even if no events arrived in the last debounce window. This is the
      // best-effort, fire-and-forget path; the debounce timer is `unref`'d, so
      // a process that exits immediately after detach would drop it. Shutdown
      // paths that MUST not lose the final row should `await persistence.flush()`
      // instead — it bypasses the debounce and resolves once the row is on disk.
      this.scheduleIndexWrite();
    };
  }

  /**
   * Force the pending (debounced) index write to happen now and resolve once
   * the meta sidecar is on disk. Cancels the in-flight debounce timer so the
   * write isn't also re-run on its original schedule. Intended for awaitable
   * shutdown: `detach()` only *schedules* the final write (an `unref`'d timer
   * an immediate `process.exit` can drop), whereas `await flush()` guarantees
   * it completed. The steady-state debounce in `scheduleIndexWrite` is
   * untouched, so calling this mid-session just collapses the next write early.
   */
  async flush(): Promise<void> {
    if (this.indexTimer) {
      clearTimeout(this.indexTimer);
      this.indexTimer = null;
    }
    this.indexUpdateScheduled = false;
    await this.writeIndex();
  }

  /**
   * Resolve once every event-log write queued so far has settled. Appends are
   * enqueued fire-and-forget (`enqueueAppend`), so callers that need to observe
   * the on-disk result of prior appends — graceful shutdown, or a test that
   * mutates the filesystem between writes — await this to drain the queue
   * rather than guessing at timing. Enqueues a no-op at the tail of the same
   * mutex, so it can only resolve after all earlier appends/truncates have run.
   */
  async settleWrites(): Promise<void> {
    await this.writeQueue.run(() => undefined);
  }

  /**
   * Manually update header fields (provider/model) when the user
   * switches mid-session. The /model picker calls this so the index
   * reflects the active model when the session is resumed.
   */
  updateHeader(patch: { providerName?: string; modelId?: string }): void {
    this.meta = {
      ...this.meta,
      provider: patch.providerName ?? this.meta.provider,
      model: patch.modelId ?? this.meta.model,
    };
    this.scheduleIndexWrite();
  }

  private enqueueAppend(event: MoxxyEvent): void {
    // Update in-memory meta synchronously so multiple events in the
    // same tick share one debounced index write.
    this.meta = {
      ...this.meta,
      eventCount: this.meta.eventCount + 1,
      lastActivity: new Date().toISOString(),
      firstPrompt:
        this.meta.firstPrompt ??
        (event.type === 'user_prompt' ? event.text.slice(0, 80) : null),
    };
    this.scheduleIndexWrite();
    const line = JSON.stringify(event) + '\n';
    // Never propagate a write error into the listener chain — but never
    // swallow it silently either: the JSONL is the session's source of
    // truth, so a failing disk must at least be loud.
    //
    // Serialize the append behind `ensureReady()` (memoized mkdir -p + open):
    // `fs.appendFile` with flag 'a' creates the FILE but not its parent dir, so
    // a first event that arrives before `attach()`'s detached `ensureReady()`
    // resolves on a machine without `~/.moxxy/sessions` would ENOENT, latch the
    // misleading "persistence degraded" warning, and lose that event. Because
    // `ready` is memoized, every later append pays nothing.
    void this.writeQueue
      .run(() => this.ensureReady().then(() => fs.appendFile(this.logPath, line, 'utf8')))
      .then(() => this.noteWriteOk())
      .catch((err: unknown) => this.noteWriteFailure('append', err));
  }

  /**
   * True while event-log writes are failing (history is no longer being
   * persisted). Cleared automatically by the next successful write.
   */
  get degraded(): boolean {
    return this.writeDegraded;
  }

  private noteWriteOk(): void {
    if (!this.writeDegraded) return;
    this.writeDegraded = false;
    this.logger.info('session event-log writes recovered', { path: this.logPath });
  }

  private noteWriteFailure(op: 'append' | 'truncate', err: unknown): void {
    const alreadyDegraded = this.writeDegraded;
    this.writeDegraded = true;
    if (alreadyDegraded) return; // warn once per failure streak, not per event
    this.logger.warn(
      'session event-log write failed — history persistence degraded (resume will miss these events)',
      {
        op,
        path: this.logPath,
        sessionId: this.id,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  /**
   * Mirror a `log.clear()` on disk: truncate the JSONL and reset the
   * sidecar's counters. Rides the same write queue as appends, so
   * pre-clear appends flush first and post-clear appends land in the
   * fresh (empty) file — ordering matches the in-memory log exactly.
   */
  private enqueueTruncate(): void {
    this.meta = {
      ...this.meta,
      eventCount: 0,
      firstPrompt: null,
      lastActivity: new Date().toISOString(),
    };
    this.scheduleIndexWrite();
    void this.writeQueue
      .run(() => this.ensureReady().then(() => fs.writeFile(this.logPath, '', 'utf8')))
      .then(() => this.noteWriteOk())
      .catch((err: unknown) => this.noteWriteFailure('truncate', err));
  }

  private scheduleIndexWrite(): void {
    if (this.indexUpdateScheduled) return;
    this.indexUpdateScheduled = true;
    // 250ms debounce — fast enough that the picker stays current,
    // slow enough that a chatty turn doesn't rewrite the index per
    // assistant_chunk.
    const timer = setTimeout(() => {
      this.indexUpdateScheduled = false;
      this.indexTimer = null;
      void this.writeIndex();
    }, 250);
    timer.unref?.();
    this.indexTimer = timer;
  }

  private async writeIndex(): Promise<void> {
    try {
      // Once closed (the final detach/flush write), don't re-create the dir or
      // log file: setup already made them, and resurrecting a directory a
      // concurrent `deleteSession`/teardown is removing would leave a stray
      // sidecar behind. A live session awaits the (memoized) one-time setup so
      // an early write can't race the initial creation — but this no longer
      // re-runs the mkdir/open+close syscalls on every 250ms flush.
      if (!this.closed) {
        await this.ensureReady();
      }
      // Write ONLY this session's sidecar (`<id>.meta.json`), never a
      // read-modify-write of a shared index.json — that loses rows when two
      // moxxy processes update "their" row concurrently (each reads the index,
      // re-adds only itself, and the last writer drops the other's row).
      // `writeJsonAtomic` already `mkdir -p`s the sidecar's dir, so this owns no
      // ensureLogFile — the `.jsonl` is the append path's responsibility.
      await writeJsonAtomic(metaPath(this.dir, this.meta.id), this.meta);
    } catch {
      // Index write failures shouldn't bring down a session; the
      // user can always re-resume by id from the filename.
    }
  }

  /** One-time, memoized: `mkdir -p` the dir + create the empty `.jsonl`. On
   *  failure the latch is cleared so a later flush retries (matching the old
   *  per-write ensureDir/ensureLogFile recoverability). */
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await fs.mkdir(this.dir, { recursive: true });
        const handle = await fs.open(this.logPath, 'a');
        await handle.close();
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }
}

/**
 * Read the session index by assembling per-session sidecars (`<id>.meta.json`)
 * plus a legacy `index.json` if one exists (sidecars win by id). Sessions whose
 * `.jsonl` is missing are dropped. Sorted most-recent-activity first.
 */
export async function readIndex(dir = defaultSessionsDir()): Promise<SessionMeta[]> {
  const byId = new Map<string, SessionMeta>();

  // Legacy single-file index (pre-sidecar layout). Sidecars override it below.
  try {
    const raw = await fs.readFile(path.join(dir, 'index.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const m of parsed.filter(isSessionMeta)) byId.set(m.id, m);
    }
  } catch {
    // no legacy index — fine
  }

  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    dirents = [];
  }
  await Promise.all(
    dirents
      .filter((d) => d.isFile() && d.name.endsWith('.meta.json'))
      .map(async (d) => {
        try {
          const raw = await fs.readFile(path.join(dir, d.name), 'utf8');
          const parsed = JSON.parse(raw) as unknown;
          if (isSessionMeta(parsed)) byId.set(parsed.id, parsed);
        } catch {
          // skip a malformed/half-written sidecar
        }
      }),
  );

  const metas = [...byId.values()];
  const checks = await Promise.all(
    metas.map(async (meta) => {
      try {
        await fs.access(path.join(dir, `${meta.id}.jsonl`));
        return true;
      } catch {
        return false;
      }
    }),
  );
  const present = metas.filter((_, index) => checks[index]);
  const hydrated = await Promise.all(present.map((meta) => hydrateMetaFirstPrompt(meta, dir)));
  return hydrated
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

async function hydrateMetaFirstPrompt(meta: SessionMeta, dir: string): Promise<SessionMeta> {
  if (meta.firstPrompt?.trim()) return meta;
  const firstPrompt = await firstPromptFromLog(path.join(dir, `${meta.id}.jsonl`));
  return firstPrompt ? { ...meta, firstPrompt } : meta;
}

async function firstPromptFromLog(logPath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch {
    return null;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; text?: unknown };
      if (event.type === 'user_prompt' && typeof event.text === 'string') {
        const text = event.text.trim();
        if (text) return text.slice(0, 80);
      }
    } catch {
      // A corrupt line should not hide a later valid prompt.
    }
  }
  return null;
}

/**
 * Restore a previously-persisted session's events. Returns the full
 * event array suitable for passing into `new EventLog(events)`.
 *
 * Skips malformed lines (a single corrupted append shouldn't make the
 * rest of the conversation unreadable) and then RE-SEQUENCES the
 * survivors to contiguous `seq` 0..n-1, preserving order and ids. This
 * matters twice over:
 *
 *  - Mirror replay: `EventLog.ingest` accepts only `seq === length`, so
 *    a gap left by one corrupt middle line would silently truncate every
 *    attached client's history at that point.
 *  - Future appends: `EventLog.append` mints `seq = events.length`, so a
 *    gapped seed would mint colliding/out-of-order seqs.
 *
 * When anything was skipped or re-sequenced, the file is atomically
 * rewritten with the repaired events so the NEXT resume starts clean —
 * otherwise post-resume appends (seq = n-gap..) would interleave with the
 * stale higher on-disk seqs forever. Safe ordering-wise: restore runs
 * before `SessionPersistence.attach`, so no append queue is live yet.
 * Note: compaction/elision events referencing seqs after a gap shift by
 * the gap size — an accepted, logged trade-off versus losing all
 * post-gap history.
 */
export async function restoreEvents(
  sessionId: string,
  dir = defaultSessionsDir(),
  logger: Logger = createLogger(),
): Promise<MoxxyEvent[]> {
  const logPath = path.join(dir, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const events: MoxxyEvent[] = [];
  let corruptLines = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as MoxxyEvent);
    } catch {
      corruptLines += 1;
    }
  }

  // Re-sequence to contiguous 0..n-1 (order + ids preserved). A clean log is
  // already contiguous, so this is a no-op in the common case.
  let resequenced = 0;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i]!.seq !== i) {
      events[i] = { ...events[i]!, seq: i } as MoxxyEvent;
      resequenced += 1;
    }
  }

  if (corruptLines > 0 || resequenced > 0) {
    logger.warn('session log restored with gaps — re-sequenced to keep full history replayable', {
      sessionId,
      path: logPath,
      corruptLines,
      resequencedEvents: resequenced,
      restoredEvents: events.length,
    });
    try {
      const repaired = events.map((e) => JSON.stringify(e) + '\n').join('');
      await writeFileAtomic(logPath, repaired);
    } catch (err) {
      // Restore still succeeds — the in-memory log is repaired; only the
      // next resume would re-run this same repair.
      logger.warn('failed to rewrite repaired session log on disk', {
        sessionId,
        path: logPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return events;
}

/** One page of persisted events, newest-page-first paging (see
 *  {@link readEventPage}). */
export interface EventPage {
  /** The events in this page, in ascending `seq` order. */
  readonly events: MoxxyEvent[];
  /**
   * Cursor to pass as `before` for the NEXT (older) page — the `seq` of the
   * OLDEST event in this page. `null` once the start of history (the first
   * persisted event) is included, signalling there is no older page.
   */
  readonly prevCursor: number | null;
}

/**
 * Read ONE page of a persisted session's events without re-materializing the
 * whole conversation into a live {@link EventLog}. Backs the runner's
 * `session.loadHistory` so a thin client (the desktop) can page history from
 * the runner's authoritative JSONL instead of its own NDJSON mirror.
 *
 * Paging is newest-first, walking backwards:
 *   - `before == null` — the NEWEST page: the last `limit` events on disk.
 *   - `before == N` — the page of (up to) `limit` events strictly OLDER than
 *     `seq === N` (the events immediately preceding the cursor). Pass the
 *     previous page's `prevCursor` here to step one page further back.
 *
 * The returned `events` are always in ascending `seq` order (oldest-first
 * WITHIN the page) so a caller can prepend a page to an in-order transcript.
 * `prevCursor` is the `seq` of the page's oldest event, or `null` once the
 * first persisted event is included (no older page remains).
 *
 * Corrupt lines are skipped (matching {@link restoreEvents}); unlike
 * `restoreEvents` this is a READ-ONLY reader — it never rewrites the file, so
 * it preserves the JSONL exactly (no atomic-write / mutex needed: there is no
 * mutation). Paging keys on each event's on-disk `seq`. Determinism holds for a
 * MONOTONICALLY-INCREASING seq sequence — including a gapped-but-increasing one
 * (the append path guarantees this; the next resume re-sequences to contiguous
 * 0..n-1 anyway). DUPLICATE / non-strictly-increasing seqs are only reachable
 * via external file corruption, and a backward `prevCursor` walk over them can
 * drop events page-size-dependently until that next resume repairs the log.
 *
 * A missing log file is treated as an EMPTY history (`{ events: [], prevCursor:
 * null }`), not an error — a freshly-created session whose JSONL hasn't been
 * written yet must page as empty rather than throw.
 */
export async function readEventPage(
  sessionId: string,
  opts: { before: number | null; limit: number },
  dir = defaultSessionsDir(),
): Promise<EventPage> {
  const logPath = path.join(dir, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch {
    // No log on disk yet → empty history, not an error.
    return { events: [], prevCursor: null };
  }

  // Parse the JSONL, skipping corrupt lines (one bad append must not make the
  // rest unreadable). Read-only: we never rewrite the file here.
  const all: MoxxyEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      all.push(JSON.parse(line) as MoxxyEvent);
    } catch {
      // skip a malformed/half-written line, same as restoreEvents
    }
  }
  // Delegate ALL paging (including the limit/cursor clamping) to pageEvents so
  // the disk and in-memory paths are identical by construction — no separate
  // limit handling here that could diverge from the in-memory page.
  return pageEvents(all, opts.before, opts.limit);
}

/**
 * Slice one newest-first page out of an ascending-`seq` event array. Pure +
 * exported so the runner can reuse the EXACT paging semantics when it serves a
 * page out of its in-memory log instead of disk — the two paths must agree
 * byte-for-byte or a client crossing between them (in-memory → disk fallback)
 * would see a discontinuity. `events` MUST be ordered oldest-first (the on-disk
 * / append order); `before`/`limit` follow {@link readEventPage}.
 */
export function pageEvents(
  events: ReadonlyArray<MoxxyEvent>,
  before: number | null,
  limit: number,
): EventPage {
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0 || events.length === 0) {
    return { events: [], prevCursor: events.length === 0 ? null : before };
  }
  // Exclusive upper bound by `seq`: the first index whose event is NOT older
  // than `before`. `before == null` (newest page) keeps the whole array.
  let end = events.length;
  if (before !== null) {
    end = 0;
    for (let i = 0; i < events.length; i += 1) {
      if (events[i]!.seq < before) end = i + 1;
      else break;
    }
  }
  const start = Math.max(0, end - cap);
  const page = events.slice(start, end);
  // `null` once this page reaches the very first event on disk — no older page.
  const prevCursor = start <= 0 ? null : page[0]!.seq;
  return { events: page, prevCursor };
}

/**
 * Seed a session's event log from an external event list IFF the session has no
 * log on disk yet. This is the migration that makes the runner's authoritative
 * log the home of a chat whose history previously lived ONLY in a thin client's
 * own mirror (the desktop's NDJSON chat store) — after it runs, `loadHistory`
 * serves that chat from the runner like any other.
 *
 * Idempotent and NON-destructive: if `<sessionId>.jsonl` already exists AND is
 * NON-EMPTY this is a no-op returning `false`, so a session the runner already
 * owns is NEVER overwritten. A 0-byte log IS seeded: `persistence.attach`
 * creates an empty `<id>.jsonl` on every spawn (even a session with zero
 * events), so an existence-only guard would skip exactly the legacy chats this
 * migration targets — and an empty file holds no history, so seeding over it
 * loses nothing. Events are re-sequenced to contiguous `seq` 0..n-1 (order + ids
 * preserved) so the seeded log satisfies {@link EventLog}'s seq invariants when
 * it is later restored. Written temp+rename so a crash mid-seed can't leave a
 * half-written log. Returns `true` iff it wrote the log.
 */
export async function seedSessionLog(
  sessionId: string,
  events: ReadonlyArray<MoxxyEvent>,
  dir = defaultSessionsDir(),
): Promise<boolean> {
  if (events.length === 0) return false;
  const logPath = path.join(dir, `${sessionId}.jsonl`);
  try {
    // A non-empty log is a session the runner already owns → never overwrite.
    // A 0-byte log is the empty file attach() left behind → seed over it.
    if ((await fs.stat(logPath)).size > 0) return false;
  } catch {
    /* no log yet → seed below */
  }
  await fs.mkdir(dir, { recursive: true });
  const reseq = events.map((e, i) => (e.seq === i ? e : ({ ...e, seq: i } as MoxxyEvent)));
  await writeFileAtomic(logPath, reseq.map((e) => JSON.stringify(e) + '\n').join(''));
  return true;
}

/**
 * Remove a session's log file and its sidecar. A leftover legacy `index.json`
 * row, if any, is harmless — `readIndex` filters out sessions whose `.jsonl` is
 * gone, so the deleted session won't reappear.
 */
export async function deleteSession(
  sessionId: string,
  dir = defaultSessionsDir(),
): Promise<void> {
  await fs.rm(path.join(dir, `${sessionId}.jsonl`), { force: true });
  await fs.rm(metaPath(dir, sessionId), { force: true });
}

/** Per-session metadata sidecar path. */
function metaPath(dir: string, id: string): string {
  return path.join(dir, `${id}.meta.json`);
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await writeFileAtomic(target, JSON.stringify(value, null, 2) + '\n');
}

function isSessionMeta(v: unknown): v is SessionMeta {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.cwd === 'string' &&
    typeof m.startedAt === 'string' &&
    typeof m.lastActivity === 'string' &&
    typeof m.eventCount === 'number'
  );
}
