import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { z } from '@moxxy/sdk';
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
 * - Existing directories are NEVER overwritten: a user-updated install of a
 *   plugin (possibly newer than the seed) survives app updates.
 * - Later `npm install --save` runs in the target keep working: the seed's
 *   dependency entries are merged into the target package.json.
 */
export interface SeedPluginsOptions {
  /** `process.resourcesPath` of the packaged app (contains `plugins-seed`). */
  readonly resourcesPath: string;
  /** The moxxy home dir (usually `~/.moxxy`; respect MOXXY_HOME upstream). */
  readonly moxxyHome: string;
  readonly log?: (msg: string) => void;
}

export interface SeedPluginsResult {
  /** Top-level node_modules entries copied from the seed. */
  readonly copied: ReadonlyArray<string>;
  /** Seed entries skipped because the target already has them. */
  readonly skipped: ReadonlyArray<string>;
}

export interface SeedManifestRepairResult {
  /** Broken generated specs replaced by the exact installed version. */
  readonly replaced: ReadonlyArray<string>;
  /** Broken generated specs removed because no valid package is installed. */
  readonly removed: ReadonlyArray<string>;
}

const NOOP: SeedPluginsResult = { copied: [], skipped: [] };
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

  // Copy every top-level entry (scoped dirs one level deeper) that the
  // target doesn't already have. npm hoists flat, so top-level coverage
  // carries the transitive closure; skip npm's internal `.bin`/`.package-lock`
  // bookkeeping — the target tree manages its own.
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const entry of await listModuleEntries(seedModules)) {
    const from = path.join(seedModules, entry);
    const to = path.join(targetModules, entry);
    if (await exists(to)) {
      skipped.push(entry);
      continue;
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.cp(from, to, { recursive: true, force: false, errorOnExist: false });
    copied.push(entry);
  }

  await mergeManifest(seedDir, targetDir);
  opts.log?.(
    `plugins-seed: copied ${copied.length} package(s) into ${targetDir}` +
      (skipped.length > 0 ? ` (${skipped.length} already present)` : ''),
  );
  return { copied, skipped };
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
async function mergeManifest(seedDir: string, targetDir: string): Promise<void> {
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
    targetPkg.dependencies = {
      ...seedDeps.dependencies,
      ...targetDeps.dependencies,
    };
    await writeFileAtomic(targetPath, `${JSON.stringify(targetPkg, null, 2)}\n`);
    await initializePackageLock(seedDir, targetDir, targetPkg);
  });
}

/**
 * Preserve npm's resolved graph for the copied seed tree. Without its root
 * lockfile, a later optional-plugin install resolves every seeded dependency
 * again. On a clean Windows host that reaches Baileys' git-based libsignal
 * dependency and fails because Git is intentionally not a desktop prerequisite.
 *
 * An existing target lock belongs to the user/npm and is never overwritten.
 * For a fresh or legacy lock-less tree, copy the packaged lock and align only
 * its root metadata/dependency ledger with the manifest written above; resolved
 * package entries and integrity data remain untouched.
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
  const normalized = {
    ...parsed.data,
    ...(targetName ? { name: targetName } : {}),
    ...(targetVersion ? { version: targetVersion } : {}),
    packages: {
      ...parsed.data.packages,
      '': {
        ...root.data,
        dependencies: dependenciesOf(targetManifest),
      },
    },
  };
  await writeFileAtomic(targetPath, `${JSON.stringify(normalized, null, 2)}\n`);
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
    if (normalized.replaced.length === 0 && normalized.removed.length === 0) {
      return NO_REPAIR;
    }
    pkg.dependencies = normalized.dependencies;
    await writeFileAtomic(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`);
    return {
      replaced: normalized.replaced,
      removed: normalized.removed,
    };
  });
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
