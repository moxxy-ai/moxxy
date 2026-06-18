/**
 * Chat transcript log.
 *
 * `chat.append` / `chat.loadSegment` / `chat.clearLog` / `chat.migrate` are
 * thin pass-throughs to the append-only NDJSON `chat-log` store, lazily
 * imported and keyed by `workspaceId`.
 *
 * `chat.loadHistory` is the runner-authoritative read path (protocol v10): it
 * pages history straight from the workspace's connected `RemoteSession`'s log
 * instead of the NDJSON mirror, and returns `null` when the runner can't serve
 * it (no connected runner for the workspace, or a `<v10` runner) so the renderer
 * falls back to `chat.loadSegment` — no transcript ever goes blank.
 */

import type { RunnerPool } from '../runner-pool';
import { handle, resolveSupervisor } from './shared';

export function registerChatHandlers(pool: RunnerPool): void {
  // ---- Chat transcript log (append-only NDJSON) ---------------------------

  handle('chat.append', async ({ workspaceId, events }) => {
    const { appendEvents } = await import('../chat-log');
    await appendEvents(workspaceId, events);
  });
  handle('chat.loadSegment', async ({ workspaceId, before, limit }) => {
    const { loadSegment } = await import('../chat-log');
    return loadSegment(workspaceId, before, limit);
  });
  // Runner-authoritative paged read (v10). Resolve the workspace's connected
  // RemoteSession and page its log; any miss (no supervisor / not connected /
  // older runner whose gate throws / transport error) returns null so the
  // renderer transparently falls back to the NDJSON store.
  handle('chat.loadHistory', async ({ workspaceId, before, limit }) => {
    const session = resolveSupervisor(pool, workspaceId)?.remote();
    if (!session) return null;
    try {
      return await session.loadHistory(before, limit);
    } catch {
      return null;
    }
  });
  handle('chat.clearLog', async ({ workspaceId }) => {
    const { clearLog } = await import('../chat-log');
    await clearLog(workspaceId);
  });
  handle('chat.migrate', async ({ workspaces }) => {
    const { migrate } = await import('../chat-log');
    await migrate(workspaces);
  });
}
