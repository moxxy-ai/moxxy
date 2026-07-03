/**
 * Session persistence — appends each event in `session.log` to a
 * per-session JSONL file under `~/.moxxy/sessions/`, and maintains an
 * `index.json` of session metadata so `moxxy resume` can list and
 * pick a prior session without scanning every event file.
 *
 * Layout:
 *   ~/.moxxy/sessions/
 *     <sessionId>.json           per-session metadata sidecar (one per session)
 *     <sessionId>.jsonl          one MoxxyEvent per line
 *
 * Each session writes only its OWN `.json` sidecar (write-temp-rename), so
 * two concurrent moxxy processes can't drop each other's row the way a shared
 * `index.json` read-modify-write would. `readIndex` assembles the sidecars (and
 * a legacy `index.json`, if present, for back-compat). JSONL appends are
 * best-effort (lose at most the last in-flight event on a crash).
 */

import { constants as fsConstants, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createMutex, type Mutex, type MoxxyEvent, type SessionId } from '@moxxy/sdk';
import type { EventLogLike, EventPage, SessionMeta, SessionSource } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { createLogger, type Logger } from '../logger.js';
import { isMoxxyEventShape } from './event-shape.js';

// `SessionSource`, `SessionMeta` and `EventPage` are the EventStore contract's
// data shapes — defined in @moxxy/sdk so `EventStoreDef` can reference them.
// Re-exported here (and onward from @moxxy/core) so existing importers are
// unaffected by the move.
export type { EventLogLike, EventPage, SessionMeta, SessionSource } from '@moxxy/sdk';
export { SESSION_SOURCES } from '@moxxy/sdk';

/** Schema version of the per-session metadata file (`<id>.json`). Bump when the
 *  shape changes incompatibly; readers tolerate a missing/older version. */
export const SESSION_META_VERSION = 1;

// `SessionMeta` is defined in @moxxy/sdk (the EventStore contract's listing
// shape) and re-exported above. The JSONL impl below reads/writes it.

export interface SessionPersistenceOpts {
  readonly sessionId: SessionId;
  readonly cwd: string;
  /** Override the storage root. Defaults to `~/.moxxy/sessions`. */
  readonly dir?: string;
  /** Currently-active provider name — captured into the index for the picker. */
  readonly providerName?: string;
  /** Currently-active model id — captured into the index for the picker. */
  readonly modelId?: string;
  /** Originating channel — persisted into the sidecar so the workspace list can
   *  be derived from a single source (see {@link SessionSource}). */
  readonly source?: SessionSource;
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
 * Session ids are ULIDs internally, but `restoreEvents`/`readEventPage`/
 * `deleteSession` are public APIs reachable from the runner/desktop IPC and the
 * CLI. Reject anything outside the ULID-safe charset before path-joining so a
 * `../`-laden or absolute-ish id can't read or `fs.rm` files outside the
 * sessions dir (deleteSession uses `force:true`, so a traversal delete would
 * otherwise silently succeed). Defense-in-depth at the trust boundary.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

function assertSafeSessionId(sessionId: string): void {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error(`Invalid session id: ${JSON.stringify(sessionId)}`);
  }
}

/** Max concurrent fs operations in `readIndex` — bounds open file handles so a
 *  user with thousands of sessions can't hit EMFILE on the list/resume path. */
const READ_INDEX_CONCURRENCY = 32;

/**
 * Map `fn` over `items` with at most `limit` calls in flight at once, preserving
 * input order in the returned array. A small dependency-free concurrency limiter
 * (the framework avoids extra deps for this).
 */
async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
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
   * Single-flight guard for the sidecar (`writeIndex`) write. The debounced
   * timer and an explicit `flush()` can both call `writeIndex()` concurrently;
   * without serialization two `writeFileAtomic`s would race on `metaPath` and
   * the on-disk result would be last-rename-wins between two `this.meta`
   * snapshots non-deterministically. Chaining them makes the latest meta win
   * deterministically and drops the redundant work.
   */
  private indexWriteChain: Promise<void> = Promise.resolve();
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
      version: SESSION_META_VERSION,
      id: this.id,
      cwd: opts.cwd,
      startedAt: now,
      lastActivity: now,
      eventCount: 0,
      firstPrompt: null,
      provider: opts.providerName ?? null,
      model: opts.modelId ?? null,
      ...(opts.source ? { source: opts.source } : {}),
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
  attach(log: EventLogLike): () => void {
    const initialStats = statsFromEventLogLike(this.id, log);
    if (initialStats && initialStats.parsedEvents > 0) {
      this.applyLogStats(initialStats);
    }
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
    const ownedEvent = eventForSession(event, this.id);
    if (!ownedEvent) {
      this.logger.warn('session persistence ignored foreign-session event', {
        path: this.logPath,
        sessionId: this.id,
        eventId: event.id,
        eventSessionId: event.sessionId,
      });
      return;
    }
    // Update in-memory meta synchronously so multiple events in the
    // same tick share one debounced index write.
    this.meta = {
      ...this.meta,
      eventCount: this.meta.eventCount + 1,
      lastActivity: new Date().toISOString(),
      firstPrompt:
        this.meta.firstPrompt ??
        (ownedEvent.type === 'user_prompt' ? firstPromptLabel(ownedEvent.text) : null),
      ...providerHeaderFromEvent(ownedEvent),
    };
    this.scheduleIndexWrite();
    const line = JSON.stringify(ownedEvent) + '\n';
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

  /**
   * Serialize the sidecar write through `indexWriteChain` so a debounced write
   * and a concurrent `flush()` never race on `metaPath`; resolves once THIS
   * call's write (or a later one that supersedes it) has settled.
   */
  private writeIndex(): Promise<void> {
    const next = this.indexWriteChain.then(() => this.doWriteIndex());
    // Keep the chain unbroken even if a write rejects (doWriteIndex already
    // swallows, but guard the chain itself defensively).
    this.indexWriteChain = next.catch(() => undefined);
    return next;
  }

  private async doWriteIndex(): Promise<void> {
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
      // Write ONLY this session's file (`<id>.json`), never a read-modify-write
      // of a shared index — that loses rows when two moxxy processes update
      // "their" row concurrently. `writeJsonAtomic` already `mkdir -p`s the dir,
      // so this owns no ensureLogFile — the `.jsonl` is the append path's job.
      //
      // The UI fields (`title`, `groupId`) are owned by the rename/move path,
      // not the runner. Re-read them just before writing so an external rename
      // or move that landed mid-session is preserved rather than clobbered by
      // our (possibly stale) in-memory copy. The runner owns every other field.
      const onDisk = await readMetaSidecar(this.dir, this.meta.id);
      const merged: SessionMeta = {
        ...this.meta,
        title: onDisk?.title ?? this.meta.title ?? null,
        groupId: onDisk?.groupId ?? this.meta.groupId ?? null,
      };
      await writeJsonAtomic(metaPath(this.dir, this.meta.id), merged);
    } catch {
      // Index write failures shouldn't bring down a session; the
      // user can always re-resume by id from the filename.
    }
  }

  /** One-time, memoized: `mkdir -p` the dir + create the empty `.jsonl`, then
   *  ADOPT a pre-existing file's stable identity: `startedAt` (so the derived
   *  "created" time doesn't jump on every resume), `source` (when the caller
   *  didn't pass one), and the UI-owned `title`/`groupId` (so the first runner
   *  write doesn't drop a rename/move made while no runner was attached). On
   *  failure the latch is cleared so a later flush retries. */
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await fs.mkdir(this.dir, { recursive: true });
        const handle = await fs.open(this.logPath, 'a');
        await handle.close();
        const existing = await readMetaSidecar(this.dir, this.id);
        const stats = await matchingSessionStatsFromLog(this.id, this.logPath);
        if (existing) {
          this.meta = {
            ...this.meta,
            startedAt: existing.startedAt,
            source: this.meta.source ?? existing.source,
            title: existing.title ?? null,
            groupId: existing.groupId ?? null,
          };
        }
        if (stats && stats.parsedEvents > 0) {
          this.applyLogStats(stats);
        }
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  private applyLogStats(stats: SessionLogStats): void {
    this.meta = {
      ...this.meta,
      eventCount: stats.eventCount,
      firstPrompt: stats.firstPrompt,
      provider: stats.provider ?? this.meta.provider,
      model: stats.model ?? this.meta.model,
    };
  }
}

/**
 * Read the session index by assembling per-session metadata files (`<id>.json`),
 * then hydrating each one's first prompt from its `.jsonl`. Sessions whose
 * `.jsonl` is missing are dropped. Sorted most-recent-activity first. This is the
 * heavier, jsonl-hydrated read used by `moxxy resume`; the workspace list uses
 * the cheap {@link listSessionMetas} instead.
 */
export async function readIndex(dir = defaultSessionsDir()): Promise<SessionMeta[]> {
  const { metas, logs } = await readSessionsDir(dir);
  const present = metas.filter((meta) => logs.has(meta.id));
  const hydrated = await mapWithConcurrency(present, READ_INDEX_CONCURRENCY, (meta) =>
    hydrateMetaFirstPrompt(meta, dir),
  );
  return hydrated.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

async function hydrateMetaFirstPrompt(meta: SessionMeta, dir: string): Promise<SessionMeta> {
  const stats = await matchingSessionStatsFromLog(meta.id, path.join(dir, `${meta.id}.jsonl`));
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

interface SessionLogStats {
  eventCount: number;
  firstPrompt: string | null;
  parsedEvents: number;
  provider: string | null;
  model: string | null;
}

function statsFromEvents(sessionId: string, events: Iterable<MoxxyEvent>): SessionLogStats {
  let eventCount = 0;
  let parsedEvents = 0;
  let firstPrompt: string | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  for (const event of events) {
    parsedEvents += 1;
    if (!eventBelongsToSession(event, sessionId)) continue;
    eventCount += 1;
    if (firstPrompt === null && event.type === 'user_prompt') {
      // Mirror the write-time label (SessionPersistence.enqueueAppend):
      // code-point-aware slice + non-string coercion, so a hydrated index row
      // matches the meta the live append wrote (no surrogate split, never null
      // for a present prompt).
      firstPrompt = firstPromptLabel(event.text);
    }
    const header = providerHeaderFromEvent(event);
    if (header.provider !== undefined) provider = header.provider;
    if (header.model !== undefined) model = header.model;
  }
  return { eventCount, firstPrompt, parsedEvents, provider, model };
}

function statsFromEventLogLike(sessionId: string, log: EventLogLike): SessionLogStats | null {
  const snapshot = log as { slice?: (from?: number, to?: number) => ReadonlyArray<MoxxyEvent> };
  if (typeof snapshot.slice !== 'function') return null;
  return statsFromEvents(sessionId, snapshot.slice());
}

async function matchingSessionStatsFromLog(
  sessionId: string,
  logPath: string,
): Promise<SessionLogStats | null> {
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
      // Wrong-shape lines are skipped exactly like corrupt ones: neither a
      // corrupt nor a junk line should hide a later valid prompt.
      if (isMoxxyEventShape(parsed)) events.push(parsed);
    } catch {
      // A corrupt line should not hide a later valid prompt.
    }
  }
  return statsFromEvents(sessionId, events);
}

function providerHeaderFromEvent(event: MoxxyEvent): { provider?: string | null; model?: string | null } {
  if (event.type !== 'provider_request' && event.type !== 'provider_response') return {};
  return {
    provider: event.provider,
    model: event.model,
  };
}

/**
 * Restore a previously-persisted session's events. Returns the full
 * event array suitable for passing into `new EventLog(events)`.
 *
 * Skips malformed lines — corrupt JSON and valid-JSON-but-wrong-shape
 * alike (see {@link isMoxxyEventShape}); a single bad append shouldn't
 * make the rest of the conversation unreadable — and then RE-SEQUENCES
 * the survivors to contiguous `seq` 0..n-1, preserving order and ids.
 * This matters twice over:
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
  assertSafeSessionId(sessionId);
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
      // Valid JSON but not a replayable event shape (see isMoxxyEventShape):
      // skipped with the exact same semantics as a corrupt line — counted,
      // re-sequenced around, and repaired away by the rewrite below. Casting
      // it through instead used to let a junk line drive replay (a compaction
      // line without `replacedRange` throws mid-projection).
      if (!isMoxxyEventShape(parsed)) {
        invalidShapeLines += 1;
        continue;
      }
      const ownedEvent = eventForSession(parsed, sessionId);
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

  // Re-sequence to contiguous 0..n-1 (order + ids preserved). A clean log is
  // already contiguous, so this is a no-op in the common case.
  let resequenced = 0;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i]!.seq !== i) {
      events[i] = { ...events[i]!, seq: i } as MoxxyEvent;
      resequenced += 1;
    }
  }

  if (
    corruptLines > 0 ||
    invalidShapeLines > 0 ||
    resequenced > 0 ||
    foreignEvents > 0 ||
    normalizedSessionIds > 0
  ) {
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
        await backupForeignSessionLog(logPath);
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
      // Conflict guard: only rewrite if (a) a foreign-session backup didn't
      // fail (`canRewrite`) and (b) the on-disk content still matches what we
      // read. Another process (a desktop runner already attached + a CLI
      // `resume` of the SAME id) may have appended/repaired between our read and
      // this write; its appends are a newer snapshot than our re-sequenced one,
      // and a blind `writeFileAtomic` would clobber them (silent history loss).
      // The single-writer assumption the rest of persistence relies on does not
      // hold across processes, so re-read and compare before the destructive
      // rewrite. Restore still succeeds either way — the in-memory log is
      // already repaired; only the next clean resume would re-run the repair.
      const current = await fs.readFile(logPath, 'utf8').catch(() => null);
      if (!canRewrite) {
        /* foreign-session backup failed — skip the destructive rewrite */
      } else if (current !== raw) {
        logger.warn('skipped repaired-log rewrite — file changed under us (another process attached?)', {
          sessionId,
          path: logPath,
        });
      } else {
        const repaired = events.map((e) => JSON.stringify(e) + '\n').join('');
        await writeFileAtomic(logPath, repaired);
      }
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

// `EventPage` is defined in @moxxy/sdk (the EventStore read contract) and
// re-exported above; `readEventPage`/`pageEvents` below produce it.

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
 * Corrupt and wrong-shape lines are skipped (matching {@link restoreEvents}); unlike
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
  assertSafeSessionId(sessionId);
  const logPath = path.join(dir, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch {
    // No log on disk yet → empty history, not an error.
    return { events: [], prevCursor: null };
  }

  // Parse the JSONL, skipping corrupt AND wrong-shape lines (one bad append
  // must not make the rest unreadable). Read-only: we never rewrite the file
  // here.
  const all: MoxxyEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      // skip a valid-JSON-but-not-an-event line, same as restoreEvents
      if (isMoxxyEventShape(parsed)) all.push(parsed);
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
  // `pageEvents` is an exported public API (runner + disk paths call it), so it
  // must self-defend rather than trust every caller to pre-validate. A
  // non-finite `before` (NaN/Infinity from a corrupt cursor) would otherwise
  // make every `seq < before` comparison false, collapse the page to empty, and
  // hand back `prevCursor: before` — a NaN that JSON-serializes to `null`,
  // silently wedging the client's backward walk. Coerce any non-integer cursor
  // to the newest page (`null`) so a bad cursor degrades to "start over from the
  // top" instead of a poisoned cursor.
  const safeBefore =
    before === null || !Number.isInteger(before) ? null : before;
  if (cap === 0 || events.length === 0) {
    return { events: [], prevCursor: events.length === 0 ? null : safeBefore };
  }
  // Exclusive upper bound by `seq`: the first index whose event is NOT older
  // than `before`. `before == null` (newest page) keeps the whole array.
  let end = events.length;
  if (safeBefore !== null) {
    end = 0;
    for (let i = 0; i < events.length; i += 1) {
      if (events[i]!.seq < safeBefore) end = i + 1;
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

function eventBelongsToSession(event: MoxxyEvent, sessionId: string): boolean {
  const eventSessionId = (event as { sessionId?: unknown }).sessionId;
  return eventSessionId == null || eventSessionId === sessionId;
}

function eventForSession(event: MoxxyEvent, sessionId: string): MoxxyEvent | null {
  if (!eventBelongsToSession(event, sessionId)) return null;
  if ((event as { sessionId?: unknown }).sessionId === sessionId) return event;
  return { ...event, sessionId: sessionId as SessionId } as MoxxyEvent;
}

async function backupForeignSessionLog(logPath: string): Promise<void> {
  try {
    await fs.copyFile(logPath, `${logPath}.foreign-session.bak`, fsConstants.COPYFILE_EXCL);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw err;
  }
}

/**
 * Remove a session entirely: its event log (`<id>.jsonl`) and its single
 * metadata file (`<id>.json`). This is the SINGLE deletion mechanism — a session
 * exists iff its `<id>.json` does, so erasing it removes the session from every
 * surface's derived list with no second copy to resurrect it.
 */
export async function deleteSession(
  sessionId: string,
  dir = defaultSessionsDir(),
): Promise<void> {
  assertSafeSessionId(sessionId);
  await fs.rm(path.join(dir, `${sessionId}.jsonl`), { force: true });
  await fs.rm(metaPath(dir, sessionId), { force: true });
  metaCache.delete(metaPath(dir, sessionId));
}

/** Per-session metadata file path: `<id>.json` (one file per session). */
function metaPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

/** Read one session's metadata file, or null if absent/corrupt. */
async function readMetaSidecar(dir: string, id: string): Promise<SessionMeta | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(metaPath(dir, id), 'utf8')) as unknown;
    return isSessionMeta(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Patch the UI-owned fields of a session's `<id>.json` in place (read-modify-
 * write): the rename (`title`) and move (`groupId`) paths. A live runner adopts
 * and re-merges these on its next write, so this is safe whether or not a runner
 * is attached. No-op if the session has no metadata file yet.
 */
async function patchSessionMeta(
  sessionId: string,
  patch: Partial<Pick<SessionMeta, 'title' | 'groupId'>>,
  dir: string,
): Promise<void> {
  assertSafeSessionId(sessionId);
  const existing = await readMetaSidecar(dir, sessionId);
  if (!existing) return;
  await writeJsonAtomic(metaPath(dir, sessionId), { ...existing, ...patch });
  metaCache.delete(metaPath(dir, sessionId));
}

/** Persist (or clear, when blank) a user-set session title — the rename path. */
export async function setSessionTitle(
  sessionId: string,
  title: string,
  dir = defaultSessionsDir(),
): Promise<void> {
  await patchSessionMeta(sessionId, { title: title.trim() || null }, dir);
}

/** Persist (or clear, when null) a session's explicit desk/workspace membership. */
export async function setSessionGroup(
  sessionId: string,
  groupId: string | null,
  dir = defaultSessionsDir(),
): Promise<void> {
  await patchSessionMeta(sessionId, { groupId: groupId ?? null }, dir);
}

/**
 * Seed a session's `<id>.json` (+ empty `.jsonl`) so a freshly-created session
 * appears in the derived workspace list IMMEDIATELY, before its runner spawns
 * and attaches. Idempotent: if a metadata file already exists this is a no-op,
 * so it never clobbers a live session. The runner adopts the seeded
 * `startedAt`/`source`/`groupId`/`title` on attach.
 */
export async function seedSessionMeta(
  sessionId: string,
  cwd: string,
  source: SessionSource,
  dir = defaultSessionsDir(),
  groupId: string | null = null,
): Promise<void> {
  assertSafeSessionId(sessionId);
  if (await readMetaSidecar(dir, sessionId)) return;
  await fs.mkdir(dir, { recursive: true });
  const handle = await fs.open(path.join(dir, `${sessionId}.jsonl`), 'a');
  await handle.close();
  const now = new Date().toISOString();
  const meta: SessionMeta = {
    version: SESSION_META_VERSION,
    id: sessionId,
    cwd,
    startedAt: now,
    lastActivity: now,
    eventCount: 0,
    firstPrompt: null,
    provider: null,
    model: null,
    source,
    groupId,
    title: null,
  };
  await writeJsonAtomic(metaPath(dir, sessionId), meta);
  metaCache.delete(metaPath(dir, sessionId));
}

/**
 * Parse-cache for `<id>.json` files, keyed by absolute path. A file is re-parsed
 * only when its mtime/size changes, so listing thousands of sessions on every
 * `desks.list` costs N cheap stats plus reparses of just the CHANGED files — not
 * N JSON parses. Cross-process safe: another process's write bumps the mtime,
 * observed on the next stat. Per-process, bounded by the number of sessions.
 */
const metaCache = new Map<string, { mtimeMs: number; size: number; meta: SessionMeta }>();

interface ParsedMetaFile {
  readonly meta: SessionMeta;
  readonly canonical: boolean;
}

export interface ListSessionMetasOptions {
  readonly hydrateStale?: boolean;
}

/**
 * One pass over the sessions dir: a single `readdir` yields BOTH the `<id>.json`
 * metadata files and the set of `<id>` ids that have an event log, so callers
 * test log-existence with an O(1) Set lookup instead of an `fs.access` per
 * session. Each `<id>.json` is `stat`-checked and re-parsed only when its
 * mtime/size changed (the parse cache), so steady-state cost is one `readdir` +
 * N cheap `stat`s + reparses of only the CHANGED files.
 */
async function readSessionsDir(dir: string): Promise<{ metas: SessionMeta[]; logs: Set<string> }> {
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { metas: [], logs: new Set() };
  }
  const logs = new Set<string>();
  const files: import('node:fs').Dirent[] = [];
  for (const d of dirents) {
    if (!d.isFile()) continue;
    if (d.name.endsWith('.jsonl')) logs.add(d.name.slice(0, -'.jsonl'.length));
    else if (d.name.endsWith('.json') && d.name !== 'index.json') files.push(d);
  }
  const live = new Set(files.map((d) => path.join(dir, d.name)));
  for (const key of metaCache.keys()) if (!live.has(key)) metaCache.delete(key);
  const parsedFiles = await mapWithConcurrency(files, READ_INDEX_CONCURRENCY, async (d) => {
    const file = path.join(dir, d.name);
    try {
      const stat = await fs.stat(file);
      const cached = metaCache.get(file);
      const parsed =
        cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size
          ? cached.meta
          : null;
      if (parsed) {
        return { meta: parsed, canonical: d.name === `${parsed.id}.json` };
      }
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
      if (!isSessionMeta(raw)) return null;
      metaCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, meta: raw });
      return { meta: raw, canonical: d.name === `${raw.id}.json` };
    } catch {
      return null;
    }
  });
  const deduped = new Map<string, ParsedMetaFile>();
  for (const parsed of parsedFiles) {
    if (!parsed) continue;
    const existing = deduped.get(parsed.meta.id);
    if (!existing || (parsed.canonical && !existing.canonical)) {
      deduped.set(parsed.meta.id, parsed);
    }
  }
  return { metas: [...deduped.values()].map((entry) => entry.meta), logs };
}

function shouldHydrateMeta(meta: SessionMeta): boolean {
  return meta.eventCount === 0 || meta.firstPrompt === null;
}

async function maybeHydrateSessionMetas(
  metas: ReadonlyArray<SessionMeta>,
  dir: string,
  opts: ListSessionMetasOptions,
): Promise<SessionMeta[]> {
  if (!opts.hydrateStale) return [...metas];
  return mapWithConcurrency(metas, READ_INDEX_CONCURRENCY, async (meta) =>
    shouldHydrateMeta(meta) ? hydrateMetaFirstPrompt(meta, dir) : meta,
  );
}

/**
 * List every session from its `<id>.json` sidecar (mtime-cached). By default
 * this is the cheap read the workspace list/search can call frequently. Callers
 * that need to survive stale legacy sidecars can opt into targeted `.jsonl`
 * hydration for rows whose counters/name seed are empty.
 */
export async function listSessionMetas(
  dir = defaultSessionsDir(),
  opts: ListSessionMetasOptions = {},
): Promise<SessionMeta[]> {
  const { metas, logs } = await readSessionsDir(dir);
  const present = metas.filter((meta) => logs.has(meta.id));
  const hydrated = await maybeHydrateSessionMetas(present, dir, opts);
  return hydrated.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

/**
 * First 80 chars of a prompt for the picker label, sliced on code-point (not
 * UTF-16 code-unit) boundaries so the cut never splits a surrogate pair (emoji,
 * astral CJK) into a lone half-character that renders as a broken glyph.
 *
 * `text` is typed `string`, but this runs inside the log listener chain — a
 * throw here would latch the misleading "persistence degraded" warning. Coerce
 * a non-string (a hand-built `EmittedEvent`, a future schema variant) instead of
 * letting `[...text]` throw on `undefined`/`null`.
 */
function firstPromptLabel(text: string): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  return [...s].slice(0, 80).join('');
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
