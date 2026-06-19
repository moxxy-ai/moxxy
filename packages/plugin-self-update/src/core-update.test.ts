import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  countCorruptCoreTxns,
  coreTxnDir,
  detectCoreInstall,
  detectNewDeps,
  finalizeStagedCoreUpdate,
  findRepoPkgDir,
  gcCoreTxns,
  listCoreTxns,
  overlayPackages,
  provisionWorkspace,
  readCoreJournal,
  reconcileOverlay,
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

  it('refuses a path that traverses a symlink out of the repo', async () => {
    const repo = await tmp();
    const outside = await tmp();
    await fs.writeFile(path.join(outside, 'secret'), 'top secret\n', 'utf8');
    // A symlinked subdir inside the repo pointing at an external directory.
    await fs.symlink(outside, path.join(repo, 'escape'), 'dir');
    // Textually `escape/secret` stays inside the repo, but it dereferences out.
    expect(() => safeRepoPath(repo, 'escape/secret')).toThrow(/symlink/);
  });

  it('allows a normal file inside a provisioned repo', async () => {
    const repo = await tmp();
    await fs.mkdir(path.join(repo, 'packages', 'core', 'src'), { recursive: true });
    const p = safeRepoPath(repo, 'packages/core/src/a.ts');
    expect(p.endsWith(path.join('packages', 'core', 'src', 'a.ts'))).toBe(true);
  });

  it('accepts an ABSOLUTE in-repo path even when the repo root traverses a symlink', async () => {
    // Regression: when the repo root resolves through a symlink (the norm on
    // macOS, where the tmp dir lives under /var→/private/var, and anywhere
    // $HOME/.moxxy is symlinked), a legitimate absolute path *inside* the repo
    // must not be misread as escaping. The realpath re-check must anchor the
    // already-validated in-repo segments onto realRoot, not re-resolve the raw
    // (possibly absolute) input against it.
    const base = await tmp();
    const realTarget = path.join(base, 'real-repo');
    await fs.mkdir(path.join(realTarget, 'packages', 'core', 'src'), { recursive: true });
    // A symlink to the repo root: the raw path differs from its realpath on
    // every platform, deterministically exercising the symlinked-root case.
    const repo = path.join(base, 'repo-link');
    await fs.symlink(realTarget, repo, 'dir');
    const real = await fs.realpath(repo);
    expect(repo === real).toBe(false);

    const abs = path.join(repo, 'packages', 'core', 'src', 'a.ts');
    const p = safeRepoPath(repo, abs);
    expect(p).toBe(path.join(real, 'packages', 'core', 'src', 'a.ts'));
  });

  it('still rejects an absolute path OUTSIDE the repo', () => {
    expect(() => safeRepoPath('/repo', '/etc/passwd')).toThrow(/escapes/);
  });
});

describe('run output cap', () => {
  it('bounds retained output to the trailing window (no unbounded buffer)', async () => {
    // Emit ~4MB; the retained tail must stay at/under the 512KB cap.
    const node = process.execPath;
    const script = "const c='x'.repeat(1024)+'\\n';for(let i=0;i<4096;i++)process.stdout.write(c);";
    const res = await run(node, ['-e', script], process.cwd(), 30_000);
    expect(res.code).toBe(0);
    expect(res.output.length).toBeLessThanOrEqual(512 * 1024);
    // It kept the most recent bytes, not the first.
    expect(res.output.endsWith('x'.repeat(10) + '\n') || res.output.endsWith('x\n')).toBe(true);
  }, 30_000);
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

  it('clears the pending intent marker after a clean multi-package overlay', async () => {
    const repo = await tmp();
    await fakeRepo(repo);
    const install = await fakeInstall(await tmp());
    const snap = path.join(await tmp(), 'snap');
    const res = await overlayPackages({ repo, install, pkgNames: ['@moxxy/core', '@moxxy/cli'], snapshotDir: snap });
    expect(res.ok).toBe(true);
    // pending.json is removed once applied.json lands; reconcile is a no-op.
    await expect(fs.access(path.join(snap, 'pending.json'))).rejects.toBeTruthy();
    expect((await reconcileOverlay({ install, pkgNames: ['@moxxy/core', '@moxxy/cli'], snapshotDir: snap })).reconciled).toBe(false);
  });

  it('reconcileOverlay restores from snapshot when an overlay was interrupted mid-swap', async () => {
    const repo = await tmp();
    await fakeRepo(repo);
    const install = await fakeInstall(await tmp());
    const snap = path.join(await tmp(), 'snap');

    // Simulate a crash AFTER snapshotting + writing the intent but BEFORE applied.json:
    // @moxxy/core's live dist already swapped to NEW, @moxxy/cli still OLD.
    await fs.mkdir(path.join(snap, 'core'), { recursive: true });
    await fs.writeFile(path.join(snap, 'core', 'index.js'), '// OLD core\n', 'utf8'); // rollback snapshot
    await fs.writeFile(path.join(install.scopeDir, 'core', 'dist', 'index.js'), '// NEW @moxxy/core\n', 'utf8'); // already swapped
    await fs.writeFile(path.join(snap, 'pending.json'), JSON.stringify({ packages: ['@moxxy/core'] }), 'utf8');

    const res = await reconcileOverlay({ install, pkgNames: ['@moxxy/core'], snapshotDir: snap });
    expect(res.reconciled).toBe(true);
    // Live dist is back to the pre-overlay snapshot — no mixed core.
    expect(await fs.readFile(path.join(install.scopeDir, 'core', 'dist', 'index.js'), 'utf8')).toBe('// OLD core\n');
    await expect(fs.access(path.join(snap, 'pending.json'))).rejects.toBeTruthy();
  });
});

describe('finalizeStagedCoreUpdate (overlay validation)', () => {
  it('rolls back instead of committing when the overlay never recorded a full apply', async () => {
    const moxxy = await tmp();
    const install = await fakeInstall(await tmp());
    const txnId = 'core-incomplete';
    await writeCoreJournal(moxxy, {
      txnId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      packages: ['@moxxy/core'],
      version: '1.0.0',
      gitHead: 'abc',
      repoDir: '/repo',
      state: 'staged_restart',
      attempts: [],
    });
    // Snapshot exists with a rollback dist, but NO applied.json → inconsistent.
    const snap = path.join(coreTxnDir(moxxy, txnId), 'snapshot');
    await fs.mkdir(path.join(snap, 'core'), { recursive: true });
    await fs.writeFile(path.join(snap, 'core', 'index.js'), '// OLD core\n', 'utf8');

    const committed = await finalizeStagedCoreUpdate(moxxy, install);
    expect(committed).toEqual([]); // not committed
    expect((await readCoreJournal(moxxy, txnId)).state).toBe('rolled_back');
    // Live dist restored from the snapshot.
    expect(await fs.readFile(path.join(install.scopeDir, 'core', 'dist', 'index.js'), 'utf8')).toBe('// OLD core\n');
  });

  it('commits when applied.json records the full package set', async () => {
    const moxxy = await tmp();
    const install = await fakeInstall(await tmp());
    const txnId = 'core-clean';
    await writeCoreJournal(moxxy, {
      txnId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      packages: ['@moxxy/core'],
      version: '1.0.0',
      gitHead: 'abc',
      repoDir: '/repo',
      state: 'staged_restart',
      attempts: [],
    });
    const snap = path.join(coreTxnDir(moxxy, txnId), 'snapshot');
    await fs.mkdir(snap, { recursive: true });
    await fs.writeFile(path.join(snap, 'applied.json'), JSON.stringify({ packages: ['@moxxy/core'] }), 'utf8');

    const committed = await finalizeStagedCoreUpdate(moxxy, install);
    expect(committed).toEqual([txnId]);
    expect((await readCoreJournal(moxxy, txnId)).state).toBe('committed');
  });

  it('without install it stays best-effort and commits any staged txn', async () => {
    const moxxy = await tmp();
    const txnId = 'core-besteffort';
    await writeCoreJournal(moxxy, {
      txnId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      packages: ['@moxxy/core'],
      version: '1.0.0',
      repoDir: '/repo',
      state: 'staged_restart',
      attempts: [],
    });
    expect(await finalizeStagedCoreUpdate(moxxy)).toEqual([txnId]);
    expect((await readCoreJournal(moxxy, txnId)).state).toBe('committed');
  });
});

describe('countCorruptCoreTxns', () => {
  it('counts a present-but-unparseable journal and ignores a missing one', async () => {
    const moxxy = await tmp();
    // A valid txn.
    await writeCoreJournal(moxxy, {
      txnId: 'ok',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      packages: ['@moxxy/core'],
      version: '1.0.0',
      repoDir: '/repo',
      state: 'provisioned',
      attempts: [],
    });
    // A corrupt journal.
    const badDir = coreTxnDir(moxxy, 'bad');
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(path.join(badDir, 'journal.json'), '{ not json', 'utf8');
    // A dir with no journal yet (half-created begin) — must NOT count.
    await fs.mkdir(coreTxnDir(moxxy, 'half'), { recursive: true });

    expect(await countCorruptCoreTxns(moxxy)).toBe(1);
    // listCoreTxns silently drops the corrupt one (the guard's blind spot).
    expect((await listCoreTxns(moxxy)).map((j) => j.txnId)).toEqual(['ok']);
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

  it('rejects an abbreviated/unresolvable gitHead rather than prefix-matching a different commit', async () => {
    const { dir: src } = await gitFixture();
    const moxxy = await tmp();
    await seedClone(moxxy, src);
    const install: CoreInstallInfo = {
      version: '1.0.0',
      gitHead: 'abc1234', // short, not a full 40-hex sha → must not satisfy the exact pin
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

describe('gcCoreTxns', () => {
  /** Write a core journal with a given id/state and a snapshot file. */
  async function seedTxn(moxxy: string, id: string, state: CoreJournal['state']): Promise<void> {
    await writeCoreJournal(moxxy, {
      txnId: id,
      createdAt: new Date(2026, 0, parseInt(id.replace(/\D/g, ''), 10) || 1).toISOString(),
      updatedAt: new Date().toISOString(),
      packages: ['@moxxy/core'],
      version: '1.0.0',
      repoDir: '/repo',
      state,
      attempts: [],
    });
    // A dist snapshot — the thing GC must reclaim.
    const snap = path.join(coreTxnDir(moxxy, id), 'snapshot', 'core');
    await fs.mkdir(snap, { recursive: true });
    await fs.writeFile(path.join(snap, 'index.js'), '// snapshot\n', 'utf8');
  }

  it('prunes old terminal txns (snapshot dirs) but keeps non-terminal ones', async () => {
    const moxxy = await tmp();
    await seedTxn(moxxy, 'core-1', 'committed');
    await seedTxn(moxxy, 'core-2', 'rolled_back');
    await seedTxn(moxxy, 'core-3', 'committed');
    // A non-terminal txn whose snapshot finalize/rollback may still need.
    await seedTxn(moxxy, 'core-9', 'staged_restart');

    await gcCoreTxns(moxxy, 1);

    const remaining = (await listCoreTxns(moxxy)).map((j) => j.txnId).sort();
    // keep=1 terminal (the newest, core-3) + the non-terminal staged one survives.
    expect(remaining).toEqual(['core-3', 'core-9']);
    // The pruned txn's snapshot is gone from disk.
    await expect(fs.access(coreTxnDir(moxxy, 'core-1'))).rejects.toBeTruthy();
    await expect(fs.access(coreTxnDir(moxxy, 'core-9'))).resolves.toBeUndefined();
  });

  it('finalizeStagedCoreUpdate prunes terminal history after committing', async () => {
    const moxxy = await tmp();
    // Two already-committed (terminal) txns + one staged that will commit now.
    await seedTxn(moxxy, 'core-1', 'committed');
    await seedTxn(moxxy, 'core-2', 'committed');
    await seedTxn(moxxy, 'core-3', 'staged_restart');

    // keepTerminal=1 → after committing core-3, only the newest terminal survives.
    await finalizeStagedCoreUpdate(moxxy, null, 1);

    const ids = (await listCoreTxns(moxxy)).map((j) => j.txnId);
    expect(ids).toContain('core-3'); // just committed, newest
    expect(ids.length).toBe(1);
  });
});
