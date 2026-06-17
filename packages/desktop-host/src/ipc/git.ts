/**
 * Read-only git IPC for the "Files changed" pane + diff viewer. Resolves the
 * workspace cwd the same way `workspace.listDir` does, then delegates to the
 * read-only helpers in `../git` (status / diff). Never mutates the repo.
 */

import type { DeskStore } from '../desks';
import { handle } from './shared';
import { cwdForWorkspace } from './workspace-fs';

export function registerGitHandlers(desks: DeskStore): void {
  handle('git.isRepo', async ({ workspaceId }) => {
    const { isRepo } = await import('../git');
    return isRepo(await cwdForWorkspace(desks, workspaceId));
  });

  handle('git.status', async ({ workspaceId }) => {
    const { status } = await import('../git');
    return [...(await status(await cwdForWorkspace(desks, workspaceId)))];
  });

  handle('git.diff', async ({ workspaceId, path: filePath }) => {
    const { diff } = await import('../git');
    return diff(await cwdForWorkspace(desks, workspaceId), filePath);
  });
}
