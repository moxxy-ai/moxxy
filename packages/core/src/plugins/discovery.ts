import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { moxxyPackageSchema, type ResolvedPluginManifest } from '@moxxy/sdk';
import type { Logger } from '../logger.js';

/**
 * Maximum number of directory levels to climb when collecting `node_modules`
 * roots from the cwd upward. Bounds the walk so discovery never traverses all
 * the way to the filesystem root on a deeply-nested cwd.
 */
const MAX_NODE_MODULES_WALK_DEPTH = 8;

/**
 * Cap on simultaneous fs handles opened while fanning out manifest reads /
 * scoped-dir scans. A hoisted monorepo can have thousands of packages;
 * an uncapped `Promise.all` opens that many fds at once and hits EMFILE/ENFILE,
 * which `readPluginManifest` would then swallow as "no plugin" — silently
 * dropping real plugins under fd pressure. Bounding it keeps discovery
 * deterministic.
 */
const DISCOVERY_CONCURRENCY = 32;

/** Map `items` through `fn` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i]!;
      out[i] = await fn(item, i);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

export interface DiscoveryOptions {
  readonly cwd: string;
  readonly logger: Logger;
  readonly extraPaths?: ReadonlyArray<string>;
}

export async function discoverPlugins(opts: DiscoveryOptions): Promise<ReadonlyArray<ResolvedPluginManifest>> {
  const seen = new Set<string>();
  const out: ResolvedPluginManifest[] = [];

  const roots = await candidateRoots(opts.cwd);
  for (const extra of opts.extraPaths ?? []) roots.push(extra);

  for (const root of roots) {
    let pkgsDirs: string[];
    try {
      pkgsDirs = await listPackageDirs(root);
    } catch (err) {
      opts.logger.debug('discovery: failed to list packages in root', { root, err: String(err) });
      continue;
    }
    // Dedupe by path FIRST (cheap, order-preserving), then read the unique
    // manifests in parallel — the reads are independent fs.readFile + parse.
    // Promise.all preserves array order, so the emitted order is identical to
    // the prior sequential loop.
    const uniquePaths = pkgsDirs.filter((pkgPath) => {
      if (seen.has(pkgPath)) return false;
      seen.add(pkgPath);
      return true;
    });
    const manifests = await mapWithConcurrency(uniquePaths, DISCOVERY_CONCURRENCY, (pkgPath) =>
      readPluginManifest(pkgPath, opts.logger),
    );
    for (const manifest of manifests) {
      if (manifest) out.push(manifest);
    }
  }
  return out;
}

async function candidateRoots(cwd: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = path.resolve(cwd);
  for (let i = 0; i < MAX_NODE_MODULES_WALK_DEPTH; i++) {
    out.push(path.join(cursor, 'node_modules'));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return out;
}

async function listPackageDirs(root: string): Promise<string[]> {
  const entries: import('node:fs').Dirent[] = await fs
    .readdir(root, { withFileTypes: true })
    .catch((): import('node:fs').Dirent[] => []);
  // Resolve each top-level entry to its contributed package dirs with bounded
  // concurrency (scoped `@org` dirs need their own readdir), then flatten in
  // entry order so the result matches the prior sequential walk. Bounding the
  // scoped readdirs avoids opening one fd per `@org` dir all at once on a large
  // hoisted node_modules.
  const perEntry = await mapWithConcurrency(
    entries,
    DISCOVERY_CONCURRENCY,
    async (entry): Promise<string[]> => {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return [];
      const full = path.join(root, entry.name);
      if (entry.name.startsWith('@')) {
        const sub: import('node:fs').Dirent[] = await fs
          .readdir(full, { withFileTypes: true })
          .catch((): import('node:fs').Dirent[] => []);
        return sub
          .filter((s) => s.isDirectory() || s.isSymbolicLink())
          .map((s) => path.join(full, s.name));
      }
      if (entry.name !== '.bin' && entry.name !== '.pnpm') return [full];
      return [];
    },
  );
  return perEntry.flat();
}

async function readPluginManifest(
  packagePath: string,
  logger: Logger,
): Promise<ResolvedPluginManifest | null> {
  const pkgJsonPath = path.join(packagePath, 'package.json');
  let pkg: { name?: string; version?: string; moxxy?: unknown };
  try {
    pkg = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'));
  } catch (err) {
    // A missing package.json (ENOENT) is the common, expected "not a package"
    // case — stay silent. Any other errno (EMFILE/ENFILE under fd pressure,
    // EACCES, a malformed JSON SyntaxError) means a plugin may have been DROPPED
    // for a non-structural reason, so surface it instead of swallowing it
    // identically to "no package.json".
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') {
      logger.warn('discovery: could not read package.json', {
        path: pkgJsonPath,
        ...(code ? { code } : {}),
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
  if (!pkg.moxxy) return null;
  if (!pkg.name) return null;

  const parsedMoxxy = moxxyPackageSchema.safeParse(pkg.moxxy);
  if (!parsedMoxxy.success) {
    logger.warn('discovery: invalid moxxy package config, skipping', {
      package: pkg.name,
      issues: parsedMoxxy.error.issues,
    });
    return null;
  }

  const { plugin, requirements } = parsedMoxxy.data;
  if (!plugin) return null;

  return {
    ...plugin,
    packageName: pkg.name,
    packageVersion: pkg.version ?? '0.0.0',
    packagePath,
    ...(requirements ? { requirements } : {}),
  };
}
