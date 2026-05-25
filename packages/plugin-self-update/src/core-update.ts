import { spawn } from 'node:child_process';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newTxnId } from './transaction.js';

/**
 * Tier-2: patch moxxy's OWN compiled framework packages in a global npm
 * install. Unlike Tier 1 (plugins/skills, hot-reloaded), a core change cannot
 * be hot-swapped — @moxxy/core is imported once into the live process — so the
 * flow is: provision a source clone at the EXACT published commit, edit + build
 * + test it there, then atomically overlay the built `dist/` into the live
 * install (snapshotting the previous dist) and require a restart. A boot-time
 * finalize hook commits or rolls back.
 *
 * Everything here is filesystem + child-process only; no moxxy core import.
 */

const SCOPE = '@moxxy/';
const BUILD_TIMEOUT_MS = 12 * 60_000;

export function shortName(pkg: string): string {
  return pkg.startsWith(SCOPE) ? pkg.slice(SCOPE.length) : pkg;
}

export interface RunResult {
  readonly code: number;
  readonly output: string;
}

export function run(
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeoutMs = BUILD_TIMEOUT_MS,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = (d: Buffer): void => {
      output += d.toString('utf8');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `${cmd} failed to start: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

function trunc(s: string, n = 1500): string {
  return s.length <= n ? s : `…${s.slice(s.length - n)}`;
}

// ── installed-version detection ───────────────────────────────────────────────
export interface CoreInstallInfo {
  readonly version: string;
  readonly gitHead?: string;
  readonly repoUrl?: string;
  /** The `@moxxy` scope dir under node_modules (where every @moxxy/* package sits). */
  readonly scopeDir: string;
}

/**
 * Resolve the live `@moxxy/core` install to learn its version, the commit it
 * was published from (npm writes `gitHead` on publish), and the on-disk root
 * to overlay into.
 */
export function detectCoreInstall(fromUrl: string): CoreInstallInfo | null {
  try {
    // `require.resolve('@moxxy/core')` is unreliable — core's `exports` map has
    // no "." main. Instead locate the `@moxxy` scope dir by walking up from the
    // caller and reading core/package.json directly.
    const scopeDir = findCoreScopeDir(fileURLToPath(fromUrl));
    if (!scopeDir) return null;
    const pkg = JSON.parse(readFileSync(path.join(scopeDir, 'core', 'package.json'), 'utf8')) as {
      version?: string;
      gitHead?: string;
      repository?: { url?: string } | string;
    };
    const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    return {
      version: pkg.version ?? '0.0.0',
      ...(pkg.gitHead ? { gitHead: pkg.gitHead } : {}),
      ...(repoUrl ? { repoUrl: normalizeGitUrl(repoUrl) } : {}),
      scopeDir,
    };
  } catch {
    return null;
  }
}

/**
 * Find the `@moxxy` scope dir containing `core/package.json`, by walking up
 * ancestors of `start`. Handles both the global install (the file lives under
 * `node_modules/@moxxy/<pkg>`, so a parent IS the scope dir) and a workspace
 * (an ancestor has `node_modules/@moxxy`).
 */
function findCoreScopeDir(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 16; i++) {
    if (path.basename(dir) === '@moxxy' && existsSync(path.join(dir, 'core', 'package.json'))) {
      return dir;
    }
    const nm = path.join(dir, 'node_modules', '@moxxy');
    if (existsSync(path.join(nm, 'core', 'package.json'))) return nm;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function normalizeGitUrl(url: string): string {
  return url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://');
}

// ── preflight ─────────────────────────────────────────────────────────────────
export interface PreflightReport {
  readonly ok: boolean;
  readonly checks: ReadonlyArray<{ id: string; ok: boolean; detail: string }>;
}

export async function corePreflight(install: CoreInstallInfo | null): Promise<PreflightReport> {
  const checks: { id: string; ok: boolean; detail: string }[] = [];
  const git = await run('git', ['--version'], process.cwd(), 10_000);
  checks.push({ id: 'git', ok: git.code === 0, detail: git.code === 0 ? git.output.trim() : 'git not found' });
  const pnpm = await run('pnpm', ['--version'], process.cwd(), 10_000);
  checks.push({ id: 'pnpm', ok: pnpm.code === 0, detail: pnpm.code === 0 ? `pnpm ${pnpm.output.trim()}` : 'pnpm not found' });
  checks.push({ id: 'install', ok: Boolean(install), detail: install ? `@moxxy/core@${install.version}` : 'could not resolve @moxxy/core' });
  checks.push({
    id: 'provenance',
    ok: Boolean(install?.gitHead),
    detail: install?.gitHead ? `gitHead ${install.gitHead.slice(0, 10)}` : 'no gitHead in published metadata — cannot pin source',
  });
  checks.push({
    id: 'repo',
    ok: Boolean(install?.repoUrl),
    detail: install?.repoUrl ?? 'no repository url in @moxxy/core package.json',
  });
  return { ok: checks.every((c) => c.ok), checks };
}

// ── core transaction journal ───────────────────────────────────────────────────
export type CoreState =
  | 'open'
  | 'provisioned'
  | 'verified'
  | 'staged_restart'
  | 'committed'
  | 'rolled_back'
  | 'escalated';

export interface CoreJournal {
  readonly txnId: string;
  readonly createdAt: string;
  updatedAt: string;
  packages: string[];
  readonly version: string;
  readonly gitHead?: string;
  readonly repoDir: string;
  state: CoreState;
  attempts: { at: string; stage: string; ok: boolean; message: string }[];
}

export function coreTxnRoot(moxxyDir: string): string {
  return path.join(moxxyDir, 'self-update', 'core-txns');
}
export function coreTxnDir(moxxyDir: string, txnId: string): string {
  return path.join(coreTxnRoot(moxxyDir), txnId);
}
export function repoDir(moxxyDir: string): string {
  return path.join(moxxyDir, 'self-update', 'repo');
}

export async function writeCoreJournal(moxxyDir: string, j: CoreJournal): Promise<void> {
  j.updatedAt = new Date().toISOString();
  const dir = coreTxnDir(moxxyDir, j.txnId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'journal.json');
  await fs.writeFile(`${file}.tmp`, JSON.stringify(j, null, 2) + '\n', 'utf8');
  await fs.rename(`${file}.tmp`, file);
}

export async function readCoreJournal(moxxyDir: string, txnId: string): Promise<CoreJournal> {
  return JSON.parse(await fs.readFile(path.join(coreTxnDir(moxxyDir, txnId), 'journal.json'), 'utf8')) as CoreJournal;
}

export async function listCoreTxns(moxxyDir: string): Promise<ReadonlyArray<CoreJournal>> {
  let ids: string[];
  try {
    ids = (await fs.readdir(coreTxnRoot(moxxyDir), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: CoreJournal[] = [];
  for (const id of ids) {
    try {
      out.push(await readCoreJournal(moxxyDir, id));
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── provisioning ────────────────────────────────────────────────────────────────
export interface ProvisionResult {
  readonly ok: boolean;
  readonly message: string;
  readonly repoDir: string;
}

/**
 * Ensure a buildable clone exists at exactly `install.gitHead`. Clones on first
 * use, otherwise fetches; always checks out the pinned commit and verifies HEAD
 * matches — this is the integrity guarantee that the source equals the binary.
 */
export async function provisionWorkspace(opts: {
  readonly moxxyDir: string;
  readonly install: CoreInstallInfo;
  readonly repoUrlOverride?: string;
}): Promise<ProvisionResult> {
  const dir = repoDir(opts.moxxyDir);
  const url = opts.repoUrlOverride ?? opts.install.repoUrl;
  const ref = opts.install.gitHead;
  if (!url) return { ok: false, message: 'no repository url to clone from', repoDir: dir };
  if (!ref) return { ok: false, message: 'no gitHead — cannot pin source to the installed version', repoDir: dir };

  const hasClone = await fs
    .access(path.join(dir, '.git'))
    .then(() => true)
    .catch(() => false);
  if (!hasClone) {
    await fs.mkdir(path.dirname(dir), { recursive: true });
    const clone = await run('git', ['clone', url, dir], path.dirname(dir));
    if (clone.code !== 0) return { ok: false, message: `git clone failed: ${trunc(clone.output, 400)}`, repoDir: dir };
  } else {
    await run('git', ['fetch', '--all', '--tags'], dir);
  }

  const checkout = await run('git', ['checkout', '--force', ref], dir);
  if (checkout.code !== 0) {
    const fetched = await run('git', ['fetch', 'origin', ref], dir);
    if (fetched.code === 0) await run('git', ['checkout', '--force', ref], dir);
  }
  const head = (await run('git', ['rev-parse', 'HEAD'], dir)).output.trim();
  if (!head.startsWith(ref) && !ref.startsWith(head)) {
    return {
      ok: false,
      message: `source mismatch: clone HEAD ${head.slice(0, 10)} ≠ installed gitHead ${ref.slice(0, 10)}`,
      repoDir: dir,
    };
  }
  await run('git', ['clean', '-fdx', 'packages'], dir).catch(() => undefined);
  await run('git', ['checkout', '--', '.'], dir).catch(() => undefined);

  const install = await run('pnpm', ['install', '--frozen-lockfile'], dir);
  if (install.code !== 0) {
    const loose = await run('pnpm', ['install'], dir);
    if (loose.code !== 0) return { ok: false, message: `pnpm install failed: ${trunc(install.output, 400)}`, repoDir: dir };
  }
  return { ok: true, message: 'workspace provisioned', repoDir: dir };
}

// ── repo package layout ──────────────────────────────────────────────────────────
/** Find the clone's package directory whose package.json `name` === pkgName. */
export async function findRepoPkgDir(repo: string, pkgName: string): Promise<string | null> {
  const pkgsRoot = path.join(repo, 'packages');
  let entries: string[];
  try {
    entries = (await fs.readdir(pkgsRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  for (const name of entries) {
    const dir = path.join(pkgsRoot, name);
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === pkgName) return dir;
    } catch {
      /* skip */
    }
  }
  return null;
}

// ── verify (build / typecheck / test) ─────────────────────────────────────────────
export interface CoreVerifyResult {
  readonly ok: boolean;
  readonly stages: ReadonlyArray<{ stage: string; ok: boolean; message: string }>;
  readonly newDeps: ReadonlyArray<string>;
}

export async function verifyCorePackages(
  repo: string,
  install: CoreInstallInfo,
  pkgNames: ReadonlyArray<string>,
): Promise<CoreVerifyResult> {
  const stages: { stage: string; ok: boolean; message: string }[] = [];
  // `...` expands the turbo filter to include dependents, so a change that
  // breaks a downstream package is caught.
  const filters = pkgNames.flatMap((p) => ['--filter', `${p}...`]);

  for (const task of ['build', 'typecheck', 'test'] as const) {
    const r = await run('pnpm', [...filters, task], repo);
    stages.push({ stage: task, ok: r.code === 0, message: r.code === 0 ? `${task} ok` : trunc(r.output) });
    if (r.code !== 0) return { ok: false, stages, newDeps: [] };
  }

  const newDeps = await detectNewDeps(repo, install, pkgNames);
  if (newDeps.length > 0) {
    stages.push({
      stage: 'deps',
      ok: false,
      message: `patch adds runtime dependencies not in the live install: ${newDeps.join(', ')} — a dist overlay can't install these. Escalate.`,
    });
    return { ok: false, stages, newDeps };
  }
  return { ok: true, stages, newDeps: [] };
}

/** Runtime deps the patched clone declares that aren't present in the live install. */
export async function detectNewDeps(
  repo: string,
  install: CoreInstallInfo,
  pkgNames: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  const missing = new Set<string>();
  for (const pkgName of pkgNames) {
    const dir = await findRepoPkgDir(repo, pkgName);
    if (!dir) continue;
    let deps: Record<string, string> = {};
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      deps = pkg.dependencies ?? {};
    } catch {
      continue;
    }
    // The live node_modules root is the parent of the `@moxxy` scope dir.
    const nmRoot = path.dirname(install.scopeDir);
    for (const [dep, spec] of Object.entries(deps)) {
      if (spec.startsWith('workspace:')) continue; // resolved internally at build
      const present = await exists(path.join(nmRoot, dep));
      if (!present) missing.add(dep);
    }
  }
  return [...missing];
}

// ── overlay / restore ────────────────────────────────────────────────────────────
/**
 * Swap each package's freshly-built `dist/` into the live install, keeping the
 * previous dist as a snapshot for rollback. Renames are atomic on the same fs.
 */
export async function overlayPackages(opts: {
  readonly repo: string;
  readonly install: CoreInstallInfo;
  readonly pkgNames: ReadonlyArray<string>;
  readonly snapshotDir: string;
}): Promise<{ ok: boolean; message: string; applied: string[] }> {
  const applied: string[] = [];
  await fs.mkdir(opts.snapshotDir, { recursive: true });
  for (const pkgName of opts.pkgNames) {
    const repoPkg = await findRepoPkgDir(opts.repo, pkgName);
    if (!repoPkg) return { ok: false, message: `package not found in clone: ${pkgName}`, applied };
    const srcDist = path.join(repoPkg, 'dist');
    if (!(await exists(srcDist))) return { ok: false, message: `no built dist for ${pkgName}`, applied };

    const destPkg = path.join(opts.install.scopeDir, shortName(pkgName));
    const destDist = path.join(destPkg, 'dist');

    // Snapshot the current dist for rollback.
    if (await exists(destDist)) {
      await fs.cp(destDist, path.join(opts.snapshotDir, shortName(pkgName)), { recursive: true });
    }
    // Stage the new dist on the same fs, then swap atomically.
    const staged = path.join(destPkg, `dist.new`);
    await fs.rm(staged, { recursive: true, force: true });
    await fs.cp(srcDist, staged, { recursive: true });
    const bak = path.join(destPkg, `dist.bak`);
    await fs.rm(bak, { recursive: true, force: true });
    if (await exists(destDist)) await fs.rename(destDist, bak);
    await fs.rename(staged, destDist);
    await fs.rm(bak, { recursive: true, force: true });
    applied.push(pkgName);
  }
  await fs.writeFile(
    path.join(opts.snapshotDir, 'applied.json'),
    JSON.stringify({ packages: applied, at: new Date().toISOString() }, null, 2),
    'utf8',
  );
  return { ok: true, message: `overlaid ${applied.length} package(s)`, applied };
}

/** Reverse an overlay: restore each package's dist from the snapshot. */
export async function restoreOverlay(opts: {
  readonly install: CoreInstallInfo;
  readonly pkgNames: ReadonlyArray<string>;
  readonly snapshotDir: string;
}): Promise<void> {
  for (const pkgName of opts.pkgNames) {
    const snap = path.join(opts.snapshotDir, shortName(pkgName));
    if (!(await exists(snap))) continue;
    const destDist = path.join(opts.install.scopeDir, shortName(pkgName), 'dist');
    await fs.rm(destDist, { recursive: true, force: true });
    await fs.cp(snap, destDist, { recursive: true });
  }
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

// ── boot-time finalize ────────────────────────────────────────────────────────────
/**
 * Called early on every CLI boot. Reaching this point means the (possibly
 * overlaid) core code imported successfully, so any `staged_restart` txn is
 * committed. Best-effort; the primary defense against a bad patch is the
 * pre-overlay build+typecheck+test in verify.
 */
export async function finalizeStagedCoreUpdate(moxxyDir: string): Promise<ReadonlyArray<string>> {
  const committed: string[] = [];
  for (const j of await listCoreTxns(moxxyDir)) {
    if (j.state !== 'staged_restart') continue;
    j.state = 'committed';
    await writeCoreJournal(moxxyDir, j).catch(() => undefined);
    committed.push(j.txnId);
  }
  return committed;
}

export function newCoreTxnId(now: Date = new Date()): string {
  return `core-${newTxnId(now)}`;
}

/** Resolve a clone-relative path, refusing anything that escapes the repo. */
export function safeRepoPath(repo: string, rel: string): string {
  const resolved = path.resolve(repo, rel);
  const root = path.resolve(repo);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path escapes the provisioned repo: ${rel}`);
  }
  return resolved;
}
