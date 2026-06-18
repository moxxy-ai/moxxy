/**
 * Transcript history — the seam between the chat store and the runner's
 * AUTHORITATIVE log (via the `chat.loadHistory` IPC). The store stays
 * storage-agnostic: it calls this interface and never touches the transport
 * directly. (The desktop's old NDJSON mirror — append + segment reads + the
 * one-time localStorage migration — has been retired; the runner log is the
 * sole chat-history store.)
 */

import { api } from './transport.js';
import type { MoxxyEvent } from '@moxxy/sdk';

/** How many rendered events to load on first open, and per scroll-up page. */
export const INITIAL_WINDOW = 50;
export const OLDER_PAGE = 50;

export interface ChatPersistence {
  /**
   * Page history from the RUNNER's authoritative log (`chat.loadHistory`,
   * protocol v10). `before` is a `seq` cursor; the page is RAW events (the
   * caller filters to rendered rows). Resolves `null` when the runner can't
   * serve it (no connected runner for the workspace) — the store then shows an
   * empty transcript until the runner attaches.
   */
  loadHistory(
    workspaceId: string,
    before: number | null,
    limit: number,
  ): Promise<{ events: ReadonlyArray<MoxxyEvent>; prevCursor: number | null } | null>;
}

/** The production backend: an IPC round-trip to the runner's authoritative log.
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
