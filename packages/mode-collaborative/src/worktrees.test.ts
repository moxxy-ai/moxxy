import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addWorktree,
  changedFiles,
  commitAll,
  git,
  headSha,
  isGitRepo,
  mergeNoFf,
  peerReaderFor,
  resolveBase,
  takeFileFromBranch,
} from './worktrees.js';

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function initRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'mc-wt-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  await git(dir, ['init', '-b', 'main']);
  writeFileSync(join(dir, 'README.md'), '# base\n');
  await git(dir, ['add', '-A']);
  await git(dir, [...IDENT, 'commit', '-m', 'base']);
  return dir;
}

describe('worktree git engine', () => {
  it('detects a git repo and resolves a clean base', async () => {
    const repo = await initRepo();
    expect(await isGitRepo(repo)).toBe(true);
    const { baseSha, snapshotted } = await resolveBase(repo, { snapshotDirty: true });
    expect(snapshotted).toBe(false);
    expect(baseSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('snapshots a dirty tree so the base is deterministic', async () => {
    const repo = await initRepo();
    writeFileSync(join(repo, 'wip.txt'), 'in progress\n');
    const { snapshotted } = await resolveBase(repo, { snapshotDirty: true });
    expect(snapshotted).toBe(true);
    // the WIP is preserved as a commit, not discarded
    const log = await git(repo, ['log', '--oneline']);
    expect(log.stdout).toContain('WIP snapshot');
  });

  it('merges disjoint worktrees cleanly on a staging branch', async () => {
    const repo = await initRepo();
    const base = await headSha(repo);
    const backendWt = join(repo, '.wt-backend');
    const testsWt = join(repo, '.wt-tests');
    await addWorktree({ repoCwd: repo, path: backendWt, branch: 'b/backend', baseSha: base });
    await addWorktree({ repoCwd: repo, path: testsWt, branch: 'b/tests', baseSha: base });

    writeFileSync(join(backendWt, 'api.ts'), 'export const api = 1;\n');
    writeFileSync(join(testsWt, 'api.test.ts'), 'test("ok", () => {});\n');
    expect(await commitAll(backendWt, 'backend')).toBe(true);
    expect(await commitAll(testsWt, 'tests')).toBe(true);

    const stagingWt = join(repo, '.wt-staging');
    await addWorktree({ repoCwd: repo, path: stagingWt, branch: 'b/staging', baseSha: base });
    expect((await mergeNoFf(stagingWt, 'b/backend', 'merge backend')).ok).toBe(true);
    expect((await mergeNoFf(stagingWt, 'b/tests', 'merge tests')).ok).toBe(true);
    expect(existsSync(join(stagingWt, 'api.ts'))).toBe(true);
    expect(existsSync(join(stagingWt, 'api.test.ts'))).toBe(true);
  });

  it('reports conflicts without leaving markers, then resolves by ownership', async () => {
    const repo = await initRepo();
    const base = await headSha(repo);
    writeFileSync(join(repo, 'shared.ts'), 'export const v = 0;\n');
    await git(repo, ['add', '-A']);
    await git(repo, [...IDENT, 'commit', '-m', 'add shared']);
    const base2 = await headSha(repo);

    const aWt = join(repo, '.wt-a');
    const bWt = join(repo, '.wt-b');
    await addWorktree({ repoCwd: repo, path: aWt, branch: 'b/a', baseSha: base2 });
    await addWorktree({ repoCwd: repo, path: bWt, branch: 'b/b', baseSha: base2 });
    writeFileSync(join(aWt, 'shared.ts'), 'export const v = 1; // A\n');
    writeFileSync(join(bWt, 'shared.ts'), 'export const v = 2; // B\n');
    await commitAll(aWt, 'a');
    await commitAll(bWt, 'b');

    const stagingWt = join(repo, '.wt-staging2');
    await addWorktree({ repoCwd: repo, path: stagingWt, branch: 'b/staging2', baseSha: base2 });
    expect((await mergeNoFf(stagingWt, 'b/a', 'merge a')).ok).toBe(true);
    const conflict = await mergeNoFf(stagingWt, 'b/b', 'merge b');
    expect(conflict.ok).toBe(false);
    expect(conflict.conflicts).toContain('shared.ts');
    // no markers left in the tree after the aborted merge
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(stagingWt, 'shared.ts'), 'utf8')).not.toContain('<<<<<<<');

    // ownership resolution: take agent B's version deterministically
    await takeFileFromBranch(stagingWt, 'b/b', 'shared.ts');
    await git(stagingWt, [...IDENT, 'commit', '-m', 'resolve via ownership']);
    expect(readFileSync(join(stagingWt, 'shared.ts'), 'utf8')).toContain('// B');
  });

  it('peer-reads another agent\'s in-progress work', async () => {
    const repo = await initRepo();
    const base = await headSha(repo);
    const wt = join(repo, '.wt-peer');
    await addWorktree({ repoCwd: repo, path: wt, branch: 'b/peer', baseSha: base });
    writeFileSync(join(wt, 'feature.ts'), 'export const feature = true;\n');

    const reader = peerReaderFor(new Map([['backend', wt]]), base);
    const files = await reader.files('backend');
    expect(files.some((f) => f.path === 'feature.ts')).toBe(true);
    expect(await reader.read('backend', 'feature.ts')).toContain('feature = true');
    expect(await reader.diff('backend')).toContain('feature.ts');
    await expect(reader.read('backend', '../escape')).rejects.toThrow();
  });

  it('changedFiles lists work-in-progress edits', async () => {
    const repo = await initRepo();
    writeFileSync(join(repo, 'new.ts'), 'x\n');
    const files = await changedFiles(repo);
    expect(files.some((f) => f.path === 'new.ts')).toBe(true);
  });
});
