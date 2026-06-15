/**
 * Per-workspace append-only chat log — the durable backend for the
 * renderer's transcript. One NDJSON file per workspace under
 * `~/.moxxy/chats/<workspaceId>.jsonl`, one committed runner event per
 * line.
 *
 * Why this over localStorage (the old backend): appends never
 * re-serialise old events (the localStorage killer was JSON.stringify of
 * the whole array on every turn), there is no ~5 MB origin cap, it
 * survives a renderer crash, and it's trivially greppable. Cursor
 * pagination lets the renderer load only the most-recent slice and fetch
 * older pages on scroll-up.
 *
 * No native dependency — `sqlite` is the upgrade path only if full-text
 * search across thousands of messages later becomes a hard requirement.
 */

import { appendFile, mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createMutex, type Mutex, type MoxxyEvent } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
import { defaultSessionsDir, restoreSessionEvents, seedSessionLog } from '@moxxy/core';

const SUBAGENT_PLUGIN_ID = '@moxxy/subagents';
const CHAT_EVENT_TYPES: ReadonlySet<MoxxyEvent['type']> = new Set([
  'user_prompt',
  'assistant_message',
  'tool_call_requested',
  'tool_result',
  'tool_call_approved',
  'tool_call_denied',
  'skill_invoked',
  'error',
  'abort',
]);

/** Chats directory — env-overridable so tests can point at a tmp dir. */
function chatsDir(): string {
  return process.env['MOXXY_CHATS_DIR'] || path.join(homedir(), '.moxxy', 'chats');
}

/** Confine the filename to the chats dir — workspace ids are desk ids
 *  (safe today), but sanitise defensively so a hostile id can't escape. */
function fileFor(workspaceId: string): string {
  const safe = workspaceId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128) || 'unnamed';
  return path.join(chatsDir(), `${safe}.jsonl`);
}

/**
 * Per-log set of event ids already written, so {@link appendEvents} is
 * idempotent by id without re-reading the whole file each turn. Keyed by the
 * resolved FILE PATH (not the workspace id) so tests pointing `MOXXY_CHATS_DIR`
 * at different tmp dirs never share a cache entry.
 *
 * Why idempotent: the renderer (and the WS bridge) may dispatch the same
 * committed event more than once across reconnects, and dedup-by-id keeps the
 * NDJSON log at one copy with stable {@link loadSegment} line-index cursors.
 * Mechanism note (corrected 2026-06-11): the runner's attach-time replay was
 * NEVER the duplicate source the original comment claimed — the SessionDriver
 * subscribes to the mirror only AFTER attach completes, so replayed events
 * never reached the renderer; the transcript is loaded solely via
 * `chat.loadSegment` from this file. The desktop now attaches with
 * `replay: 'none'` (runner protocol v6), so the replay doesn't even populate
 * the host-side mirror anymore.
 */
const writtenIds = new Map<string, Set<string>>();

/**
 * Per-file line-offset index so {@link loadSegment} reads ONLY the bytes of
 * the requested page instead of re-reading + JSON.parsing the entire NDJSON
 * file on every scroll-up (which made paging O(file) per page and grew with
 * the conversation). `offsets[i]` is the byte offset of the i-th VALID event
 * line (parse-checked once at build time — corrupt/empty lines are excluded,
 * so these indices are exactly the cursor space `loadSegment` always used).
 *
 * Invalidation mirrors the {@link writtenIds} idempotency cache:
 *   - {@link appendEvents} extends the index in place when it is provably
 *     current (pre-append file size matches), else drops it
 *   - {@link clearLog} / {@link migrate} drop it
 *   - a size/mtime guard catches out-of-band file edits (tests, other
 *     processes) and triggers a lazy rebuild
 */
interface LineIndex {
  /** Byte offset of each valid event line start, in cursor order. */
  offsets: number[];
  /** File byte size the index describes (also the end of the last line). */
  size: number;
  mtimeMs: number;
}

const lineIndexes = new Map<string, LineIndex>();

/**
 * Per-file write mutex (invariant #5). {@link appendEvents}, {@link clearLog}
 * and {@link migrate} are read-modify-writes over the shared {@link writtenIds}
 * dedup set and {@link lineIndexes} cursor index around an `await`, and the
 * `chat.append` / `chat.clearLog` IPC handlers are independently dispatchable —
 * two overlapping appends for one workspace would both read the same pre-append
 * `idx.size`, both `appendFile`, and the second would extend the line offsets
 * against a stale base, corrupting the cursors {@link loadSegment} relies on
 * (and an append racing a clear could re-append past the truncate). Serialising
 * per FILE PATH (matching the cache keys) makes each whole-file RMW atomic while
 * keeping disjoint workspaces fully concurrent. Keyed by file path so tests
 * pointing `MOXXY_CHATS_DIR` at different tmp dirs never share a lock.
 */
const fileMutexes = new Map<string, Mutex>();

function mutexFor(file: string): Mutex {
  let m = fileMutexes.get(file);
  if (!m) {
    m = createMutex();
    fileMutexes.set(file, m);
  }
  return m;
}

/** Get the (validated) line index for a file, rebuilding it if the file is
 *  unknown or changed out-of-band. Returns null when the file doesn't exist. */
async function lineIndexFor(file: string): Promise<LineIndex | null> {
  let st;
  try {
    st = await stat(file);
  } catch {
    lineIndexes.delete(file);
    return null;
  }
  const cached = lineIndexes.get(file);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached;

  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    lineIndexes.delete(file);
    return null;
  }
  const offsets: number[] = [];
  let pos = 0;
  while (pos < body.length) {
    const nl = body.indexOf(0x0a, pos);
    const lineEnd = nl === -1 ? body.length : nl;
    if (lineEnd > pos) {
      try {
        JSON.parse(body.toString('utf8', pos, lineEnd));
        offsets.push(pos);
      } catch {
        /* corrupt line — excluded from the cursor space, same as readLines */
      }
    }
    pos = lineEnd + 1;
  }
  const built: LineIndex = { offsets, size: body.length, mtimeMs: st.mtimeMs };
  lineIndexes.set(file, built);
  return built;
}

async function knownIds(workspaceId: string): Promise<Set<string>> {
  const key = fileFor(workspaceId);
  let set = writtenIds.get(key);
  if (!set) {
    set = new Set((await readLines(workspaceId)).map((e) => e.id));
    writtenIds.set(key, set);
  }
  return set;
}

async function readLines(workspaceId: string): Promise<MoxxyEvent[]> {
  let body: string;
  try {
    body = await readFile(fileFor(workspaceId), 'utf8');
  } catch {
    return [];
  }
  const out: MoxxyEvent[] = [];
  for (const line of body.split('\n')) {
    if (!line) continue;
    try {
      const event = JSON.parse(line) as MoxxyEvent;
      if (eventBelongsToWorkspace(event, workspaceId)) out.push(event);
    } catch {
      /* skip a corrupt line rather than lose the whole transcript */
    }
  }
  return out;
}

/** Append committed events to the workspace's log, skipping any whose id is
 *  already on disk (idempotent — see {@link writtenIds}). No-op for an empty
 *  batch or one that is wholly duplicate; creates the dir lazily on first write. */
export async function appendEvents(
  workspaceId: string,
  events: ReadonlyArray<MoxxyEvent>,
): Promise<void> {
  if (events.length === 0) return;
  // Serialise the whole knownIds→filter→append→index-extend RMW per file so
  // concurrent appends can't desync the dedup set or the line-index cursors.
  return mutexFor(fileFor(workspaceId)).run(() => appendEventsLocked(workspaceId, events));
}

async function appendEventsLocked(
  workspaceId: string,
  events: ReadonlyArray<MoxxyEvent>,
): Promise<void> {
  const ownedEvents = events.filter((event) => eventBelongsToWorkspace(event, workspaceId));
  if (ownedEvents.length === 0) return;
  const seen = await knownIds(workspaceId);
  const incoming = new Set<string>();
  const fresh = ownedEvents.filter((e) => {
    if (seen.has(e.id) || incoming.has(e.id)) return false;
    incoming.add(e.id);
    return true;
  });
  if (fresh.length === 0) return;
  await mkdir(chatsDir(), { recursive: true });
  const file = fileFor(workspaceId);
  const serialized = fresh.map((e) => JSON.stringify(e));
  const lines = serialized.join('\n') + '\n';

  // Extend the line index in place when it provably describes the file as it
  // is right now (size match); otherwise drop it and let the next loadSegment
  // rebuild lazily. Checked BEFORE the append so the new lines' offsets are
  // computed against the verified base size.
  const idx = lineIndexes.get(file);
  let extendFrom: number | null = null;
  if (idx) {
    try {
      extendFrom = (await stat(file)).size === idx.size ? idx.size : null;
    } catch {
      extendFrom = null;
    }
    if (extendFrom === null) lineIndexes.delete(file);
  }

  await appendFile(file, lines, 'utf8');
  for (const e of fresh) seen.add(e.id);

  if (idx && extendFrom !== null) {
    let off = extendFrom;
    for (const line of serialized) {
      idx.offsets.push(off);
      off += Buffer.byteLength(line, 'utf8') + 1;
    }
    idx.size = off;
    try {
      idx.mtimeMs = (await stat(file)).mtimeMs;
    } catch {
      lineIndexes.delete(file);
    }
  }
}

/**
 * Load a page of events ending at the `before` line-index cursor (null =
 * the tail). Returns the page oldest-first plus `prevCursor` — the cursor
 * to pass next time to fetch the preceding page, or null once the start
 * of history is reached.
 */
export async function loadSegment(
  workspaceId: string,
  before: number | null,
  limit: number,
): Promise<{ events: MoxxyEvent[]; prevCursor: number | null }> {
  const restored = await loadSegmentFromSessionLog(workspaceId, before, limit);
  if (restored) return restored;

  const file = fileFor(workspaceId);
  const idx = await lineIndexFor(file);
  if (!idx || idx.offsets.length === 0) return { events: [], prevCursor: null };

  const total = idx.offsets.length;
  const end = before === null ? total : Math.min(before, total);
  const start = Math.max(0, end - limit);
  const prevCursor = start > 0 ? start : null;
  if (end <= start) return { events: [], prevCursor };

  // Seek-read only the page's byte range; the bytes between two valid-line
  // offsets may contain corrupt/empty lines, which the parse loop skips —
  // exactly the lines the index excluded, so the page equals the old
  // whole-file slice byte for byte.
  const byteStart = idx.offsets[start]!;
  const byteEnd = end < total ? idx.offsets[end]! : idx.size;
  let segment: string;
  const handle = await open(file, 'r');
  try {
    const buf = Buffer.alloc(byteEnd - byteStart);
    await handle.read(buf, 0, buf.length, byteStart);
    segment = buf.toString('utf8');
  } finally {
    await handle.close();
  }

  const events: MoxxyEvent[] = [];
  for (const line of segment.split('\n')) {
    if (!line) continue;
    try {
      const event = JSON.parse(line) as MoxxyEvent;
      if (eventBelongsToWorkspace(event, workspaceId)) events.push(event);
    } catch {
      /* skip a corrupt line rather than lose the page */
    }
  }
  return { events, prevCursor };
}

async function loadSegmentFromSessionLog(
  workspaceId: string,
  before: number | null,
  limit: number,
): Promise<{ events: MoxxyEvent[]; prevCursor: number | null } | null> {
  let restored: MoxxyEvent[];
  try {
    restored = await restoreSessionEvents(workspaceId);
  } catch {
    return null;
  }
  if (restored.length === 0) return null;
  const rendered = restored.filter(
    (event) => eventBelongsToWorkspace(event, workspaceId) && isChatEvent(event),
  );
  await repairMirrorFromSessionLog(workspaceId, rendered);
  return segmentFromEvents(rendered, before, limit);
}

async function repairMirrorFromSessionLog(
  workspaceId: string,
  events: ReadonlyArray<MoxxyEvent>,
): Promise<void> {
  const current = await readLines(workspaceId);
  if (
    current.length === events.length &&
    current.every((event, index) => event.id === events[index]?.id)
  ) {
    return;
  }
  const file = fileFor(workspaceId);
  await mkdir(chatsDir(), { recursive: true });
  const body = events.map((event) => JSON.stringify(event) + '\n').join('');
  await writeFileAtomic(file, body);
  writtenIds.delete(file);
  lineIndexes.delete(file);
}

function isChatEvent(event: MoxxyEvent): boolean {
  if (event.type === 'plugin_event') {
    return (event as { pluginId?: string }).pluginId === SUBAGENT_PLUGIN_ID;
  }
  return CHAT_EVENT_TYPES.has(event.type);
}

function eventBelongsToWorkspace(event: MoxxyEvent, workspaceId: string): boolean {
  return event.sessionId === workspaceId;
}

function segmentFromEvents(
  events: ReadonlyArray<MoxxyEvent>,
  before: number | null,
  limit: number,
): { events: MoxxyEvent[]; prevCursor: number | null } {
  const total = events.length;
  const end = before === null ? total : Math.min(before, total);
  const start = Math.max(0, end - limit);
  const prevCursor = start > 0 ? start : null;
  return { events: events.slice(start, end), prevCursor };
}

/** Truncate a workspace's log (Clear conversation). Also drops the
 *  idempotency cache so re-adding the same ids writes them again. */
export async function clearLog(workspaceId: string): Promise<void> {
  // Same per-file lock as appendEvents so a clear can't interleave with an
  // in-flight append (re-appending past the truncate or stranding stale dedup
  // entries that point at a now-deleted file).
  return mutexFor(fileFor(workspaceId)).run(async () => {
    writtenIds.delete(fileFor(workspaceId));
    lineIndexes.delete(fileFor(workspaceId));
    try {
      await rm(fileFor(workspaceId));
    } catch {
      /* already gone */
    }
  });
}

/**
 * One-time migration from the legacy localStorage blobs: the renderer
 * parses its `moxxy:chat:*` keys and hands the events up; we seed the
 * NDJSON log for any workspace that doesn't already have one. Idempotent
 * — never clobbers an existing log.
 *
 * Seeding opens the file with the `wx` flag (O_CREAT|O_EXCL), so the
 * existence check and the write are a SINGLE atomic syscall: a second migrate
 * call, or a live `appendEvents` that created the log first, loses the race
 * cleanly with EEXIST and we skip it — no duplicated seed events.
 */
export async function migrate(
  workspaces: ReadonlyArray<{ workspaceId: string; events: ReadonlyArray<MoxxyEvent> }>,
): Promise<void> {
  if (workspaces.length === 0) return;
  await mkdir(chatsDir(), { recursive: true });
  for (const { workspaceId, events } of workspaces) {
    const ownedEvents = events.filter((event) => eventBelongsToWorkspace(event, workspaceId));
    if (ownedEvents.length === 0) continue;
    // Per-file lock so the exclusive-create seed + cache invalidation can't
    // interleave with a live appendEvents/clearLog for the same workspace.
    await mutexFor(fileFor(workspaceId)).run(async () => {
      const lines = ownedEvents.map((e) => JSON.stringify(e)).join('\n') + '\n';
      let handle;
      try {
        handle = await open(fileFor(workspaceId), 'wx');
      } catch (err) {
        // Log already exists (migrated before, or a live append beat us) → skip.
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return;
        throw err;
      }
      try {
        await handle.writeFile(lines, 'utf8');
        // Force a re-hydrate of the idempotency + line-index caches from the
        // freshly-seeded file, in case a live append/load had already cached
        // this log as empty.
        writtenIds.delete(fileFor(workspaceId));
        lineIndexes.delete(fileFor(workspaceId));
      } finally {
        await handle.close();
      }
    });
  }
}

/**
 * Migrate ONE workspace's history out of this NDJSON mirror into the runner's
 * authoritative session log, IFF the runner doesn't already own that session
 * (no `~/.moxxy/sessions/<id>.jsonl`). After this the renderer reads the chat
 * from `session.loadHistory` like any native session, closing the dual-history
 * split for legacy / localStorage-migrated chats whose history previously lived
 * only here.
 *
 * Called from the runner pool BEFORE a workspace's runner resumes its session
 * id, so the seed is in place when the runner reads it (no race). Idempotent +
 * non-destructive: skips a session the runner already owns and never touches the
 * NDJSON file (which stays the read fallback until the store is retired).
 * Returns whether it seeded.
 */
export async function seedChatIntoSession(
  workspaceId: string,
  sessionsDir: string = defaultSessionsDir(),
): Promise<boolean> {
  try {
    // Non-empty → the runner already owns it. A 0-byte file is the empty log a
    // prior spawn left behind (`persistence.attach` creates it even for a
    // zero-event session), so fall through and migrate the NDJSON into it —
    // else a legacy chat that was ever foregrounded would never migrate.
    if ((await stat(path.join(sessionsDir, `${workspaceId}.jsonl`))).size > 0) return false;
  } catch {
    /* no runner session yet → seed from the NDJSON mirror below */
  }
  const events = await readLines(workspaceId);
  if (events.length === 0) return false;
  return seedSessionLog(workspaceId, events, sessionsDir);
}

/**
 * Eagerly migrate EVERY workspace that still has an NDJSON-only history into the
 * runner's authoritative log, completing the consolidation for chats the user
 * hasn't opened yet (opened chats already migrate via the runner pool's
 * {@link seedChatIntoSession}). After this the runner is the single source of
 * truth for ALL chats, not just opened ones. Idempotent + best-effort +
 * non-destructive: skips chats the runner already owns, leaves the NDJSON files
 * intact, and one unreadable chat never aborts the rest. Returns the count
 * migrated.
 */
export async function migrateAllChatsToSessions(sessionsDir?: string): Promise<number> {
  let files: string[];
  try {
    files = await readdir(chatsDir());
  } catch {
    return 0; // no chats dir yet → nothing to migrate
  }
  let migrated = 0;
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const workspaceId = file.slice(0, -'.jsonl'.length);
    try {
      if (await seedChatIntoSession(workspaceId, sessionsDir)) migrated += 1;
    } catch {
      /* skip this chat; migrate the rest */
    }
  }
  return migrated;
}
