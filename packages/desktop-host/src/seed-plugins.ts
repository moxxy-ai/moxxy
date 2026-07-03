import { promises as fs } from 'node:fs';
import * as path from 'node:path';

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

const NOOP: SeedPluginsResult = { copied: [], skipped: [] };

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
  const seedPkg = await readJson(path.join(seedDir, 'package.json'));
  const seedDeps = (seedPkg?.dependencies ?? {}) as Record<string, string>;
  const targetPath = path.join(targetDir, 'package.json');
  const targetPkg = (await readJson(targetPath)) ?? {
    name: 'moxxy-user-plugins',
    version: '0.0.0',
    private: true,
    type: 'module',
    description: 'Auto-generated workspace for moxxy plugins installed at runtime.',
  };
  targetPkg.dependencies = { ...seedDeps, ...(targetPkg.dependencies ?? {}) };
  await fs.writeFile(targetPath, JSON.stringify(targetPkg, null, 2) + '\n');
}

async function readJson(p: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as Record<string, any>;
  } catch {
    return null;
  }
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
