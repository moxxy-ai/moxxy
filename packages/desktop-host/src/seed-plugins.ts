import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { compareSemver, z } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';

/**
 * First-launch plugin seeding: copy the packaged app's bundled
 * `plugins-seed` npm tree (assembled at build time by
 * apps/desktop/scripts/bundle-plugins-seed.mjs) into `<moxxyHome>/plugins`
 * so the spawned slim CLI runner finds the on-demand plugins WITHOUT npm or
 * network. Electron-free and idempotent:
 *
 * - The seed's own `package.json#dependencies` is the manifest (an npm
 *   prefix tree always has one) — no second list to drift.
 * - A package an earlier installer left is replaced by the one this installer
 *   carries, even at the same version number: a local build ships new code
 *   under an unchanged version. `seed-fingerprints.json` (written by the build)
 *   names each package's content, and `.moxxy-seed-state.json` in the target
 *   records the content last copied, so one installer replaces a package once
 *   and a later launch leaves it alone.
 * - A package installed newer than the seed (updated from npm since) is kept,
 *   and so is one another updater manages (`managedElsewhere`).
 * - Later `npm install --save` runs in the target keep working: the seed's
 *   dependency entries are merged into the target package.json, and a
 *   replaced package's ledger and lock entries move to the seed's.
 */
export interface SeedPluginsOptions {
  /** `process.resourcesPath` of the packaged app (contains `plugins-seed`). */
  readonly resourcesPath: string;
  /** The moxxy home dir (usually `~/.moxxy`; respect MOXXY_HOME upstream). */
  readonly moxxyHome: string;
  /** Packages another updater replaces (with its own approval and backup). */
  readonly managedElsewhere?: ReadonlyArray<string>;
  readonly log?: (msg: string) => void;
}

export interface SeedPluginsResult {
  /** Top-level node_modules entries the target did not have, copied from the seed. */
  readonly copied: ReadonlyArray<string>;
  /** Entries an earlier install left, replaced by the seed's. */
  readonly replaced: ReadonlyArray<string>;
  /** Entries kept as installed: current, newer, or managed elsewhere. */
  readonly skipped: ReadonlyArray<string>;
}

export interface SeedManifestRepairResult {
  /** Broken generated specs replaced by the exact installed version. */
  readonly replaced: ReadonlyArray<string>;
  /** Broken generated specs removed because no valid package is installed. */
  readonly removed: ReadonlyArray<string>;
}

const NOOP: SeedPluginsResult = { copied: [], replaced: [], skipped: [] };
const FINGERPRINTS_FILE = 'seed-fingerprints.json';
const STATE_FILE = '.moxxy-seed-state.json';
/** Swap space beside node_modules, so plugin discovery never sees a half-swapped copy. */
const STAGING_DIR = '.seed-staging';
const fingerprintsSchema = z.object({
  schemaVersion: z.literal(1),
  packages: z.record(z.string(), z.string().min(1)),
});
const stateSchema = fingerprintsSchema;
const NO_REPAIR: SeedManifestRepairResult = { replaced: [], removed: [] };
const MOXXY_PACKAGE_NAME = /^@moxxy\/[a-z0-9][a-z0-9._-]*$/i;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i;
const TRANSIENT_SEED_TARBALL = /(?:^|[\\/])moxxy-seed-tars-[^\\/]+[\\/][^\\/]+\.tgz$/i;
const packageLockSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  lockfileVersion: z.number().int().positive(),
  packages: z.record(z.string(), z.unknown()),
}).passthrough();
const packageLockRootSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
}).passthrough();
let manifestMutationTail: Promise<void> = Promise.resolve();

export async function seedPluginsFromResources(
  opts: SeedPluginsOptions,
): Promise<SeedPluginsResult> {
  const seedDir = path.join(opts.resourcesPath, 'plugins-seed');
  const seedModules = path.join(seedDir, 'node_modules');
  if (!(await isDir(seedModules))) return NOOP; // dev run / seed not bundled

  const targetDir = path.join(opts.moxxyHome, 'plugins');
  const targetModules = path.join(targetDir, 'node_modules');
  await fs.mkdir(targetModules, { recursive: true });
  const staging = path.join(targetDir, STAGING_DIR);
  await fs.rm(staging, { recursive: true, force: true });

  // A seed without fingerprints cannot tell an old copy from a current one,
  // so it only fills in what is missing.
  const fingerprints = await readFingerprints(path.join(seedDir, FINGERPRINTS_FILE));
  const applied = fingerprints ? await readFingerprints(path.join(targetDir, STATE_FILE), stateSchema) ?? {} : {};
  const managed = new Set(opts.managedElsewhere ?? []);

  // Every top-level entry (scoped dirs one level deeper): npm hoists flat, so
  // top-level coverage carries the transitive closure; skip npm's internal
  // `.bin`/`.package-lock` bookkeeping — the target tree manages its own.
  const copied: string[] = [];
  const replaced: string[] = [];
  const skipped: string[] = [];
  for (const entry of await listModuleEntries(seedModules)) {
    const from = path.join(seedModules, entry);
    const to = path.join(targetModules, entry);
    const fingerprint = fingerprints?.[entry];
    if (!(await exists(to))) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.cp(from, to, { recursive: true, force: false, errorOnExist: false });
      copied.push(entry);
      if (fingerprint) applied[entry] = fingerprint;
      continue;
    }
    if (!fingerprint || managed.has(entry) || applied[entry] === fingerprint || (await isNewerThanSeed(to, from))) {
      skipped.push(entry);
      continue;
    }
    try {
      await replaceEntry(from, to, staging);
    } catch (error) {
      // A file another process holds open (Windows) keeps the installed copy;
      // it is not recorded, so the next launch tries again.
      opts.log?.(`plugins-seed: kept the installed ${entry}: ${error instanceof Error ? error.message : String(error)}`);
      skipped.push(entry);
      continue;
    }
    replaced.push(entry);
    applied[entry] = fingerprint;
  }
  await fs.rm(staging, { recursive: true, force: true });

  if (fingerprints) {
    await writeFileAtomic(
      path.join(targetDir, STATE_FILE),
      `${JSON.stringify({ schemaVersion: 1, packages: applied }, null, 2)}\n`,
    );
  }
  await mergeManifest(seedDir, targetDir, replaced);
  opts.log?.(
    `plugins-seed: copied ${copied.length} and replaced ${replaced.length} package(s) in ${targetDir}` +
      (skipped.length > 0 ? ` (${skipped.length} kept as installed)` : ''),
  );
  return { copied, replaced, skipped };
}

/** Copy beside the target, then swap: a crash leaves either copy whole, never half of one. */
async function replaceEntry(from: string, to: string, staging: string): Promise<void> {
  await fs.mkdir(staging, { recursive: true });
  const work = await fs.mkdtemp(path.join(staging, 'swap-'));
  const fresh = path.join(work, 'new');
  const previous = path.join(work, 'previous');
  await fs.cp(from, fresh, { recursive: true, force: false, errorOnExist: true });
  await fs.rename(to, previous);
  try {
    await fs.rename(fresh, to);
  } catch (error) {
    await fs.rename(previous, to);
    throw error;
  }
  await fs.rm(work, { recursive: true, force: true });
}

/** The installed copy carries a higher version than the seed's (npm updated it). */
async function isNewerThanSeed(installed: string, seed: string): Promise<boolean> {
  const installedVersion = await readVersion(installed);
  const seedVersion = await readVersion(seed);
  return installedVersion !== null && seedVersion !== null && compareSemver(installedVersion, seedVersion) > 0;
}

async function readVersion(packageDir: string): Promise<string | null> {
  try {
    const manifest = await readJson(path.join(packageDir, 'package.json'));
    return typeof manifest?.version === 'string' && EXACT_VERSION.test(manifest.version) ? manifest.version : null;
  } catch {
    return null;
  }
}

/** Package → content fingerprint, or null when the file is absent or unreadable. */
async function readFingerprints(
  file: string,
  schema: typeof fingerprintsSchema = fingerprintsSchema,
): Promise<Record<string, string> | null> {
  try {
    const parsed = schema.safeParse(await readJson(file));
    return parsed.success ? { ...parsed.data.packages } : null;
  } catch {
    return null;
  }
}

/** Top-level module names, descending one level into @scopes. */
async function listModuleEntries(modulesDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await fs.readdir(modulesDir)) {
    if (name.startsWith('.')) continue;
    if (name.startsWith('@')) {
      for (const sub of await fs.readdir(path.join(modulesDir, name))) {
        if (!sub.startsWith('.')) out.push(`${name}/${sub}`);
      }
    } else {
      out.push(name);
    }
  }
  return out;
}

/** Merge the seed's dependency ledger into the target package.json (creating
 *  the standard user-plugins stub when absent) so future `npm install --save`
 *  runs in the target tree keep every seeded package on their ledger. */
async function mergeManifest(seedDir: string, targetDir: string, replaced: ReadonlyArray<string>): Promise<void> {
  await serializeManifestMutation(async () => {
    const seedPkg = await readJson(path.join(seedDir, 'package.json'));
    const seedDeps = await normalizeGeneratedSeedSpecs(
      dependenciesOf(seedPkg),
      path.join(seedDir, 'node_modules'),
    );
    const targetPath = path.join(targetDir, 'package.json');
    const targetPkg = (await readJson(targetPath)) ?? {
      name: 'moxxy-user-plugins',
      version: '0.0.0',
      private: true,
      type: 'module',
      description: 'Auto-generated workspace for moxxy plugins installed at runtime.',
    };
    const targetDeps = await normalizeGeneratedSeedSpecs(
      dependenciesOf(targetPkg),
      path.join(targetDir, 'node_modules'),
      seedDeps.dependencies,
    );
    // A replaced package takes the seed's spec: an older pinned one would make
    // the next `npm install` put the old version back.
    const adopted = Object.fromEntries(
      replaced.flatMap((name) => {
        const spec = seedDeps.dependencies[name];
        return spec === undefined ? [] : [[name, spec]];
      }),
    );
    targetPkg.dependencies = {
      ...seedDeps.dependencies,
      ...targetDeps.dependencies,
      ...adopted,
    };
    await writeFileAtomic(targetPath, `${JSON.stringify(targetPkg, null, 2)}\n`);
    await initializePackageLock(seedDir, targetDir, targetPkg);
    if (replaced.length > 0) {
      await adoptSeedLockEntries(seedDir, targetDir, targetPkg, replaced);
      // npm's hidden lockfile describes the tree before the swap.
      await fs.rm(path.join(targetDir, 'node_modules', '.package-lock.json'), { force: true });
    }
  });
}

/**
 * Point the target lock's entries for each replaced package (and the
 * dependencies nested under it) at the seed's, so npm sees the tree that is
 * on disk. Entries of everything else stay as the user's npm left them.
 */
async function adoptSeedLockEntries(
  seedDir: string,
  targetDir: string,
  targetManifest: JsonObject,
  replaced: ReadonlyArray<string>,
): Promise<void> {
  const targetPath = path.join(targetDir, 'package-lock.json');
  const target = packageLockSchema.safeParse(await readJson(targetPath));
  if (!target.success || !packageLockRootSchema.safeParse(target.data.packages['']).success) return;
  const seed = packageLockSchema.safeParse(await readJson(path.join(seedDir, 'package-lock.json')));
  const seedPackages = seed.success ? seed.data.packages : {};
  const packages = { ...target.data.packages };
  for (const name of replaced) {
    const key = `node_modules/${name}`;
    const owned = (lockPath: string) => lockPath === key || lockPath.startsWith(`${key}/`);
    for (const lockPath of Object.keys(packages)) if (owned(lockPath)) delete packages[lockPath];
    for (const [lockPath, value] of Object.entries(seedPackages)) if (owned(lockPath)) packages[lockPath] = value;
  }
  const normalized = normalizePackageLock({ ...target.data, packages }, targetManifest);
  await writeFileAtomic(
    targetPath,
    `${JSON.stringify({ ...target.data, packages: normalized.packages }, null, 2)}\n`,
  );
}

/**
 * Preserve npm's resolved graph for the copied seed tree. Without its root
 * lockfile, a later optional-plugin install resolves every seeded dependency
 * again. On a clean Windows host that reaches Baileys' git-based libsignal
 * dependency and fails because Git is intentionally not a desktop prerequisite.
 *
 * An existing target lock belongs to the user/npm and is never overwritten.
 * For a fresh or legacy lock-less tree, copy the packaged lock and align only
 * its root metadata/dependency ledger with the manifest written above. The
 * build-only `file:moxxy-seed-tars-*` locations are removed from first-party
 * package entries because those temporary tarballs do not exist after packaging.
 */
async function initializePackageLock(
  seedDir: string,
  targetDir: string,
  targetManifest: JsonObject,
): Promise<void> {
  const targetPath = path.join(targetDir, 'package-lock.json');
  if (await exists(targetPath)) return;

  const seedLock = await readJson(path.join(seedDir, 'package-lock.json'));
  if (!seedLock) return;
  const parsed = packageLockSchema.safeParse(seedLock);
  if (!parsed.success) {
    throw new Error('Bundled plugins-seed package-lock.json is malformed.');
  }
  const root = packageLockRootSchema.safeParse(parsed.data.packages['']);
  if (!root.success) {
    throw new Error('Bundled plugins-seed package-lock.json has no valid root package.');
  }

  const targetName = typeof targetManifest.name === 'string'
    ? targetManifest.name
    : parsed.data.name;
  const targetVersion = typeof targetManifest.version === 'string'
    ? targetManifest.version
    : parsed.data.version;
  const normalized = normalizePackageLock(parsed.data, targetManifest);
  const lock = {
    ...parsed.data,
    ...(targetName ? { name: targetName } : {}),
    ...(targetVersion ? { version: targetVersion } : {}),
    packages: normalized.packages,
  };
  await writeFileAtomic(targetPath, `${JSON.stringify(lock, null, 2)}\n`);
}

/**
 * Repair manifests written by desktop builds that briefly used `file:` specs
 * pointing at their build-time `moxxy-seed-tars-*` directory. That directory
 * is deleted after packaging, so a later `npm install` (including Local Piper)
 * otherwise fails while resolving an unrelated, long-gone tarball.
 *
 * Only the exact first-party generated shape is touched. User-authored `file:`
 * dependencies remain intact. A valid installed package supplies the durable
 * exact version; an entry with no package behind it is removed so npm can work
 * again.
 */
export async function repairSeededPluginManifest(
  pluginsDir: string,
): Promise<SeedManifestRepairResult> {
  return serializeManifestMutation(async () => {
    const manifestPath = path.join(pluginsDir, 'package.json');
    const pkg = await readJson(manifestPath);
    if (!pkg) return NO_REPAIR;

    const normalized = await normalizeGeneratedSeedSpecs(
      dependenciesOf(pkg),
      path.join(pluginsDir, 'node_modules'),
    );
    if (normalized.replaced.length > 0 || normalized.removed.length > 0) {
      pkg.dependencies = normalized.dependencies;
      await writeFileAtomic(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    await repairPackageLock(pluginsDir, pkg);
    return {
      replaced: normalized.replaced,
      removed: normalized.removed,
    };
  });
}

async function repairPackageLock(
  pluginsDir: string,
  targetManifest: JsonObject,
): Promise<void> {
  const lockPath = path.join(pluginsDir, 'package-lock.json');
  const lock = await readJson(lockPath);
  if (!lock) return;
  const parsed = packageLockSchema.safeParse(lock);
  if (!parsed.success) return;
  const root = packageLockRootSchema.safeParse(parsed.data.packages['']);
  if (!root.success) return;

  const normalized = normalizePackageLock(parsed.data, targetManifest);
  if (!normalized.changed) return;
  await writeFileAtomic(
    lockPath,
    `${JSON.stringify({ ...parsed.data, packages: normalized.packages }, null, 2)}\n`,
  );
}

interface NormalizedPackageLock {
  readonly packages: Record<string, unknown>;
  readonly changed: boolean;
}

function normalizePackageLock(
  lock: z.infer<typeof packageLockSchema>,
  targetManifest: JsonObject,
): NormalizedPackageLock {
  const packages = { ...lock.packages };
  const root = packageLockRootSchema.parse(packages['']);
  const targetDependencies = dependenciesOf(targetManifest);
  let changed = !sameDependencies(root.dependencies ?? {}, targetDependencies);
  packages[''] = { ...root, dependencies: targetDependencies };

  for (const [packagePath, value] of Object.entries(packages)) {
    if (!packagePath.startsWith('node_modules/') || !isJsonObject(value)) continue;
    const name = packagePath.slice('node_modules/'.length);
    if (name.includes('/node_modules/')) continue;
    const resolved = value.resolved;
    if (typeof resolved !== 'string' || !isGeneratedTransientSeedSpec(name, resolved)) {
      continue;
    }
    const durable = { ...value };
    delete durable.resolved;
    delete durable.integrity;
    packages[packagePath] = durable;
    changed = true;
  }
  return { packages, changed };
}

function sameDependencies(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  return leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([name, spec]) => right[name] === spec);
}

interface NormalizedDependencies extends SeedManifestRepairResult {
  readonly dependencies: Record<string, string>;
}

async function normalizeGeneratedSeedSpecs(
  dependencies: Readonly<Record<string, string>>,
  modulesDir: string,
  fallback: Readonly<Record<string, string>> = {},
): Promise<NormalizedDependencies> {
  const normalized = { ...dependencies };
  const replaced: string[] = [];
  const removed: string[] = [];
  for (const [name, spec] of Object.entries(dependencies)) {
    if (!isGeneratedTransientSeedSpec(name, spec)) continue;
    const installedVersion = await readInstalledExactVersion(modulesDir, name);
    const fallbackSpec = fallback[name];
    const durableSpec = installedVersion ?? (
      fallbackSpec && EXACT_VERSION.test(fallbackSpec) ? fallbackSpec : null
    );
    if (durableSpec) {
      normalized[name] = durableSpec;
      replaced.push(name);
    } else {
      delete normalized[name];
      removed.push(name);
    }
  }
  return { dependencies: normalized, replaced, removed };
}

function isGeneratedTransientSeedSpec(name: string, spec: string): boolean {
  return (
    MOXXY_PACKAGE_NAME.test(name) &&
    spec.startsWith('file:') &&
    TRANSIENT_SEED_TARBALL.test(spec.slice('file:'.length))
  );
}

async function readInstalledExactVersion(
  modulesDir: string,
  expectedName: string,
): Promise<string | null> {
  try {
    const manifest = await readJson(path.join(modulesDir, expectedName, 'package.json'));
    if (!manifest || manifest.name !== expectedName) return null;
    return typeof manifest.version === 'string' && EXACT_VERSION.test(manifest.version)
      ? manifest.version
      : null;
  } catch {
    return null;
  }
}

function dependenciesOf(pkg: JsonObject | null): Record<string, string> {
  if (!pkg || !isJsonObject(pkg.dependencies)) return {};
  return Object.fromEntries(
    Object.entries(pkg.dependencies).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(p: string): Promise<JsonObject | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(p, 'utf8'));
    if (!isJsonObject(parsed)) throw new Error(`Expected a JSON object in ${p}`);
    return parsed;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return isJsonObject(error) && error.code === 'ENOENT';
}

function serializeManifestMutation<T>(work: () => Promise<T>): Promise<T> {
  const run = manifestMutationTail.then(work, work);
  manifestMutationTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
