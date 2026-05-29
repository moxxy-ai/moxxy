/**
 * Transcript persistence — the renderer-side seam between the chat store
 * and durable storage. This localStorage implementation is the interim
 * backend; Phase 7 swaps the body for an IPC-backed append-only NDJSON
 * log in the main process (no ~5 MB origin cap, cursor pagination) while
 * keeping this module's surface (`loadPersistedEvents` / `persistEvents`
 * / `removePersisted` / `loadAllPersisted`) unchanged.
 *
 * Only committed runner events are stored — never the in-flight stream —
 * so writes are cheap and the persisted shape matches the store's log.
 */

import type { MoxxyEvent } from '@moxxy/sdk';

export interface PersistedChat {
  readonly events: ReadonlyArray<MoxxyEvent>;
}

const PREFIX = 'moxxy:chat:';
/** v2 = event-log format. v1 (flat Block[]) blobs are ignored on read. */
const VERSION = 2;
/** Interim cap: localStorage shares a ~5 MB origin budget across all
 *  workspaces. Keep the most-recent slice; full history arrives with the
 *  Phase 7 NDJSON backend. */
const MAX_EVENTS = 2000;

interface Envelope {
  readonly version: number;
  readonly events: ReadonlyArray<MoxxyEvent>;
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function loadPersistedEvents(workspaceId: string): PersistedChat | null {
  if (!hasStorage()) return null;
  try {
    const raw = localStorage.getItem(PREFIX + workspaceId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Envelope> | null;
    if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.events)) return null;
    return { events: parsed.events };
  } catch {
    return null;
  }
}

export function persistEvents(workspaceId: string, chat: PersistedChat): void {
  if (!hasStorage()) return;
  const events =
    chat.events.length > MAX_EVENTS ? chat.events.slice(-MAX_EVENTS) : chat.events;
  const envelope: Envelope = { version: VERSION, events };
  try {
    localStorage.setItem(PREFIX + workspaceId, JSON.stringify(envelope));
  } catch {
    /* QuotaExceeded — drop persistence rather than crash */
  }
}

export function removePersisted(workspaceId: string): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(PREFIX + workspaceId);
  } catch {
    /* ignore */
  }
}

export function loadAllPersisted(): ReadonlyArray<{ id: string; events: ReadonlyArray<MoxxyEvent> }> {
  if (!hasStorage()) return [];
  const out: { id: string; events: ReadonlyArray<MoxxyEvent> }[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const id = key.slice(PREFIX.length);
    const chat = loadPersistedEvents(id);
    if (chat && chat.events.length > 0) out.push({ id, events: chat.events });
  }
  return out;
}
