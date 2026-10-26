/**
 * Chat transcript history — page the authoritative session log without making
 * first paint wait for a runner. A connected runner serves its live in-memory
 * log; while it is still starting, the host reads the same validated JSONL
 * directly. There is no renderer-side history mirror to reconcile.
 */

import { readSessionEventPage, type EventPage } from '@moxxy/core';
import { historyPageForClient, readAttachmentChunk } from '@moxxy/sdk';
import { channelSessionId } from '@moxxy/runner';
import { listChannelCatalog } from '../channel-catalog';
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
      // The same client form the runner serves: a scanned PDF in the log must
      // not reach the window as one huge page while the runner starts.
      return historyPageForClient(await readHistory(workspaceId, { before, limit }));
    } catch {
      return null;
    }
  });

  handle('chat.readAttachment', async ({ workspaceId, seq, index, offset }) => {
    const session = resolveSupervisor(pool, workspaceId)?.remote();
    if (session) {
      try {
        return await session.readAttachment(seq, index, offset);
      } catch {
        // Dropped mid-read, or an older runner: the persisted log has the bytes too.
      }
    }

    if (!(await isReadableSession(workspaceId, desks))) return null;
    try {
      const { events } = await readHistory(workspaceId, { before: seq + 1, limit: 1 });
      const found = events[0];
      if (!found || found.seq !== seq) return null;
      return readAttachmentChunk(found, index, offset);
    } catch {
      return null;
    }
  });
}

/** Whether this desktop may read the session's log: one of its chats, a catalog bot's, or the startup one. */
export async function isReadableSession(workspaceId: string, desks: DeskStore): Promise<boolean> {
  if (workspaceId === UNBOUND_ID) return true;
  // A channel bot's conversation (its sticky session) stays readable while the
  // bot is down — but only for catalog channels, never a guessed id.
  if (listChannelCatalog().some((e) => channelSessionId(e.descriptor.id) === workspaceId)) return true;
  try {
    return (await desks.deskForSession(workspaceId)) !== null;
  } catch {
    // A corrupt/unreadable registry must fail closed at this trust boundary.
    return false;
  }
}
