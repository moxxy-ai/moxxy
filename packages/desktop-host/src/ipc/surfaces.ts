/**
 * Agentic-surface relay (terminal · browser; runner protocol v8).
 *
 * Surfaces are RUNNER-OWNED — the PTY / Playwright page live in the runner
 * alongside the agent's tools. These handlers just relay the renderer's
 * `surface.*` calls to the workspace's {@link RemoteSession}; the runner streams
 * each frame back as a `surface.data` notification, which {@link SessionDriver}
 * forwards to the renderer as the `surface.data` IPC event. Nothing here is on
 * the mobile WS allow-list — a shell/browser over a tunnel is out of scope.
 */

import type { RunnerPool } from '../runner-pool';
import { handle, resolveCtx } from './shared';

export function registerSurfaceHandlers(pool: RunnerPool): void {
  handle('surface.list', async ({ workspaceId }) => {
    // Degrade cleanly before attach (no session yet) — the dropdown just
    // shows nothing rather than erroring.
    const { session } = resolveCtx(pool, { workspaceId }, { requireSession: false });
    return session ? session.listSurfaces() : [];
  });

  handle('surface.open', async ({ workspaceId, kind }) => {
    const { session } = resolveCtx(pool, { workspaceId });
    return session.openSurface(kind);
  });

  handle('surface.input', async ({ workspaceId, surfaceId, message }) => {
    const { session } = resolveCtx(pool, { workspaceId });
    await session.inputSurface(surfaceId, message);
  });

  handle('surface.resize', async ({ workspaceId, surfaceId, size }) => {
    const { session } = resolveCtx(pool, { workspaceId });
    await session.resizeSurface(surfaceId, size);
  });

  handle('surface.close', async ({ workspaceId, surfaceId }) => {
    const { session } = resolveCtx(pool, { workspaceId });
    await session.closeSurface(surfaceId);
  });
}
