import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectCoreInstall,
  detectNewDeps,
  findRepoPkgDir,
  listCoreTxns,
  overlayPackages,
  provisionWorkspace,
  readCoreJournal,
  repoDir,
  restoreOverlay,
  run,
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

describe('detectCoreInstall', () => {
  /** Write a @moxxy/core/package.json at `scopeDir/core`. */
  async function writeCorePkg(
    scopeDir: string,
    pkg: Record<string, unknown>,
  ): Promise<void> {
    await fs.mkdir(path.join(scopeDir, 'core'), { recursive: true });
    await fs.writeFile(path.join(scopeDir, 'core', 'package.json'), JSON.stringify(pkg), 'utf8');
  }

  it('resolves the global-install layout (a parent IS the @moxxy scope dir)', async () => {
    // node_modules/@moxxy/<pkg>/dist/x.js → the scope dir is an ancestor named @moxxy.
    const root = await tmp();
    const scopeDir = path.join(root, 'node_modules', '@moxxy');
    await writeCorePkg(scopeDir, {
      version: '2.3.4',
      gitHead: 'deadbeef',
      repository: { url: 'git+https://github.com/acme/moxxy.git' },
    });
    const fromUrl = pathToFileURL(path.join(scopeDir, 'cli', 'dist', 'index.js')).href;

    const info = detectCoreInstall(fromUrl);
    expect(info).not.toBeNull();
    expect(info?.scopeDir).toBe(scopeDir);
    expect(info?.version).toBe('2.3.4');
    expect(info?.gitHead).toBe('deadbeef');
    // git+https:// is normalized to https://
    expect(info?.repoUrl).toBe('https://github.com/acme/moxxy.git');
  });

  it('resolves the workspace layout (an ancestor has node_modules/@moxxy)', async () => {
    const root = await tmp();
    const scopeDir = path.join(root, 'node_modules', '@moxxy');
    await writeCorePkg(scopeDir, { version: '0.1.0', repository: 'git://example.com/x.git' });
    // Caller lives deep in the workspace, not under node_modules.
    const fromUrl = pathToFileURL(path.join(root, 'apps', 'cli', 'dist', 'main.js')).href;

    const info = detectCoreInstall(fromUrl);
    expect(info?.scopeDir).toBe(scopeDir);
    expect(info?.version).toBe('0.1.0');
    expect(info?.gitHead).toBeUndefined();
    // string `repository` + git:// normalization
    expect(info?.repoUrl).toBe('https://example.com/x.git');
  });

  it('returns null when no @moxxy/core can be located', async () => {
    const root = await tmp();
    const fromUrl = pathToFileURL(path.join(root, 'nowhere', 'index.js')).href;
    expect(detectCoreInstall(fromUrl)).toBeNull();
  });

  it('returns null on a corrupt core/package.json', async () => {
    const root = await tmp();
    const scopeDir = path.join(root, 'node_modules', '@moxxy');
    await fs.mkdir(path.join(scopeDir, 'core'), { recursive: true });
    await fs.writeFile(path.join(scopeDir, 'core', 'package.json'), '{ not json', 'utf8');
    const fromUrl = pathToFileURL(path.join(root, 'index.js')).href;
    expect(detectCoreInstall(fromUrl)).toBeNull();
  });

  it('defaults version to 0.0.0 when package.json omits it', async () => {
    const root = await tmp();
    const scopeDir = path.join(root, 'node_modules', '@moxxy');
    await writeCorePkg(scopeDir, {});
    const fromUrl = pathToFileURL(path.join(root, 'index.js')).href;
    expect(detectCoreInstall(fromUrl)?.version).toBe('0.0.0');
  });
});

describe('provisionWorkspace HEAD pin', () => {
  /** Init a throwaway git repo with one commit; return its dir + commit sha. */
  async function gitFixture(): Promise<{ dir: string; head: string }> {
    const dir = await tmp();
    await run('git', ['init', '-q'], dir);
    await run('git', ['config', 'user.email', 't@t'], dir);
    await run('git', ['config', 'user.name', 't'], dir);
    await fs.writeFile(path.join(dir, 'README.md'), 'hi\n', 'utf8');
    await run('git', ['add', '.'], dir);
    await run('git', ['commit', '-qm', 'init'], dir);
    const head = (await run('git', ['rev-parse', 'HEAD'], dir)).output.trim();
    return { dir, head };
  }

  /** Seed an existing clone at moxxyDir/repo from a local source repo. */
  async function seedClone(moxxyDir: string, srcDir: string): Promise<void> {
    const target = repoDir(moxxyDir);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const clone = await run('git', ['clone', '-q', srcDir, target], path.dirname(target));
    expect(clone.code).toBe(0);
  }

  it('rejects with a source-mismatch message when the installed gitHead is not the clone HEAD', async () => {
    const { dir: src } = await gitFixture();
    const moxxy = await tmp();
    await seedClone(moxxy, src);

    const install: CoreInstallInfo = {
      version: '1.0.0',
      gitHead: '0000000000000000000000000000000000000000', // a commit the clone can't reach
      repoUrl: src,
      scopeDir: path.join(moxxy, 'node_modules', '@moxxy'),
    };
    const res = await provisionWorkspace({ moxxyDir: moxxy, install, repoUrlOverride: src });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('source mismatch');
  });

  it('fails fast with no gitHead to pin to', async () => {
    const moxxy = await tmp();
    const install: CoreInstallInfo = {
      version: '1.0.0',
      repoUrl: 'https://example.com/x.git',
      scopeDir: path.join(moxxy, 'node_modules', '@moxxy'),
    };
    const res = await provisionWorkspace({ moxxyDir: moxxy, install });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('gitHead');
  });

  it('fails fast with no repository url', async () => {
    const moxxy = await tmp();
    const install: CoreInstallInfo = {
      version: '1.0.0',
      gitHead: 'abc',
      scopeDir: path.join(moxxy, 'node_modules', '@moxxy'),
    };
    const res = await provisionWorkspace({ moxxyDir: moxxy, install });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('repository url');
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
