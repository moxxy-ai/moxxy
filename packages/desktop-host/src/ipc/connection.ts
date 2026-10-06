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

import type { DeskStore } from '../desks';
import { type RunnerPool } from '../runner-pool';
import { handle, resolveSupervisor } from './shared';

export function registerConnectionHandlers(pool: RunnerPool, desks: DeskStore): void {
  // ---- Connection ----------------------------------------------------------

  handle('connection.snapshotAll', async () =>
    pool.list().map((e) => ({ workspaceId: e.id, ...e.supervisor.snapshot() })),
  );
  // The saved active session is the answer until its runner is foregrounded.
  // Answering null while the first runner is still starting left the renderer
  // with no active workspace — stuck on "Waiting for workspace information…".
  handle(
    'connection.activeWorkspace',
    async () => pool.activeWorkspaceId() ?? (await desks.getActive())?.activeSessionId ?? null,
  );
  handle('connection.retry', async (args) => {
    // Route the active-workspace fallback through the shared resolver rather
    // than re-implementing `?? activeWorkspaceId()` inline.
    resolveSupervisor(pool, args?.workspaceId)?.forceRetry();
  });
}
