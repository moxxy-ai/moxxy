/**
 * Chat transcript history — page the authoritative session log without making
 * first paint wait for a runner. A connected runner serves its live in-memory
 * log; while it is still starting, the host reads the same validated JSONL
 * directly. There is no renderer-side history mirror to reconcile.
 */

import { readSessionEventPage, type EventPage } from '@moxxy/core';
import type { RunnerPool } from '../runner-pool';
import { UNBOUND_ID } from '../runner-pool';
import type { DeskStore } from '../desks';
import { handle, resolveSupervisor } from './shared';

type HistoryReader = (
  sessionId: string,
  opts: { readonly before: number | null; readonly limit: number },
) => Promise<EventPage>;

export function registerChatHandlers(
  pool: RunnerPool,
  desks: DeskStore,
  readHistory: HistoryReader = readSessionEventPage,
): void {
  handle('chat.loadHistory', async ({ workspaceId, before, limit }) => {
    const session = resolveSupervisor(pool, workspaceId)?.remote();
    if (session) {
      try {
        return await session.loadHistory(before, limit);
      } catch {
        // The runner may have dropped between lookup and read. Its persisted
        // log is still safe to page below.
      }
    }

    if (!(await isReadableSession(workspaceId, desks))) return null;
    try {
      return await readHistory(workspaceId, { before, limit });
    } catch {
      return null;
    }
  });
}

async function isReadableSession(workspaceId: string, desks: DeskStore): Promise<boolean> {
  if (workspaceId === UNBOUND_ID) return true;
  try {
    return (await desks.deskForSession(workspaceId)) !== null;
  } catch {
    // A corrupt/unreadable registry must fail closed at this trust boundary.
    return false;
  }
}
