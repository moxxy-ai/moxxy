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

import { appendFile, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { MoxxyEvent } from '@moxxy/sdk';

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
      out.push(JSON.parse(line) as MoxxyEvent);
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
  const seen = await knownIds(workspaceId);
  const fresh = events.filter((e) => !seen.has(e.id));
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
      events.push(JSON.parse(line) as MoxxyEvent);
    } catch {
      /* skip a corrupt line rather than lose the page */
    }
  }
  return { events, prevCursor };
}

/** Truncate a workspace's log (Clear conversation). Also drops the
 *  idempotency cache so re-adding the same ids writes them again. */
export async function clearLog(workspaceId: string): Promise<void> {
  writtenIds.delete(fileFor(workspaceId));
  lineIndexes.delete(fileFor(workspaceId));
  try {
    await rm(fileFor(workspaceId));
  } catch {
    /* already gone */
  }
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
    if (events.length === 0) continue;
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    let handle;
    try {
      handle = await open(fileFor(workspaceId), 'wx');
    } catch (err) {
      // Log already exists (migrated before, or a live append beat us) → skip.
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
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
  }
}
