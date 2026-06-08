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

import { appendFile, mkdir, open, readFile, rm } from 'node:fs/promises';
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
 * Why idempotent: on every desktop restart the runner replays its FULL event
 * history to each attaching client (runner attach replays from seq 0), and the
 * renderer re-appends every replayed event here. Without dedup the NDJSON log
 * grew by a complete copy of the conversation on each restart — and because
 * {@link loadSegment}'s cursor is a line index, a doubled file also corrupted
 * scroll-up pagination. Deduping by id keeps the log one copy and its cursors
 * stable. (The runner session log remains the source of truth on replay; this
 * file is the renderer's windowed mirror.)
 */
const writtenIds = new Map<string, Set<string>>();

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
  const lines = fresh.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await appendFile(fileFor(workspaceId), lines, 'utf8');
  for (const e of fresh) seen.add(e.id);
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
  const all = await readLines(workspaceId);
  const end = before === null ? all.length : Math.min(before, all.length);
  const start = Math.max(0, end - limit);
  return { events: all.slice(start, end), prevCursor: start > 0 ? start : null };
}

/** Truncate a workspace's log (Clear conversation). Also drops the
 *  idempotency cache so re-adding the same ids writes them again. */
export async function clearLog(workspaceId: string): Promise<void> {
  writtenIds.delete(fileFor(workspaceId));
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
      // Force a re-hydrate of the idempotency cache from the freshly-seeded
      // file, in case a live append had already cached this log as empty.
      writtenIds.delete(fileFor(workspaceId));
    } finally {
      await handle.close();
    }
  }
}
