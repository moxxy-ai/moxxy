import { promises as fs } from 'node:fs';
import { addModelTotals, createMutex, type ModelUsageTotals } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { z } from 'zod';

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
  // Route through `moxxyPath` so a `$MOXXY_HOME` override relocates the usage
  // aggregate alongside the rest of the data dir. Identical to
  // `~/.moxxy/usage.json` when MOXXY_HOME is unset.
  return moxxyPath('usage.json');
}

function emptyStats(): UsageStatsFile {
  return { version: 1, updatedAt: new Date().toISOString(), models: {} };
}

// Validates the on-disk shape so a hand-edited or partially-written file with a
// non-numeric counter (e.g. `inputTokens: "100"`) can't flow into
// `addModelTotals` and corrupt the persisted aggregate via string concatenation.
// A failed parse falls through to `emptyStats()`, exactly like malformed JSON.
const storedModelUsageSchema = z.object({
  calls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});

const usageStatsFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  models: z.record(z.string(), storedModelUsageSchema),
});

/**
 * Read the usage aggregate. Returns an empty file when missing or unparseable —
 * usage stats are an optional, non-load-blocking layer.
 */
export async function loadUsageStats(filePath: string = usageStatsPath()): Promise<UsageStatsFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const result = usageStatsFileSchema.safeParse(JSON.parse(raw));
    if (result.success) return result.data;
    // shape-invalid (e.g. a non-numeric counter) — start fresh rather than let
    // a corrupt entry poison the aggregate via string-concat addition.
  } catch {
    // missing or malformed JSON — start fresh
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
        ? { ...addModelTotals(existing, d), firstSeen: existing.firstSeen ?? now, lastSeen: now }
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

/**
 * Reset the aggregate to empty (the user-facing `/usage clear`). Runs inside the
 * same `mergeMutex` as `mergeUsageStats` so a clear can't interleave with an
 * in-flight merge's read-modify-write — otherwise the merge could write its
 * stale-plus-delta snapshot back after the clear lands and resurrect the cleared
 * aggregate (or the clear could clobber a concurrent merge).
 */
export async function clearUsageStats(filePath: string = usageStatsPath()): Promise<void> {
  await mergeMutex.run(async () => {
    await writeAtomic(emptyStats(), filePath);
  });
}
