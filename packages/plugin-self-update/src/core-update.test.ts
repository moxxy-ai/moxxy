import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectNewDeps,
  findRepoPkgDir,
  listCoreTxns,
  overlayPackages,
  readCoreJournal,
  restoreOverlay,
  safeRepoPath,
  shortName,
  writeCoreJournal,
  type CoreInstallInfo,
  type CoreJournal,
} from './core-update.js';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-core-'));
  tempDirs.push(d);
  return d;
}

/** Build a fake clone with packages/core and packages/cli. */
async function fakeRepo(root: string): Promise<void> {
  for (const [dir, name] of [
    ['core', '@moxxy/core'],
    ['cli', '@moxxy/cli'],
  ] as const) {
    const pdir = path.join(root, 'packages', dir);
    await fs.mkdir(path.join(pdir, 'dist'), { recursive: true });
    await fs.writeFile(path.join(pdir, 'package.json'), JSON.stringify({ name }), 'utf8');
    await fs.writeFile(path.join(pdir, 'dist', 'index.js'), `// NEW ${name}\n`, 'utf8');
  }
}

/** Build a fake live install: node_modules/@moxxy/<short>/dist. */
async function fakeInstall(root: string): Promise<CoreInstallInfo> {
  const scopeDir = path.join(root, 'node_modules', '@moxxy');
  await fs.mkdir(path.join(scopeDir, 'core', 'dist'), { recursive: true });
  await fs.writeFile(path.join(scopeDir, 'core', 'dist', 'index.js'), '// OLD core\n', 'utf8');
  return { version: '1.0.0', gitHead: 'abc123', scopeDir };
}

describe('shortName', () => {
  it('strips the @moxxy scope', () => {
    expect(shortName('@moxxy/core')).toBe('core');
    expect(shortName('plain')).toBe('plain');
  });
});

describe('findRepoPkgDir', () => {
  it('locates a package dir by its package.json name', async () => {
    const repo = await tmp();
    await fakeRepo(repo);
    expect(await findRepoPkgDir(repo, '@moxxy/cli')).toBe(path.join(repo, 'packages', 'cli'));
    expect(await findRepoPkgDir(repo, '@moxxy/nope')).toBeNull();
  });
});

describe('safeRepoPath', () => {
  it('rejects paths escaping the repo', () => {
    expect(() => safeRepoPath('/repo', '../etc/passwd')).toThrow(/escapes/);
    expect(safeRepoPath('/repo', 'packages/core/src/a.ts')).toBe(path.resolve('/repo', 'packages/core/src/a.ts'));
  });
});

describe('overlay / restore', () => {
  it('overlays new dist and snapshots the old, then restores', async () => {
    const repo = await tmp();
    await fakeRepo(repo);
    const installRoot = await tmp();
    const install = await fakeInstall(installRoot);
    const snapshotDir = path.join(await tmp(), 'snap');

    const res = await overlayPackages({ repo, install, pkgNames: ['@moxxy/core'], snapshotDir });
    expect(res.ok).toBe(true);
    const liveDist = path.join(install.scopeDir, 'core', 'dist', 'index.js');
    expect(await fs.readFile(liveDist, 'utf8')).toBe('// NEW @moxxy/core\n');
    // applied marker written
    expect(JSON.parse(await fs.readFile(path.join(snapshotDir, 'applied.json'), 'utf8')).packages).toEqual(['@moxxy/core']);

    await restoreOverlay({ install, pkgNames: ['@moxxy/core'], snapshotDir });
    expect(await fs.readFile(liveDist, 'utf8')).toBe('// OLD core\n');
  });

  it('fails cleanly when a package is missing from the clone', async () => {
    const repo = await tmp();
    await fakeRepo(repo);
    const install = await fakeInstall(await tmp());
    const res = await overlayPackages({
      repo,
      install,
      pkgNames: ['@moxxy/does-not-exist'],
      snapshotDir: path.join(await tmp(), 'snap'),
    });
    expect(res.ok).toBe(false);
  });
});

describe('detectNewDeps', () => {
  it('flags a runtime dep absent from the live install, ignoring workspace + present deps', async () => {
    const repo = await tmp();
    await fakeRepo(repo);
    // Give @moxxy/core deps in the clone.
    await fs.writeFile(
      path.join(repo, 'packages', 'core', 'package.json'),
      JSON.stringify({
        name: '@moxxy/core',
        dependencies: { present: '^1', missing: '^2', '@moxxy/sdk': 'workspace:*' },
      }),
      'utf8',
    );
    const installRoot = await tmp();
    const install = await fakeInstall(installRoot);
    await fs.mkdir(path.join(installRoot, 'node_modules', 'present'), { recursive: true });

    const news = await detectNewDeps(repo, install, ['@moxxy/core']);
    expect(news).toEqual(['missing']);
  });
});

describe('core journal', () => {
  it('writes, reads and lists', async () => {
    const moxxy = await tmp();
    const j: CoreJournal = {
      txnId: 'core-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      packages: ['@moxxy/core'],
      version: '1.0.0',
      gitHead: 'abc',
      repoDir: '/repo',
      state: 'provisioned',
      attempts: [],
    };
    await writeCoreJournal(moxxy, j);
    expect((await readCoreJournal(moxxy, 'core-1')).state).toBe('provisioned');
    expect((await listCoreTxns(moxxy)).length).toBe(1);
  });
});
