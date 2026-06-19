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
    // a nested path inside the worktree is still allowed
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(wt, 'sub'), { recursive: true });
    writeFileSync(join(wt, 'sub', 'deep.ts'), 'export const deep = 1;\n');
    expect(await reader.read('backend', 'sub/deep.ts')).toContain('deep = 1');
    expect(await reader.diff('backend')).toContain('feature.ts');
    await expect(reader.read('backend', '../escape')).rejects.toThrow();
  });

  it('peer-read confines untrusted paths to the worktree', async () => {
    const repo = await initRepo();
    const base = await headSha(repo);
    // The worktree dir whose NAME a sibling can string-prefix: ".../a".
    const wt = join(repo, '.wt', 'a');
    await addWorktree({ repoCwd: repo, path: wt, branch: 'b/confine', baseSha: base });
    writeFileSync(join(wt, 'inside.ts'), 'export const inside = true;\n');
    // A would-be sibling that shares the worktree path as a plain string prefix.
    const sibling = join(repo, '.wt', 'a-evil');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'secret.ts'), 'export const secret = "leak";\n');

    const reader = peerReaderFor(new Map([['victim', wt]]), base);
    // Parent-relative escape.
    await expect(reader.read('victim', '../../escape')).rejects.toThrow(/escapes/);
    // Sibling-prefix escape (the bug a naive startsWith() check let through).
    await expect(reader.read('victim', '../a-evil/secret.ts')).rejects.toThrow(/escapes/);
    // Absolute path spliced on (must not read /etc/passwd etc.).
    await expect(reader.read('victim', '/etc/hostname')).rejects.toThrow(/escapes/);
    // The legitimate in-worktree read still works.
    expect(await reader.read('victim', 'inside.ts')).toContain('inside = true');
  });

  it('changedFiles lists work-in-progress edits', async () => {
    const repo = await initRepo();
    writeFileSync(join(repo, 'new.ts'), 'x\n');
    const files = await changedFiles(repo);
    expect(files.some((f) => f.path === 'new.ts')).toBe(true);
  });

  it('changedFiles parses spaced/quoted paths without keeping git quoting', async () => {
    const repo = await initRepo();
    // A path with a space: the old `slice(2).trim()` parse kept git's C-quoting
    // (surrounding double-quotes) so ownership keying on the raw name silently missed.
    writeFileSync(join(repo, 'a b.ts'), 'export const x = 1;\n');
    const files = await changedFiles(repo);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('a b.ts');
    expect(paths.every((p) => !p.startsWith('"') && !p.endsWith('"'))).toBe(true);
  });

  it('changedFiles takes the NEW path of a rename, not the literal "old -> new"', async () => {
    const repo = await initRepo();
    // Commit a tracked file, then rename it so status reports a rename record.
    writeFileSync(join(repo, 'old-name.ts'), 'export const x = 1;\n');
    await git(repo, ['add', '-A']);
    await git(repo, [...IDENT, 'commit', '-m', 'add old-name']);
    const { renameSync } = await import('node:fs');
    renameSync(join(repo, 'old-name.ts'), join(repo, 'new-name.ts'));
    await git(repo, ['add', '-A']); // stage so the rename is detected (R record)

    const files = await changedFiles(repo);
    const paths = files.map((f) => f.path);
    // The NEW path must be present; the malformed "old -> new" string must NOT.
    expect(paths).toContain('new-name.ts');
    expect(paths.some((p) => p.includes('->'))).toBe(false);
    // The old path's source record must not leak in as its own entry.
    expect(paths).not.toContain('old-name.ts');
  });

  it('peer-read does NOT follow a symlink that escapes the worktree', async () => {
    const repo = await initRepo();
    const base = await headSha(repo);
    const wt = join(repo, '.wt-symlink');
    await addWorktree({ repoCwd: repo, path: wt, branch: 'b/symlink', baseSha: base });
    // A secret OUTSIDE the worktree.
    const outsideDir = mkdtempSync(join(tmpdir(), 'mc-secret-'));
    cleanups.push(() => rmSync(outsideDir, { recursive: true, force: true }));
    const secret = join(outsideDir, 'secret.txt');
    writeFileSync(secret, 'TOP SECRET\n');
    // An attacker-planted symlink whose path-string ('leak') passes resolveWithin
    // but whose on-disk target is outside the worktree.
    const { symlinkSync } = await import('node:fs');
    symlinkSync(secret, join(wt, 'leak'));

    const reader = peerReaderFor(new Map([['victim', wt]]), base);
    // In-tree reads still work.
    writeFileSync(join(wt, 'inside.ts'), 'export const inside = true;\n');
    expect(await reader.read('victim', 'inside.ts')).toContain('inside = true');
    // The symlink escape is rejected, not silently followed to the secret.
    await expect(reader.read('victim', 'leak')).rejects.toThrow(/escapes/);
  });
});
