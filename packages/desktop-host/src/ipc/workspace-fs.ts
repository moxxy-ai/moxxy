/**
 * Workspace filesystem browsing.
 *
 * `workspace.listDir` resolves the requested directory against the
 * targeted desk's cwd (looked up by workspace id so background
 * workspaces can be browsed too); {@link listDir} enforces the "stay
 * below the cwd" guard so the renderer can never traverse out of the
 * workspace.
 */

import type { DeskStore } from '../desks';
import { handle } from './shared';

/**
 * Resolve a workspace id to its cwd. The routing id is a SESSION id (the pool
 * key), so match a desk by id OR by owning the session — first sessions share
 * their desk's id, so both arms hit. Falls back to the active desk, then
 * `process.cwd()`. Exported so the git handlers resolve cwd identically.
 */
export async function cwdForWorkspace(desks: DeskStore, workspaceId?: string): Promise<string> {
  // Resolve from a SINGLE load(): the id/session match and the active-desk
  // fallback both come out of the same DeskDoc, so the common Files-pane path
  // (git.isRepo + git.status back-to-back) no longer re-reads + re-parses
  // desks.json two or three times per render.
  const doc = await desks.load();
  const desk =
    doc.desks.find((d) => d.id === workspaceId || d.sessions.some((s) => s.id === workspaceId)) ??
    doc.desks.find((d) => d.id === doc.activeId) ??
    null;
  return desk?.cwd ?? process.cwd();
}

export function registerWorkspaceFsHandlers(desks: DeskStore): void {
  // ---- Workspace filesystem browsing --------------------------------------

  handle('workspace.listDir', async ({ workspaceId, path: relPath }) => {
    const { listDir } = await import('../workspace-fs');
    const cwd = await cwdForWorkspace(desks, workspaceId);
    return listDir(cwd, relPath);
  });

  handle('workspace.readFile', async ({ workspaceId, path: relPath, force }) => {
    const { readFile } = await import('../workspace-fs');
    const cwd = await cwdForWorkspace(desks, workspaceId);
    return readFile(cwd, relPath, { force });
  });
}
