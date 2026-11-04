import { readFile } from 'node:fs/promises';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import bundledFile from './agent-versions-blocked.json' with { type: 'json' };
import { compareVersions } from './cli-version.js';

/**
 * Versions of the agent CLIs that break with Moxxy, kept in
 * `agent-versions-blocked.json` beside this file. Moxxy reads the file from the
 * repository's development branch, so an entry reaches every install without a
 * release, and falls back on the copy it shipped with. A held-back version is
 * not offered as an update; an installed one is named with what is wrong.
 */
export interface BlockedAgentVersion {
  readonly version: string;
  /** What breaks, in a few words ("Does not answer in Moxxy"). */
  readonly reason: string;
}

/** By the agent's command (`claude`, `codex`, `opencode`). */
export type BlockedAgentVersions = Readonly<Record<string, ReadonlyArray<BlockedAgentVersion>>>;

export const BLOCKED_AGENT_VERSIONS_URL =
  'https://raw.githubusercontent.com/moxxy-ai/moxxy/development/packages/agent-connection-kit/src/agent-versions-blocked.json';

const VERSION = /^\d+(\.\d+)+$/;
const MAX_REASON = 300;
const HOUR_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

/** The list in `value`, without the entries that are not a plain version and a reason; null when it is not a list. */
export function parseBlockedAgentVersions(value: unknown): BlockedAgentVersions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, BlockedAgentVersion[]> = {};
  for (const [command, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    out[command] = entries.flatMap((entry: unknown): BlockedAgentVersion[] => {
      const { version, reason } = (entry && typeof entry === 'object' ? entry : {}) as { version?: unknown; reason?: unknown };
      if (typeof version !== 'string' || !VERSION.test(version) || typeof reason !== 'string') return [];
      const said = reason.trim();
      return said && said.length <= MAX_REASON ? [{ version, reason: said }] : [];
    });
  }
  return out;
}

/** The copy shipped with this build. */
export const BUNDLED_BLOCKED_AGENT_VERSIONS: BlockedAgentVersions = parseBlockedAgentVersions(bundledFile) ?? {};

/** The entry for `command` at `version`, if Moxxy knows it breaks. */
export function blockedAgentVersion(list: BlockedAgentVersions, command: string, version: string): BlockedAgentVersion | undefined {
  return list[command]?.find((entry) => compareVersions(entry.version, version.replace(/^v/, '')) === 0);
}

export interface BlockedVersionsOptions {
  readonly cacheFile?: string;
  readonly refresh?: boolean;
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly url?: string;
  readonly fetchImpl?: typeof fetch;
}

/** The file every runner shares the list in. */
export function defaultBlockedCacheFile(): string {
  return moxxyPath('cache', 'agent-cli-blocked.json');
}

interface BlockedCache {
  readonly at: number;
  readonly list: BlockedAgentVersions;
}

/**
 * The list, read from the repository at most once an hour and kept in one file
 * under the Moxxy home. When it cannot be read, the last list stands, else the
 * shipped copy: a missing list never stops a check.
 */
export async function blockedAgentVersions(opts: BlockedVersionsOptions = {}): Promise<BlockedAgentVersions> {
  const cacheFile = opts.cacheFile ?? defaultBlockedCacheFile();
  const now = (opts.now ?? Date.now)();
  const known = await readCache(cacheFile);
  if (known && !opts.refresh && now - known.at < (opts.ttlMs ?? HOUR_MS)) return known.list;
  const fetched = await fetchList(opts.url ?? BLOCKED_AGENT_VERSIONS_URL, opts.fetchImpl ?? fetch);
  if (!fetched) return known?.list ?? BUNDLED_BLOCKED_AGENT_VERSIONS;
  await writeFileAtomic(cacheFile, JSON.stringify({ at: now, list: fetched })).catch(() => undefined);
  return fetched;
}

/** The last list read, or the shipped copy, without asking the repository. */
export async function cachedBlockedAgentVersions(cacheFile: string = defaultBlockedCacheFile()): Promise<BlockedAgentVersions> {
  return (await readCache(cacheFile))?.list ?? BUNDLED_BLOCKED_AGENT_VERSIONS;
}

async function fetchList(url: string, fetchImpl: typeof fetch): Promise<BlockedAgentVersions | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return res.ok ? parseBlockedAgentVersions(JSON.parse(await res.text())) : null;
  } catch {
    return null;
  }
}

async function readCache(file: string): Promise<BlockedCache | null> {
  try {
    const { at, list } = JSON.parse(await readFile(file, 'utf8')) as { at?: unknown; list?: unknown };
    const parsed = parseBlockedAgentVersions(list);
    return typeof at === 'number' && parsed ? { at, list: parsed } : null;
  } catch {
    return null;
  }
}
