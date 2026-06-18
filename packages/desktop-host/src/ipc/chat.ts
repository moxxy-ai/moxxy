/**
 * Chat transcript history — read straight from the runner's authoritative log.
 *
 * `chat.loadHistory` pages history from the workspace's connected
 * `RemoteSession` (`session.loadHistory`, protocol v10). It is the SOLE
 * chat-history source now that the NDJSON mirror is retired; it returns `null`
 * when no runner is connected for the workspace (the renderer shows an empty
 * transcript until the runner attaches).
 */

import type { RunnerPool } from '../runner-pool';
import { handle, resolveSupervisor } from './shared';

export function registerChatHandlers(pool: RunnerPool): void {
  handle('chat.loadHistory', async ({ workspaceId, before, limit }) => {
    const session = resolveSupervisor(pool, workspaceId)?.remote();
    if (!session) return null;
    try {
      return await session.loadHistory(before, limit);
    } catch {
      return null;
    }
  });
}
