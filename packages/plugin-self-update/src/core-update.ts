import { spawn } from 'node:child_process';
import { existsSync, lstatSync, promises as fs, readFileSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '@moxxy/sdk/server';
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
/**
 * Cap on the child-process output we retain in memory. A long, model-triggered
 * `pnpm build/typecheck/test` (turbo fan-out, a looping test, a tool dumping a
 * large file) can emit hundreds of MB; holding it all in the LIVE process would
 * OOM-kill the host mid-update. Callers only ever read the trailing ~1.5KB, so a
 * sliding tail is lossless for them.
 */
const MAX_RUN_OUTPUT_BYTES = 512 * 1024;
/** A full git commit sha — the source-pin must compare exact 40-hex shas, never a prefix. */
const FULL_SHA_RE = /^[0-9a-f]{40}$/;

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
    // `detached` puts the child in its own process group so a timeout can kill
    // the WHOLE subtree (pnpm/turbo/vitest fan out to many grandchildren that
    // SIGKILL on the immediate child would orphan).
    const child = spawn(cmd, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const tail = new TailBuffer(MAX_RUN_OUTPUT_BYTES);
    const onData = (d: Buffer): void => tail.push(d);
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => killTree(child), timeoutMs);
    let settled = false;
    const finish = (r: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      resolve(r);
    };
    child.on('error', (err) => finish({ code: -1, output: `${cmd} failed to start: ${err.message}` }));
    child.on('close', (code) => finish({ code: code ?? -1, output: tail.toString() }));
  });
}

/**
 * Bounded sliding-tail accumulator: keeps at most `cap` bytes of the most recent
 * output. Once the cap is exceeded it trims from the front so memory stays
 * O(cap) regardless of how much the child emits.
 */
class TailBuffer {
  private buf = '';
  constructor(private readonly cap: number) {}
  push(d: Buffer): void {
    this.buf += d.toString('utf8');
    if (this.buf.length > this.cap) this.buf = this.buf.slice(this.buf.length - this.cap);
  }
  toString(): string {
    return this.buf;
  }
}

/** SIGKILL a detached child's whole process group, tolerating an already-dead group. */
function killTree(child: { pid?: number; kill: (s: NodeJS.Signals) => boolean }): void {
  try {
    if (child.pid != null) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    // ESRCH: the group already exited. Fall back to the direct kill just in case.
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
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
 * Memoize the resolution per `fromUrl`: the live install root cannot move
 * underneath a running process, yet detectCoreInstall is called from many tool
 * handlers (preflight/begin/verify/apply/rollback) and does synchronous blocking
 * I/O (readFileSync + an existsSync walk). Caching keeps that off the hot path.
 * `null` results are cached too so repeated misses stay cheap.
 */
const coreInstallCache = new Map<string, CoreInstallInfo | null>();

/**
 * Resolve the live `@moxxy/core` install to learn its version, the commit it
 * was published from (npm writes `gitHead` on publish), and the on-disk root
 * to overlay into.
 */
export function detectCoreInstall(fromUrl: string): CoreInstallInfo | null {
  if (coreInstallCache.has(fromUrl)) return coreInstallCache.get(fromUrl) ?? null;
  const info = detectCoreInstallUncached(fromUrl);
  coreInstallCache.set(fromUrl, info);
  return info;
}

function detectCoreInstallUncached(fromUrl: string): CoreInstallInfo | null {
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
  const file = path.join(coreTxnDir(moxxyDir, j.txnId), 'journal.json');
  await writeFileAtomic(file, JSON.stringify(j, null, 2) + '\n');
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

/**
 * Count core-txn dirs whose `journal.json` is present but unparseable. A corrupt
 * (or hand-edited / half-written) journal would silently VANISH from
 * listCoreTxns — making the begin serialization guard fail OPEN and let a second
 * concurrent core txn clobber the shared repoDir. The guard uses this to instead
 * fail CLOSED. A missing journal.json (a dir mid-create) is NOT corruption and
 * is ignored.
 */
export async function countCorruptCoreTxns(moxxyDir: string): Promise<number> {
  let ids: string[];
  try {
    ids = (await fs.readdir(coreTxnRoot(moxxyDir), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return 0;
  }
  let corrupt = 0;
  for (const id of ids) {
    const file = path.join(coreTxnDir(moxxyDir, id), 'journal.json');
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch {
      continue; // no journal yet — not corruption.
    }
    try {
      JSON.parse(raw);
    } catch {
      corrupt++;
    }
  }
  return corrupt;
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
  // Resolve the pinned ref to a full sha so a short/abbreviated gitHead can't
  // prefix-match a DIFFERENT commit and defeat the source-equals-binary pin.
  const refFull = (await run('git', ['rev-parse', ref], dir)).output.trim();
  const head = (await run('git', ['rev-parse', 'HEAD'], dir)).output.trim();
  if (!FULL_SHA_RE.test(head) || !FULL_SHA_RE.test(refFull) || head !== refFull) {
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
    if (loose.code !== 0) return { ok: false, message: `pnpm install failed: ${trunc(loose.output, 400)}`, repoDir: dir };
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
 *
 * Crash-atomicity across packages: a multi-package overlay must not leave the
 * install with a NEW core dist but an OLD cli dist (a version-skewed, possibly
 * non-bootable combo) if the process is killed mid-loop. So we work in phases:
 *   1. validate every package + snapshot every old dist,
 *   2. stage every new dist (`dist.new`) — nothing live is touched yet,
 *   3. write a `pending.json` intent recording the full set + staged paths,
 *   4. swap all dists in a tight loop, then write `applied.json`.
 * If the process dies between 3 and the final `applied.json`, a leftover
 * `pending.json` lets {@link reconcileOverlay} (run on boot) complete or undo
 * the partial set instead of stranding a mixed core.
 */
export async function overlayPackages(opts: {
  readonly repo: string;
  readonly install: CoreInstallInfo;
  readonly pkgNames: ReadonlyArray<string>;
  readonly snapshotDir: string;
}): Promise<{ ok: boolean; message: string; applied: string[] }> {
  await fs.mkdir(opts.snapshotDir, { recursive: true });

  // Phase 1 + 2: validate, snapshot old, stage new. No live dist is swapped yet,
  // so a failure here leaves the install untouched (only orphaned dist.new dirs).
  const planned: { pkgName: string; destDist: string; staged: string }[] = [];
  for (const pkgName of opts.pkgNames) {
    const repoPkg = await findRepoPkgDir(opts.repo, pkgName);
    if (!repoPkg) {
      await cleanupStaged(planned);
      return { ok: false, message: `package not found in clone: ${pkgName}`, applied: [] };
    }
    const srcDist = path.join(repoPkg, 'dist');
    if (!(await exists(srcDist))) {
      await cleanupStaged(planned);
      return { ok: false, message: `no built dist for ${pkgName}`, applied: [] };
    }
    const destPkg = path.join(opts.install.scopeDir, shortName(pkgName));
    const destDist = path.join(destPkg, 'dist');
    if (await exists(destDist)) {
      await fs.cp(destDist, path.join(opts.snapshotDir, shortName(pkgName)), { recursive: true });
    }
    const staged = path.join(destPkg, 'dist.new');
    await fs.rm(staged, { recursive: true, force: true });
    await fs.cp(srcDist, staged, { recursive: true });
    planned.push({ pkgName, destDist, staged });
  }

  // Phase 3: record the intent so an interrupted phase-4 swap is reconcilable.
  await writeFileAtomic(
    path.join(opts.snapshotDir, 'pending.json'),
    JSON.stringify(
      { packages: planned.map((p) => p.pkgName), at: new Date().toISOString() },
      null,
      2,
    ),
  );

  // Phase 4: swap each staged dist into place. Atomic per package; the pending
  // marker covers the (tiny) window where the set is only partially swapped.
  const applied: string[] = [];
  for (const { pkgName, destDist, staged } of planned) {
    const bak = `${destDist}.bak`;
    await fs.rm(bak, { recursive: true, force: true });
    if (await exists(destDist)) await fs.rename(destDist, bak);
    await fs.rename(staged, destDist);
    await fs.rm(bak, { recursive: true, force: true });
    applied.push(pkgName);
  }
  await writeFileAtomic(
    path.join(opts.snapshotDir, 'applied.json'),
    JSON.stringify({ packages: applied, at: new Date().toISOString() }, null, 2),
  );
  // The swap completed; the pending intent is now satisfied.
  await fs.rm(path.join(opts.snapshotDir, 'pending.json'), { force: true }).catch(() => undefined);
  return { ok: true, message: `overlaid ${applied.length} package(s)`, applied };
}

/** Remove any staged `dist.new` dirs from an aborted overlay plan. */
async function cleanupStaged(
  planned: ReadonlyArray<{ staged: string }>,
): Promise<void> {
  for (const { staged } of planned) {
    await fs.rm(staged, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Reconcile an overlay that was interrupted between intent and completion. If a
 * `pending.json` exists without a matching `applied.json`, the swap loop may
 * have run partially (some live dists new, some old) and left orphaned
 * `dist.new`/`dist.bak`. Restoring from the snapshot returns every package to
 * its pre-overlay dist so the install is internally consistent again; the caller
 * marks the txn rolled_back. No-op when the overlay completed cleanly.
 */
export async function reconcileOverlay(opts: {
  readonly install: CoreInstallInfo;
  readonly pkgNames: ReadonlyArray<string>;
  readonly snapshotDir: string;
}): Promise<{ reconciled: boolean }> {
  const pendingFile = path.join(opts.snapshotDir, 'pending.json');
  if (!(await exists(pendingFile))) return { reconciled: false };
  if (await exists(path.join(opts.snapshotDir, 'applied.json'))) {
    // The full set landed; the pending marker is just stale. Clear it.
    await fs.rm(pendingFile, { force: true }).catch(() => undefined);
    return { reconciled: false };
  }
  await restoreOverlay(opts);
  // Drop any orphaned staging dirs from the interrupted swap.
  for (const pkgName of opts.pkgNames) {
    const destPkg = path.join(opts.install.scopeDir, shortName(pkgName));
    await fs.rm(path.join(destPkg, 'dist.new'), { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(path.join(destPkg, 'dist.bak'), { recursive: true, force: true }).catch(() => undefined);
  }
  await fs.rm(pendingFile, { force: true }).catch(() => undefined);
  return { reconciled: true };
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
/** Whether the snapshot dir holds a consistent, fully-applied overlay for `pkgNames`. */
async function overlayApplied(
  snapshotDir: string,
  pkgNames: ReadonlyArray<string>,
): Promise<boolean> {
  try {
    const applied = JSON.parse(
      await fs.readFile(path.join(snapshotDir, 'applied.json'), 'utf8'),
    ) as { packages?: string[] };
    const got = new Set(applied.packages ?? []);
    return pkgNames.every((p) => got.has(p));
  } catch {
    return false;
  }
}

/**
 * Called early on every CLI boot. Reaching this point means the (possibly
 * overlaid) core code imported successfully, so a cleanly-applied
 * `staged_restart` txn is committed. The primary defense against a bad patch is
 * the pre-overlay build+typecheck+test in verify; this adds two boot-time
 * safety nets when an `install` is supplied:
 *  - reconcile an overlay interrupted mid-swap (partial dist set) by restoring
 *    the snapshot, and mark that txn rolled_back rather than committing a mixed
 *    core that merely imported far enough to reach this hook;
 *  - refuse to commit unless `applied.json` records every journal package, so an
 *    inconsistent overlay keeps its rollback snapshot instead of GC-ing it.
 * Without `install` it stays best-effort (commits any staged txn) for callers
 * that cannot resolve the live install.
 */
export async function finalizeStagedCoreUpdate(
  moxxyDir: string,
  install?: CoreInstallInfo | null,
  keepTerminal = 5,
): Promise<ReadonlyArray<string>> {
  const committed: string[] = [];
  for (const j of await listCoreTxns(moxxyDir)) {
    if (j.state !== 'staged_restart') continue;
    const snapDir = path.join(coreTxnDir(moxxyDir, j.txnId), 'snapshot');

    if (install) {
      const recon = await reconcileOverlay({
        install,
        pkgNames: j.packages,
        snapshotDir: snapDir,
      }).catch(() => ({ reconciled: false }));
      if (recon.reconciled) {
        j.state = 'rolled_back';
        await writeCoreJournal(moxxyDir, j).catch(() => undefined);
        continue;
      }
      if (!(await overlayApplied(snapDir, j.packages))) {
        // The overlay never recorded a complete apply — restore and back out
        // rather than commit (and then GC) a possibly-broken core.
        await restoreOverlay({ install, pkgNames: j.packages, snapshotDir: snapDir }).catch(
          () => undefined,
        );
        j.state = 'rolled_back';
        await writeCoreJournal(moxxyDir, j).catch(() => undefined);
        continue;
      }
    }

    j.state = 'committed';
    await writeCoreJournal(moxxyDir, j).catch(() => undefined);
    committed.push(j.txnId);
  }
  // Reclaim disk: every core txn parks a full pre-overlay dist snapshot, so old
  // terminal txns would otherwise accumulate unbounded. Boot is the safe, single
  // place to prune (all staged txns above are now terminal). Best-effort.
  await gcCoreTxns(moxxyDir, keepTerminal).catch(() => undefined);
  return committed;
}

export function newCoreTxnId(now: Date = new Date()): string {
  return `core-${newTxnId(now)}`;
}

/**
 * Prune old terminal core transactions. Each core txn parks a full pre-overlay
 * `dist` snapshot of every patched package (tens of MB), and nothing else ever
 * deletes them — left unbounded they accumulate on disk across every
 * apply/rollback cycle. Keep only the most recent `keep` terminal
 * (committed / rolled_back) txns; never touch a non-terminal one (an open /
 * provisioned / verified / staged_restart txn whose snapshot finalize or a
 * rollback may still need). Best-effort: a failed delete is ignored.
 */
export async function gcCoreTxns(moxxyDir: string, keep: number): Promise<void> {
  const all = await listCoreTxns(moxxyDir);
  const terminal = all.filter((j) => j.state === 'committed' || j.state === 'rolled_back');
  for (const j of terminal.slice(Math.max(0, keep))) {
    await fs.rm(coreTxnDir(moxxyDir, j.txnId), { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Resolve a clone-relative path, refusing anything that escapes the repo —
 * including via a symlink. `path.resolve` collapses literal `..`, but the clone
 * is git-controlled and can contain symlinks, and core_write/core_edit follow
 * them (fs.writeFile/readFile dereference), so a path that textually stays inside
 * the repo but traverses a symlink could read or clobber files outside the clone
 * (the live install, ~/.ssh, …). We therefore (1) keep the cheap textual gate,
 * then (2) re-check against the realpath of the repo root and reject if any
 * existing component of the target is a symlink.
 */
export function safeRepoPath(repo: string, rel: string): string {
  const root = path.resolve(repo);
  const resolved = path.resolve(repo, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path escapes the provisioned repo: ${rel}`);
  }

  // Resolve the repo root through any symlinks once; everything must stay under it.
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    // Repo root not provisioned yet — the textual gate is the best we can do.
    return resolved;
  }

  // The portion *inside* the repo is the path relative to the (textual) root —
  // computed from `resolved`, NOT by re-resolving `rel` against realRoot. An
  // absolute `rel` (legitimately repo-prefixed) makes `path.resolve(realRoot,
  // rel)` ignore realRoot, and when the root traverses a symlink (e.g. macOS
  // /var→/private/var, or a symlinked $HOME) the relative diff is then all `..`
  // and a valid in-repo absolute path is wrongly rejected. Anchoring the
  // already-validated in-repo segments onto realRoot avoids that.
  const relParts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  if (relParts.some((p) => p === '..')) {
    throw new Error(`path escapes the provisioned repo: ${rel}`);
  }
  let cur = realRoot;
  for (const part of relParts) {
    cur = path.join(cur, part);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      break; // component doesn't exist yet (the file we're about to create) — stop.
    }
    if (st.isSymbolicLink()) {
      throw new Error(`path traverses a symlink, refusing: ${rel}`);
    }
  }
  return path.join(realRoot, ...relParts);
}
