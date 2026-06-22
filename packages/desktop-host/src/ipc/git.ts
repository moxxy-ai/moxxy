/**
 * Read-only git IPC for the "Files changed" pane + diff viewer. Resolves the
 * workspace cwd the same way `workspace.listDir` does, then delegates to the
 * read-only helpers in `../git` (status / diff). Never mutates the repo.
 */

import path from 'node:path';
import { realpath } from 'node:fs/promises';

import type { DeskStore } from '../desks';
import { handle, IpcError } from './shared';
import { cwdForWorkspace } from './workspace-fs';

/** True iff `abs` is `root` or lives strictly underneath it. */
function isInside(root: string, abs: string): boolean {
  return abs === root || abs.startsWith(root + path.sep);
}

/**
 * Confine a renderer-supplied diff target to the workspace cwd before it can
 * reach `git diff --no-index`, which would otherwise operate on ANY filesystem
 * path (ignoring repo boundaries) and stream out-of-workspace file contents
 * back to the renderer. Mirrors the path-resolve + symlink-escape guard
 * `workspace.readFile` applies — the only other renderer-driven file-read
 * surface. Returns a path relative to `root` for `git` (run in `root`); throws
 * an `invalid-payload` IpcError on traversal / absolute / symlink escape.
 */
export async function confineDiffPath(cwd: string, filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
    throw new IpcError('invalid-payload', 'invalid diff path');
  }
  // Canonicalise the root so the symlink comparison is like-for-like
  // (e.g. macOS /var → /private/var), matching workspace-fs.ts.
  const root = await realpath(cwd).catch(() => path.resolve(cwd));
  const candidate = path.resolve(root, filePath);
  if (!isInside(root, candidate)) {
    throw new IpcError('invalid-payload', `path "${filePath}" escapes the workspace root`);
  }
  // A symlink inside the root could still point out of it; reject if the real
  // target escapes. A path that doesn't exist yet is fine — string-level
  // confinement above already holds and there is nothing on disk to leak.
  try {
    const real = await realpath(candidate);
    if (!isInside(root, real)) {
      throw new IpcError('invalid-payload', `path "${filePath}" escapes the workspace root via a symlink`);
    }
  } catch (err) {
    if (err instanceof IpcError) throw err;
    // ENOENT etc. — untracked/new file; string confinement is sufficient.
  }
  // Hand git a path relative to the cwd it runs in.
  return path.relative(root, candidate) || '.';
}

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
    const cwd = await cwdForWorkspace(desks, workspaceId);
    const safePath = await confineDiffPath(cwd, filePath);
    return diff(cwd, safePath);
  });
}
