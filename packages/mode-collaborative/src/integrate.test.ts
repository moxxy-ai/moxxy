import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoardItem } from '@moxxy/plugin-collab';
import { integrate } from './integrate.js';
import { collabBranch, worktreePath, worktreeRoot } from './constants.js';
import { addWorktree, commitAll, git, headSha } from './worktrees.js';

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function initRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'mc-integ-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  await git(dir, ['init', '-b', 'main']);
  writeFileSync(join(dir, 'shared.ts'), 'export const v = 0;\n');
  await git(dir, ['add', '-A']);
  await git(dir, [...IDENT, 'commit', '-m', 'base']);
  return dir;
}

function board(items: Array<Partial<BoardItem>>): BoardItem[] {
  return items.map((b, i) => ({
    id: b.id ?? `item${i}`,
    title: b.title ?? 'item',
    status: b.status ?? 'done',
    createdBy: 'architect',
    updatedBy: 'architect',
    updatedAt: 0,
    ...b,
  })) as BoardItem[];
}

/** Spin up a per-agent worktree off `baseSha` and write `content` into `file`. */
async function agentWorktree(
  repo: string,
  runId: string,
  id: string,
  baseSha: string,
  file: string,
  content: string,
): Promise<string> {
  const wt = worktreePath(runId, id);
  await addWorktree({ repoCwd: repo, path: wt, branch: collabBranch(runId, id), baseSha });
  writeFileSync(join(wt, file), content);
  await commitAll(wt, id);
  return wt;
}

describe('integrate ownership + verifyGate', () => {
  it('resolves a conflict by board ownership and promotes when no gate', async () => {
    const repo = await initRepo();
    const base = await headSha(repo);
    const runId = 'r1';
    cleanups.push(() => rmSync(worktreeRoot(runId), { recursive: true, force: true }));

    const aWt = await agentWorktree(repo, runId, 'a', base, 'shared.ts', 'export const v = 1; // A\n');
    const bWt = await agentWorktree(repo, runId, 'b', base, 'shared.ts', 'export const v = 2; // B\n');

    const result = await integrate({
      repoCwd: repo,
      runId,
      baseSha: base,
      doneAgentIds: ['a', 'b'],
      worktrees: new Map([
        ['a', aWt],
        ['b', bWt],
      ]),
      // 'b' owns shared.ts → the conflict resolves to B's version, no unresolved set.
      board: board([{ id: 'i1', owner: 'b', paths: ['shared.ts'] }]),
      mergePolicy: 'auto-into-branch',
    });

    expect(result.merged).toEqual(['a', 'b']);
    expect(result.conflicts).toEqual([]);
    expect(result.promoted).toBe(true);
    // Promotion advanced the user's branch to B's version.
    expect(readFileSync(join(repo, 'shared.ts'), 'utf8')).toContain('// B');
  });

  it('verifyGate stages the merge instead of promoting into the user branch', async () => {
    const repo = await initRepo();
    const base = await headSha(repo);
    const runId = 'r2';
    cleanups.push(() => rmSync(worktreeRoot(runId), { recursive: true, force: true }));

    const aWt = await agentWorktree(repo, runId, 'a', base, 'feature.ts', 'export const a = 1;\n');

    const result = await integrate({
      repoCwd: repo,
      runId,
      baseSha: base,
      doneAgentIds: ['a'],
      worktrees: new Map([['a', aWt]]),
      board: board([{ id: 'i1', owner: 'a', paths: ['feature.ts'] }]),
      mergePolicy: 'auto-into-branch',
      verifyGate: true,
    });

    expect(result.merged).toEqual(['a']);
    // The gate suppressed promotion: nothing landed in the user's checkout...
    expect(result.promoted).toBe(false);
    const head = await git(repo, ['show', 'HEAD:feature.ts']);
    expect(head.code).not.toBe(0); // file not on the user's branch
    // ...but it IS on the staging branch for the user to verify + promote.
    const onStaging = await git(repo, ['cat-file', '-e', `${result.stagingBranch}:feature.ts`]);
    expect(onStaging.code).toBe(0);
  });
});
