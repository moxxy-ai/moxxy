/**
 * Git worktree + staged-merge engine. Each agent edits in its own worktree off
 * a shared base commit (physical isolation); integration happens on a throwaway
 * staging branch, never on the user's branch until a clean result is promoted.
 * Conflicts are surfaced (with the conflicting files) for the coordinator's
 * resolution ladder — never written as raw markers into the user's tree.
 *
 * All git calls go through `git()`, which captures output regardless of exit
 * code (git returns non-zero on merge conflicts, which we handle, not throw).
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PeerReader } from '@moxxy/plugin-collab';

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// A stable identity so commits work even where the repo/user has none (CI).
const IDENTITY = ['-c', 'user.name=moxxy-collab', '-c', 'user.email=collab@moxxy.local'];

export function git(cwd: string, args: ReadonlyArray<string>): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile('git', args as string[], { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code =
        err && typeof (err as { code?: unknown }).code === 'number'
          ? ((err as { code: number }).code)
          : err
            ? 1
            : 0;
      resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/** Is the `git` binary available at all? (Desktop users may not have it.) */
export async function gitInstalled(cwd: string): Promise<boolean> {
  return (await git(cwd, ['--version'])).code === 0;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

/** Classify the workspace so the coordinator can pick parallel-worktrees vs the
 *  sequential single-workspace fallback, with a clear reason for the UI. */
export async function detectGit(cwd: string): Promise<{ installed: boolean; repo: boolean }> {
  const installed = await gitInstalled(cwd);
  const repo = installed ? await isGitRepo(cwd) : false;
  return { installed, repo };
}

export async function headSha(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
}

export async function isClean(cwd: string): Promise<boolean> {
  return (await git(cwd, ['status', '--porcelain'])).stdout.trim().length === 0;
}

/** Resolve the shared base. A dirty tree is snapshotted into a commit so the
 *  base is deterministic and the user's in-progress work is preserved (it stays
 *  on their branch; nothing is discarded). */
export async function resolveBase(
  cwd: string,
  opts: { snapshotDirty: boolean },
): Promise<{ baseSha: string; snapshotted: boolean }> {
  if (await isClean(cwd)) return { baseSha: await headSha(cwd), snapshotted: false };
  if (!opts.snapshotDirty) {
    throw new Error('working tree is dirty — commit/stash first, or allow a WIP snapshot');
  }
  await git(cwd, ['add', '-A']);
  await git(cwd, [...IDENTITY, 'commit', '-m', 'moxxy-collab: WIP snapshot before collaboration', '--no-verify']);
  return { baseSha: await headSha(cwd), snapshotted: true };
}

export async function addWorktree(args: {
  repoCwd: string;
  path: string;
  branch: string;
  baseSha: string;
}): Promise<void> {
  const r = await git(args.repoCwd, ['worktree', 'add', '-b', args.branch, args.path, args.baseSha]);
  if (r.code !== 0) throw new Error(`git worktree add failed: ${r.stderr.trim() || r.stdout.trim()}`);
}

export async function removeWorktree(repoCwd: string, path: string): Promise<void> {
  await git(repoCwd, ['worktree', 'remove', '--force', path]);
  await git(repoCwd, ['worktree', 'prune']);
}

/** Commit everything in a worktree (so its branch can be merged). Returns
 *  whether a commit was actually created (false when nothing changed). */
export async function commitAll(worktreeCwd: string, message: string): Promise<boolean> {
  await git(worktreeCwd, ['add', '-A']);
  const status = await git(worktreeCwd, ['status', '--porcelain']);
  if (status.stdout.trim().length === 0) return false;
  const r = await git(worktreeCwd, [...IDENTITY, 'commit', '-m', message, '--no-verify']);
  return r.code === 0;
}

export async function changedFiles(
  worktreeCwd: string,
): Promise<ReadonlyArray<{ path: string; status: string }>> {
  const r = await git(worktreeCwd, ['status', '--porcelain']);
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(2).trim() }));
}

/** Full diff of a worktree vs the shared base, including not-yet-committed work. */
export async function diffVsBase(worktreeCwd: string, baseSha: string): Promise<string> {
  await git(worktreeCwd, ['add', '-A', '-N']); // intent-to-add so untracked files show
  return (await git(worktreeCwd, ['diff', baseSha])).stdout;
}

export interface MergeResult {
  readonly ok: boolean;
  readonly conflicts: ReadonlyArray<string>;
}

/** Merge a branch into the current checkout. On conflict, abort cleanly and
 *  report the conflicting files (never leave markers in the tree). */
export async function mergeNoFf(repoCwd: string, branch: string, message: string): Promise<MergeResult> {
  const r = await git(repoCwd, [...IDENTITY, 'merge', '--no-ff', '--no-edit', '-m', message, branch]);
  if (r.code === 0) return { ok: true, conflicts: [] };
  const conflicted = await git(repoCwd, ['diff', '--name-only', '--diff-filter=U']);
  const conflicts = conflicted.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  await git(repoCwd, ['merge', '--abort']);
  return { ok: false, conflicts };
}

/** Ownership resolution: take a file's contents from one branch and commit it. */
export async function takeFileFromBranch(
  repoCwd: string,
  branch: string,
  path: string,
): Promise<void> {
  await git(repoCwd, ['checkout', branch, '--', path]);
  await git(repoCwd, ['add', '--', path]);
}

/**
 * Merge a branch, resolving any conflicts by FILE OWNERSHIP: a conflicted file
 * owned by the incoming agent takes the incoming version; a file owned by
 * another agent keeps the staged version (their earlier merge); a file with no
 * known owner is left unresolved → the whole merge is aborted and reported so
 * the coordinator can escalate. Never leaves conflict markers in the tree.
 */
export async function mergeWithOwnership(
  repoCwd: string,
  branch: string,
  incomingAgentId: string,
  ownerOf: (file: string) => string | undefined,
): Promise<{ ok: boolean; unresolved: ReadonlyArray<string>; resolved: ReadonlyArray<{ file: string; owner: string }> }> {
  const m = await git(repoCwd, [...IDENTITY, 'merge', '--no-ff', '--no-edit', '-m', `merge ${incomingAgentId}`, branch]);
  if (m.code === 0) return { ok: true, unresolved: [], resolved: [] };
  const conflicted = (await git(repoCwd, ['diff', '--name-only', '--diff-filter=U'])).stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const unresolved: string[] = [];
  const resolved: Array<{ file: string; owner: string }> = [];
  for (const file of conflicted) {
    const owner = ownerOf(file);
    if (owner === incomingAgentId) {
      await git(repoCwd, ['checkout', '--theirs', '--', file]);
      await git(repoCwd, ['add', '--', file]);
      resolved.push({ file, owner });
    } else if (owner) {
      await git(repoCwd, ['checkout', '--ours', '--', file]);
      await git(repoCwd, ['add', '--', file]);
      resolved.push({ file, owner });
    } else {
      unresolved.push(file);
    }
  }
  if (unresolved.length > 0) {
    await git(repoCwd, ['merge', '--abort']);
    return { ok: false, unresolved, resolved: [] };
  }
  const c = await git(repoCwd, [...IDENTITY, 'commit', '--no-edit']);
  return { ok: c.code === 0, unresolved: [], resolved };
}

/** Promote a fully-merged staging branch into the user's checkout (ff-only when
 *  possible, else a merge commit). Returns whether the user's branch advanced. */
export async function promoteStaging(repoCwd: string, stagingBranchName: string): Promise<boolean> {
  const ff = await git(repoCwd, ['merge', '--ff-only', stagingBranchName]);
  if (ff.code === 0) return true;
  const mc = await git(repoCwd, [...IDENTITY, 'merge', '--no-ff', '--no-edit', '-m', 'moxxy-collab: integrate team work', stagingBranchName]);
  return mc.code === 0;
}

export async function createBranch(repoCwd: string, name: string, baseSha: string): Promise<void> {
  await git(repoCwd, ['branch', '-f', name, baseSha]);
}

export async function checkout(repoCwd: string, ref: string): Promise<void> {
  const r = await git(repoCwd, ['checkout', ref]);
  if (r.code !== 0) throw new Error(`git checkout ${ref} failed: ${r.stderr.trim()}`);
}

export async function deleteBranch(repoCwd: string, name: string): Promise<void> {
  await git(repoCwd, ['branch', '-D', name]);
}

/**
 * A {@link PeerReader} backed by the agents' worktrees — lets one agent read
 * another's actual in-progress files (served by the coordinator, which has fs
 * access to every worktree). Path traversal is contained to the worktree.
 */
export function peerReaderFor(worktrees: ReadonlyMap<string, string>, baseSha: string): PeerReader {
  const dirFor = (agentId: string): string => {
    const dir = worktrees.get(agentId);
    if (!dir) throw new Error(`no worktree for agent "${agentId}"`);
    return dir;
  };
  return {
    async files(agentId) {
      return changedFiles(dirFor(agentId));
    },
    async read(agentId, path) {
      const dir = dirFor(agentId);
      const resolved = join(dir, path);
      if (!resolved.startsWith(dir)) throw new Error('path escapes the worktree');
      return readFile(resolved, 'utf8');
    },
    async diff(agentId) {
      return diffVsBase(dirFor(agentId), baseSha);
    },
  };
}
