/**
 * Transcript history — the seam between the chat store and the authoritative
 * session log (via `chat.loadHistory`). The store stays storage-agnostic: it
 * calls this interface and never touches the transport directly. The desktop
 * host can page validated JSONL before the runner attaches, then serve the
 * runner's live log once connected. The old renderer-side mirror stays retired.
 */

import { api } from './transport.js';
import type { MoxxyEvent } from '@moxxy/sdk';

/** How many rendered events to load on first open, and per scroll-up page. */
export const INITIAL_WINDOW = 50;
export const OLDER_PAGE = 50;

export interface ChatPersistence {
  /**
   * Page history from the session's authoritative log. `before` is a `seq`
   * cursor; the page is RAW events (the caller filters to rendered rows).
   * Resolves `null` only when the host cannot authorize or read the session.
   */
  loadHistory(
    workspaceId: string,
    before: number | null,
    limit: number,
  ): Promise<{ events: ReadonlyArray<MoxxyEvent>; prevCursor: number | null } | null>;
}

/** The production backend: an IPC round-trip to the authoritative session log.
 *  Best-effort — a transport error (or, in tests, an unconfigured transport)
 *  resolves `null` rather than throwing into the store. */
export function createIpcPersistence(): ChatPersistence {
  return {
    async loadHistory(workspaceId, before, limit) {
      try {
        return await api().invoke('chat.loadHistory', { workspaceId, before, limit });
      } catch {
        return null;
      }
    },
  };
}
