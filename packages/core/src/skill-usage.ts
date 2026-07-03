import { promises as fs } from 'node:fs';
import { createMutex } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { z } from 'zod';

/**
 * Cross-session skill usage, persisted at `~/.moxxy/skills/.meta/usage.json`
 * (next to the agent-created audit log). A forward-going aggregate keyed by
 * skill NAME: each session folds its own `skill_invoked` / `skill_created`
 * events and merges the delta in on shutdown (see `@moxxy/plugin-usage-stats`).
 * Purely additive `invocations` counter plus first-`createdAt` / latest-
 * `lastInvokedAt` timestamps — a session's contribution is added once and the
 * file stays a monotone sum.
 *
 * KNOWN LIMITATION (as of this file's introduction): the only site that emits
 * `skill_invoked` today is the `load_skill` tool (reason `'load_skill_tool'` —
 * see `packages/core/src/skills/synthesize.ts`). The event type also carries
 * `'trigger_match' | 'classifier' | 'manual'` reasons, but nothing emits those
 * yet. So `invocations` counts ONLY explicit `load_skill` calls for now. When
 * trigger-match / classifier emission lands later, this same file simply starts
 * counting more — no format change required.
 *
 * Like `usage-stats.ts`, this is best-effort: a missing or malformed file reads
 * as empty, and a write failure never blocks shutdown.
 */
export interface SkillUsage {
  /** Total `load_skill`-driven invocations recorded across all sessions. */
  readonly invocations: number;
  /** ISO timestamp of the most recent recorded invocation, if any. */
  readonly lastInvokedAt?: string;
  /** ISO timestamp of when this skill was first agent-synthesized, if seen. */
  readonly createdAt?: string;
}

export interface SkillUsageFile {
  readonly version: 1;
  /** ISO timestamp of the last merge. */
  readonly updatedAt: string;
  /** Per-skill-name lifetime usage. */
  readonly skills: Record<string, SkillUsage>;
}

/**
 * One session's contribution for a single skill: how many invocations it saw,
 * the latest invocation timestamp within the run, and — if the skill was
 * created during the run — its creation timestamp.
 */
export interface SkillUsageDelta {
  readonly invocations: number;
  readonly lastInvokedAt?: string;
  readonly createdAt?: string;
}

export function skillsUsagePath(): string {
  // Route through `moxxyPath` so a `$MOXXY_HOME` override relocates the skill
  // usage aggregate alongside the rest of the data dir. Identical to
  // `~/.moxxy/skills/.meta/usage.json` when MOXXY_HOME is unset.
  return moxxyPath('skills/.meta/usage.json');
}

function emptyUsage(): SkillUsageFile {
  return { version: 1, updatedAt: new Date().toISOString(), skills: {} };
}

// Validates the on-disk shape so a hand-edited or partially-written file with a
// non-numeric counter (e.g. `invocations: "3"`) can't flow into the additive
// merge and corrupt the persisted aggregate via string concatenation. A failed
// parse falls through to `emptyUsage()`, exactly like malformed JSON.
const skillUsageSchema = z.object({
  invocations: z.number(),
  lastInvokedAt: z.string().optional(),
  createdAt: z.string().optional(),
});

const skillUsageFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  skills: z.record(z.string(), skillUsageSchema),
});

/**
 * Read the skill usage aggregate. Returns an empty file when missing or
 * unparseable — skill usage is an optional, non-load-blocking layer.
 */
export async function loadSkillUsage(
  filePath: string = skillsUsagePath(),
): Promise<SkillUsageFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const result = skillUsageFileSchema.safeParse(JSON.parse(raw));
    if (result.success) return result.data;
    // shape-invalid (e.g. a non-numeric counter) — start fresh rather than let
    // a corrupt entry poison the aggregate via string-concat addition.
  } catch {
    // missing or malformed JSON — start fresh
  }
  return emptyUsage();
}

async function writeAtomic(file: SkillUsageFile, filePath: string): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(file, null, 2) + '\n');
}

// Serializes the read-modify-write in `mergeSkillUsage` so two concurrent merges
// (e.g. overlapping shutdowns) can't both read the same snapshot and have the
// second write clobber the first's delta.
const mergeMutex = createMutex();

/** Later of two ISO timestamps (lexicographic sort is correct for same-format
 * UTC `toISOString()` output). Either may be absent. */
function laterIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * Merge a session's per-skill delta into the persisted aggregate and write it
 * back. Reads the current file, adds each `invocations` field-wise, keeps the
 * earliest `createdAt` and the latest `lastInvokedAt`, and writes atomically.
 * Returns the updated file.
 *
 * Best-effort: a write failure logs to stderr but does not throw — losing one
 * session's stats must never block shutdown.
 */
export async function mergeSkillUsage(
  delta: Record<string, SkillUsageDelta>,
  filePath: string = skillsUsagePath(),
): Promise<SkillUsageFile> {
  // An empty delta writes nothing, so there's no read-modify-write to serialize:
  // skip the mutex and read the current file directly. A session that exercised
  // no skills produces an empty delta on every shutdown, so this avoids needless
  // I/O + contention on the common no-op path.
  const keys = Object.keys(delta);
  if (keys.length === 0) return loadSkillUsage(filePath);

  return mergeMutex.run(async () => {
    const current = await loadSkillUsage(filePath);

    const now = new Date().toISOString();
    const skills: Record<string, SkillUsage> = { ...current.skills };
    for (const key of keys) {
      const d = delta[key]!;
      const existing = skills[key];
      const invocations = (existing?.invocations ?? 0) + d.invocations;
      const lastInvokedAt = laterIso(existing?.lastInvokedAt, d.lastInvokedAt);
      const createdAt = existing?.createdAt ?? d.createdAt;
      skills[key] = {
        invocations,
        ...(lastInvokedAt ? { lastInvokedAt } : {}),
        ...(createdAt ? { createdAt } : {}),
      };
    }
    const next: SkillUsageFile = { version: 1, updatedAt: now, skills };
    try {
      await writeAtomic(next, filePath);
    } catch (err) {
      process.stderr.write(
        `moxxy: failed to persist skill usage to ${filePath}: ` +
          `${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return next;
  });
}
