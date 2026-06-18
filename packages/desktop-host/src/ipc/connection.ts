/**
 * Connection lifecycle queries.
 *
 * Each handler reads a supervisor {@link RunnerSupervisor.snapshot} (or
 * pokes {@link RunnerSupervisor.forceRetry}) for the targeted workspace,
 * defaulting to the pool's active workspace so the renderer can query
 * background workspaces without switching. The renderer learns about
 * *changes* via the `connection.changed` event from `bindWindow`; these
 * RPCs are for cold-start priming and the manual Retry button.
 */

import { type RunnerPool } from '../runner-pool';
import { handle, resolveSupervisor } from './shared';

export function registerConnectionHandlers(pool: RunnerPool): void {
  // ---- Connection ----------------------------------------------------------

  handle('connection.snapshotAll', async () =>
    pool.list().map((e) => ({ workspaceId: e.id, ...e.supervisor.snapshot() })),
  );
  handle('connection.activeWorkspace', async () => pool.activeWorkspaceId());
  handle('connection.retry', async (args) => {
    // Route the active-workspace fallback through the shared resolver rather
    // than re-implementing `?? activeWorkspaceId()` inline.
    resolveSupervisor(pool, args?.workspaceId)?.forceRetry();
  });
}
