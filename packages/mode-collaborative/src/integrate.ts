/**
 * Integration phase: take each done agent's worktree, merge the branches onto
 * a throwaway staging branch (resolving conflicts by file ownership), and — when
 * the policy allows and nothing is unresolved — promote the staged result into
 * the user's checkout. The user's branch is only ever advanced at the final
 * promote; a conflict leaves the offending branch for inspection.
 */

import type { BoardItem } from '@moxxy/plugin-collab';
import { collabBranch, stagingBranch, worktreePath } from './constants.js';
import {
  addWorktree,
  commitAll,
  deleteBranch,
  mergeWithOwnership,
  promoteStaging,
  removeWorktree,
} from './worktrees.js';

/** Normalize a claim/file path for prefix comparison — must mirror plugin-collab's
 *  `normPath` (the basis of `pathsConflict`) so ownership resolution is unchanged:
 *  backslashes → '/', strip a leading './', strip trailing slashes. */
function normClaimPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

export interface IntegrateInput {
  readonly repoCwd: string;
  readonly runId: string;
  readonly baseSha: string;
  readonly doneAgentIds: ReadonlyArray<string>;
  readonly worktrees: ReadonlyMap<string, string>;
  readonly board: ReadonlyArray<BoardItem>;
  readonly mergePolicy: 'auto-into-branch' | 'stage-only';
  /** When true, the merged result is left on the staging branch for the user to
   *  verify (build/test) before they promote it — auto-promotion is suppressed
   *  even under `auto-into-branch`. Was previously dead config that silently
   *  no-op'd; now it actually gates promotion. */
  readonly verifyGate?: boolean;
}

export interface IntegrateResult {
  readonly merged: ReadonlyArray<string>;
  readonly conflicts: ReadonlyArray<{ agentId: string; files: ReadonlyArray<string> }>;
  readonly resolvedByOwnership: ReadonlyArray<{ file: string; owner: string }>;
  readonly stagingBranch: string;
  readonly promoted: boolean;
}

export async function integrate(input: IntegrateInput): Promise<IntegrateResult> {
  const { repoCwd, runId, baseSha, doneAgentIds, worktrees, board, mergePolicy, verifyGate } = input;
  const branchName = stagingBranch(runId);
  const merged: string[] = [];
  const conflicts: Array<{ agentId: string; files: ReadonlyArray<string> }> = [];
  const resolvedByOwnership: Array<{ file: string; owner: string }> = [];

  // Commit each done peer's worktree so its branch carries the work to merge.
  for (const id of doneAgentIds) {
    const wt = worktrees.get(id);
    if (wt) await commitAll(wt, `moxxy-collab: ${id}`);
  }

  // Ownership resolver from board file-claims. Pre-normalize each claim path ONCE
  // (built before the merge loop, reused across every agent) so the per-conflicted
  // -file lookup compares pre-normalized strings instead of re-running `normPath`
  // on both sides for every claim on every call — the per-comparison allocation
  // that made this O(N·F·C) on the critical integration path. Board order is kept,
  // so first-claim-wins ownership is identical to the previous pathsConflict scan.
  const normClaims: Array<{ owner: string; norm: string }> = [];
  for (const item of board) {
    if (!item.owner || !item.paths) continue;
    for (const p of item.paths) normClaims.push({ owner: item.owner, norm: normClaimPath(p) });
  }
  const ownerOf = (file: string): string | undefined => {
    const f = normClaimPath(file);
    for (const c of normClaims) {
      if (f === c.norm || f.startsWith(`${c.norm}/`) || c.norm.startsWith(`${f}/`)) return c.owner;
    }
    return undefined;
  };

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
  // `verifyGate` holds the merged result on the staging branch so the user can
  // build/test it before promoting — so even under auto-into-branch we don't
  // advance their branch automatically when the gate is on.
  if (mergePolicy === 'auto-into-branch' && merged.length > 0 && !verifyGate) {
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
