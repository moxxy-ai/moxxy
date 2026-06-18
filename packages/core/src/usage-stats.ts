import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addModelTotals, createMutex, type ModelUsageTotals } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';

/**
 * Cross-session token usage, persisted at ~/.moxxy/usage.json. A forward-going
 * aggregate keyed by `"<provider>/<model>"`: each session folds its own
 * `provider_response` usage and merges the delta in on shutdown (see
 * `@moxxy/plugin-usage-stats`). Purely additive counters — no derived/cost
 * fields — so a session's contribution is added once and the file stays a sum.
 *
 * Like preferences, this is best-effort: a missing or malformed file reads as
 * empty, and a write failure never blocks shutdown.
 */
export interface StoredModelUsage extends ModelUsageTotals {
  /** ISO timestamp of the first session that recorded usage for this model. */
  readonly firstSeen: string;
  /** ISO timestamp of the most recent session that recorded usage. */
  readonly lastSeen: string;
}

export interface UsageStatsFile {
  readonly version: 1;
  /** ISO timestamp of the last merge/clear. */
  readonly updatedAt: string;
  /** Per-`provider/model` lifetime totals. */
  readonly models: Record<string, StoredModelUsage>;
}

export function usageStatsPath(): string {
  return path.join(os.homedir(), '.moxxy', 'usage.json');
}

function emptyStats(): UsageStatsFile {
  return { version: 1, updatedAt: new Date().toISOString(), models: {} };
}

/**
 * Read the usage aggregate. Returns an empty file when missing or unparseable —
 * usage stats are an optional, non-load-blocking layer.
 */
export async function loadUsageStats(filePath: string = usageStatsPath()): Promise<UsageStatsFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as UsageStatsFile).models === 'object' &&
      (parsed as UsageStatsFile).models !== null
    ) {
      return parsed as UsageStatsFile;
    }
  } catch {
    // missing or malformed — start fresh
  }
  return emptyStats();
}

async function writeAtomic(file: UsageStatsFile, filePath: string): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(file, null, 2) + '\n');
}

// Serializes the read-modify-write in `mergeUsageStats` so two concurrent
// merges (e.g. overlapping shutdowns) can't both read the same snapshot and
// have the second write clobber the first's delta.
const mergeMutex = createMutex();

/**
 * Merge a session's per-model delta into the persisted aggregate and write it
 * back. Reads the current file, adds each delta field-wise, refreshes
 * first/lastSeen, and writes atomically. Returns the updated file.
 *
 * Best-effort: a write failure logs to stderr but does not throw — losing one
 * session's stats must never block shutdown.
 */
export async function mergeUsageStats(
  delta: Record<string, ModelUsageTotals>,
  filePath: string = usageStatsPath(),
): Promise<UsageStatsFile> {
  // An empty delta writes nothing, so there's no read-modify-write to
  // serialize: skip the mutex entirely and read the current file directly. A
  // session with no recorded usage produces an empty delta on every shutdown,
  // so this avoids needless I/O + contention on the common no-op path.
  const keys = Object.keys(delta);
  if (keys.length === 0) return loadUsageStats(filePath);

  return mergeMutex.run(async () => {
    const current = await loadUsageStats(filePath);

    const now = new Date().toISOString();
    const models: Record<string, StoredModelUsage> = { ...current.models };
    for (const key of keys) {
      const d = delta[key]!;
      if (d.calls === 0) continue;
      const existing = models[key];
      models[key] = existing
        ? { ...addModelTotals(existing, d), firstSeen: existing.firstSeen, lastSeen: now }
        : { ...d, firstSeen: now, lastSeen: now };
    }
    const next: UsageStatsFile = { version: 1, updatedAt: now, models };
    try {
      await writeAtomic(next, filePath);
    } catch (err) {
      process.stderr.write(
        `moxxy: failed to persist usage stats to ${filePath}: ` +
          `${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return next;
  });
}

/** Reset the aggregate to empty (the user-facing `/usage clear`). */
export async function clearUsageStats(filePath: string = usageStatsPath()): Promise<void> {
  await writeAtomic(emptyStats(), filePath);
}
