/**
 * Transcript persistence — the seam between the chat store and the
 * durable main-process NDJSON log (see the desktop host's chat-log), spoken
 * over IPC. The store stays storage-agnostic: it calls this interface and
 * never touches the transport or a key-value store directly.
 *
 * Also houses the one-time migration off the legacy localStorage blobs the
 * interim desktop backend wrote (`moxxy:chat:<id>`, v2 = event arrays). That
 * migration runs only on a platform that registers a {@link KeyValueStore}
 * capability (the desktop); elsewhere (mobile) it's a no-op.
 */

import { api } from './transport.js';
import { getPlatform, type KeyValueStore } from './platform.js';
import type { MoxxyEvent } from '@moxxy/sdk';

/** How many events to load on first open, and per scroll-up page. */
export const INITIAL_WINDOW = 50;
export const OLDER_PAGE = 50;

export interface ChatPersistence {
  loadSegment(
    workspaceId: string,
    before: number | null,
    limit: number,
  ): Promise<{ events: ReadonlyArray<MoxxyEvent>; prevCursor: number | null }>;
  /**
   * Page history from the RUNNER's authoritative log (protocol v10) instead of
   * the NDJSON mirror. `before` is a `seq` cursor and the page is RAW events
   * (the caller filters to rendered rows). Resolves `null` when the runner can't
   * serve it (no connected runner / a `<v10` runner) — the store then falls back
   * to {@link loadSegment}. Optional so a backend without a runner path (or a
   * test fake) simply degrades to NDJSON.
   */
  loadHistory?(
    workspaceId: string,
    before: number | null,
    limit: number,
  ): Promise<{ events: ReadonlyArray<MoxxyEvent>; prevCursor: number | null } | null>;
  append(workspaceId: string, events: ReadonlyArray<MoxxyEvent>): Promise<void>;
  clear(workspaceId: string): Promise<void>;
}

/** The production backend: every call is an IPC round-trip to the main
 *  process's append-only NDJSON log. Persistence is best-effort — a
 *  transport error (or, in tests, an unconfigured transport) degrades to a
 *  no-op rather than throwing into the store. */
export function createIpcPersistence(): ChatPersistence {
  return {
    async loadSegment(workspaceId, before, limit) {
      try {
        return await api().invoke('chat.loadSegment', { workspaceId, before, limit });
      } catch {
        return { events: [], prevCursor: null };
      }
    },
    async loadHistory(workspaceId, before, limit) {
      try {
        // null result = the runner can't serve it (no connected runner / <v10);
        // a thrown transport error is treated the same. Either way the store
        // falls back to loadSegment (NDJSON), so no transcript goes blank.
        return await api().invoke('chat.loadHistory', { workspaceId, before, limit });
      } catch {
        return null;
      }
    },
    async append(workspaceId, events) {
      if (events.length === 0) return;
      try {
        await api().invoke('chat.append', { workspaceId, events });
      } catch {
        /* best-effort */
      }
    },
    async clear(workspaceId) {
      try {
        await api().invoke('chat.clearLog', { workspaceId });
      } catch {
        /* best-effort */
      }
    },
  };
}

// ---- one-time localStorage → NDJSON migration -----------------------------

const LEGACY_PREFIX = 'moxxy:chat:';
const MIGRATED_FLAG = 'moxxy:chat:migrated-to-ndjson';
const LEGACY_VERSION = 2;

/**
 * On first boot of this version, drain any legacy localStorage chat blobs into
 * the main-process NDJSON log (idempotent — the main side skips workspaces that
 * already have a file), then delete the blobs so the ~5 MB origin budget is
 * reclaimed. Runs once, guarded by a flag. No-op when no {@link KeyValueStore}
 * capability is registered (i.e. anything that isn't the legacy desktop origin).
 */
export async function migrateLegacyChats(
  kv: KeyValueStore | undefined = getPlatform().kv,
): Promise<void> {
  if (!kv) return;
  if (kv.getItem(MIGRATED_FLAG)) return;

  const workspaces: { workspaceId: string; events: MoxxyEvent[] }[] = [];
  const keys: string[] = [];
  for (let i = 0; i < kv.length; i += 1) {
    const key = kv.key(i);
    if (!key?.startsWith(LEGACY_PREFIX) || key === MIGRATED_FLAG) continue;
    keys.push(key);
    try {
      const raw = kv.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { version?: number; events?: MoxxyEvent[] } | null;
      if (!parsed || parsed.version !== LEGACY_VERSION || !Array.isArray(parsed.events)) continue;
      if (parsed.events.length > 0) {
        workspaces.push({ workspaceId: key.slice(LEGACY_PREFIX.length), events: parsed.events });
      }
    } catch {
      /* corrupt blob → drop it (it's removed below regardless) */
    }
  }

  try {
    if (workspaces.length > 0) await api().invoke('chat.migrate', { workspaces });
    for (const key of keys) kv.removeItem(key);
    kv.setItem(MIGRATED_FLAG, '1');
  } catch {
    /* leave the flag unset so we retry next boot rather than lose data */
  }
}
