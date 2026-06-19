/**
 * "Is a newer @moxxy/cli published?" — shared by the `moxxy update` command and
 * the TUI banner.
 *
 * The result is cached under `~/.moxxy/update-check.json` with a TTL so the TUI
 * can render a banner from disk on every launch without hitting the network. The
 * command bypasses the cache (the user explicitly asked). Everything here is
 * fail-soft: a missing/corrupt cache or an offline registry yields `null`, never
 * an error — a version check must never break the CLI or stall TUI startup.
 */

import { readFileSync } from 'node:fs';

import { moxxyPath, writeFileAtomicSync } from '@moxxy/sdk/server';

import { fetchLatest, type FetchLatestOpts } from './registry.js';

export interface CliUpdateCheck {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

/** How long a cached latest-version answer is trusted before a refetch. */
export const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const PKG = '@moxxy/cli';

interface CacheShape {
  checkedAt: number;
  latest: string;
}

function defaultCacheFile(): string {
  return moxxyPath('update-check.json');
}

/**
 * Numeric major.minor.patch compare. Returns >0 if `a` is newer than `b`.
 * Per SemVer §11, when the release tuple ties, a version WITH a prerelease tag
 * (e.g. `0.5.5-beta.1`) sorts BELOW the same release without one (`0.5.5`), so a
 * beta user is correctly told the stable shipped. (A local copy so the CLI
 * doesn't take a dependency on `@moxxy/desktop-host` just for this.)
 */
export function compareSemver(a: string, b: string): number {
  const split = (s: string): { tuple: number[]; pre: boolean } => {
    const [release = '', ...rest] = s.split('-');
    return {
      tuple: release.split('.').map((n) => Number.parseInt(n, 10) || 0),
      pre: rest.length > 0 && rest.join('-').length > 0,
    };
  };
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa.tuple[i] ?? 0) - (pb.tuple[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  return pa.pre ? -1 : 1; // prerelease < release on a tuple tie
}

function readCache(file: string): CacheShape | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<CacheShape>;
    if (typeof raw.checkedAt === 'number' && typeof raw.latest === 'string') {
      return { checkedAt: raw.checkedAt, latest: raw.latest };
    }
  } catch {
    /* missing / malformed → treat as no cache */
  }
  return null;
}

function writeCache(file: string, value: CacheShape): void {
  try {
    // Shared crash-atomic helper (pid+uuid tmp → renameSync): two in-process
    // writers to the same cache file never collide on the temp path.
    writeFileAtomicSync(file, JSON.stringify(value, null, 2));
  } catch {
    /* best effort — caching is an optimization, never a hard requirement */
  }
}

export interface CheckOpts extends FetchLatestOpts {
  /** Skip the cache and always hit the registry (the command does this). */
  force?: boolean;
  /** Override the cache file location (tests). */
  cacheFile?: string;
  /** Override "now" (tests). */
  now?: number;
}

function shape(current: string | undefined, latest: string | null): CliUpdateCheck | null {
  if (!current || !latest) return null;
  return { current, latest, updateAvailable: compareSemver(latest, current) > 0 };
}

/**
 * Read a previously-cached answer WITHOUT any network. Returns `null` when there
 * is no cache (regardless of age) — callers that want freshness call
 * {@link refreshCheck} in the background. Built for the TUI banner: instant, and
 * never blocks startup on the network.
 */
export function readCachedCheck(current: string | undefined, opts: CheckOpts = {}): CliUpdateCheck | null {
  const cache = readCache(opts.cacheFile ?? defaultCacheFile());
  return shape(current, cache?.latest ?? null);
}

/**
 * Fetch the latest version and update the cache. Fire-and-forget from the TUI to
 * warm the cache for next launch; awaited by the command. Returns the shaped
 * check (or `null` on a failed fetch — the cache is left untouched).
 */
export async function refreshCheck(current: string | undefined, opts: CheckOpts = {}): Promise<CliUpdateCheck | null> {
  const latest = await fetchLatest(PKG, opts);
  if (latest) {
    writeCache(opts.cacheFile ?? defaultCacheFile(), {
      checkedAt: opts.now ?? Date.now(),
      latest,
    });
  }
  return shape(current, latest);
}

/**
 * The everyday check: serve a fresh-enough cached answer, otherwise refetch +
 * recache. `force` always refetches. Fail-soft (`null` on no current version /
 * offline with no usable cache).
 */
export async function checkForCliUpdate(
  current: string | undefined,
  opts: CheckOpts = {},
): Promise<CliUpdateCheck | null> {
  if (!current) return null;
  const now = opts.now ?? Date.now();
  const file = opts.cacheFile ?? defaultCacheFile();
  if (!opts.force) {
    const cache = readCache(file);
    if (cache && now - cache.checkedAt < CACHE_TTL_MS) {
      return shape(current, cache.latest);
    }
  }
  const refreshed = await refreshCheck(current, { ...opts, cacheFile: file, now });
  // If the refetch failed but we have ANY cached value, fall back to it rather
  // than reporting "no info".
  return refreshed ?? shape(current, readCache(file)?.latest ?? null);
}
