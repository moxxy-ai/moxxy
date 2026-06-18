/**
 * Integration phase: take each done agent's worktree, merge the branches onto
 * a throwaway staging branch (resolving conflicts by file ownership), and — when
 * the policy allows and nothing is unresolved — promote the staged result into
 * the user's checkout. The user's branch is only ever advanced at the final
 * promote; a conflict leaves the offending branch for inspection.
 */

import { pathsConflict, type BoardItem } from '@moxxy/plugin-collab';
import { collabBranch, stagingBranch, worktreePath } from './constants.js';
import {
  addWorktree,
  commitAll,
  deleteBranch,
  mergeWithOwnership,
  promoteStaging,
  removeWorktree,
} from './worktrees.js';

export interface IntegrateInput {
  readonly repoCwd: string;
  readonly runId: string;
  readonly baseSha: string;
  readonly doneAgentIds: ReadonlyArray<string>;
  readonly worktrees: ReadonlyMap<string, string>;
  readonly board: ReadonlyArray<BoardItem>;
  readonly mergePolicy: 'auto-into-branch' | 'stage-only';
}

export interface IntegrateResult {
  readonly merged: ReadonlyArray<string>;
  readonly conflicts: ReadonlyArray<{ agentId: string; files: ReadonlyArray<string> }>;
  readonly resolvedByOwnership: ReadonlyArray<{ file: string; owner: string }>;
  readonly stagingBranch: string;
  readonly promoted: boolean;
}

export async function integrate(input: IntegrateInput): Promise<IntegrateResult> {
  const { repoCwd, runId, baseSha, doneAgentIds, worktrees, board, mergePolicy } = input;
  const branchName = stagingBranch(runId);
  const merged: string[] = [];
  const conflicts: Array<{ agentId: string; files: ReadonlyArray<string> }> = [];
  const resolvedByOwnership: Array<{ file: string; owner: string }> = [];

  // Commit each done peer's worktree so its branch carries the work to merge.
  for (const id of doneAgentIds) {
    const wt = worktrees.get(id);
    if (wt) await commitAll(wt, `moxxy-collab: ${id}`);
  }

  // Ownership resolver from board file-claims.
  const claims: Array<{ owner: string; path: string }> = [];
  for (const item of board) {
    if (item.owner && item.paths) for (const p of item.paths) claims.push({ owner: item.owner, path: p });
  }
  const ownerOf = (file: string): string | undefined =>
    claims.find((c) => pathsConflict(file, c.path))?.owner;

  const staging = worktreePath(runId, '__staging__');
  await addWorktree({ repoCwd, path: staging, branch: branchName, baseSha });

  for (const id of doneAgentIds) {
    if (!worktrees.has(id)) continue;
    const m = await mergeWithOwnership(staging, collabBranch(runId, id), id, ownerOf);
    if (m.ok) {
      merged.push(id);
      resolvedByOwnership.push(...m.resolved);
    } else {
      conflicts.push({ agentId: id, files: m.unresolved });
    }
  }

  let promoted = false;
  if (mergePolicy === 'auto-into-branch' && merged.length > 0) {
    promoted = await promoteStaging(repoCwd, branchName);
  }

  // Cleanup. Keep conflicted branches (and the staging branch) for inspection.
  await removeWorktree(repoCwd, staging).catch(() => undefined);
  for (const id of doneAgentIds) {
    const wt = worktrees.get(id);
    if (wt) await removeWorktree(repoCwd, wt).catch(() => undefined);
  }
  if (conflicts.length === 0) {
    for (const id of merged) await deleteBranch(repoCwd, collabBranch(runId, id)).catch(() => undefined);
    if (promoted) await deleteBranch(repoCwd, branchName).catch(() => undefined);
  }

  return { merged, conflicts, resolvedByOwnership, stagingBranch: branchName, promoted };
}
