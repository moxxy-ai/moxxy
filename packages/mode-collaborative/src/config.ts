/**
 * CollabConfig — user-facing knobs for an agentic-collaborative run. Resolved
 * from defaults ← persisted preferences (`collab` block) ← per-run overrides.
 * Kept a plain, validated object so it can be surfaced in desktop Settings and
 * extended without touching the loop.
 */

import { z } from 'zod';

export interface CollabConfig {
  /** Hard cap on implementer agents (architect is extra). */
  readonly maxAgents: number;
  /** Default model for every peer (per-agent overrides win). */
  readonly defaultModel?: string;
  /** Show the architect's proposed roster for approval before launch. */
  readonly requireRosterApproval: boolean;
  /** Where merged work lands: into the user's branch, or left on a staging branch. */
  readonly mergePolicy: 'auto-into-branch' | 'stage-only';
  /** Run the project's build/test on staging before promoting. */
  readonly verifyGate: boolean;
  /** Parallel worktrees (git) vs sequential single-workspace (non-git fallback). */
  readonly concurrency: 'parallel' | 'sequential';
  /** Per-peer iteration cap. */
  readonly peerMaxIterations: number;
  /** Overall wall-clock guard for the build phase (ms). */
  readonly wallClockMs: number;
}

export const DEFAULT_COLLAB_CONFIG: CollabConfig = {
  maxAgents: 5,
  requireRosterApproval: true,
  mergePolicy: 'auto-into-branch',
  verifyGate: false,
  concurrency: 'parallel',
  peerMaxIterations: 60,
  wallClockMs: 30 * 60 * 1000,
};

/** Loose schema for the persisted `collab` preferences block (all optional). */
export const collabConfigSchema = z
  .object({
    maxAgents: z.number().int().min(1).max(12).optional(),
    defaultModel: z.string().min(1).optional(),
    requireRosterApproval: z.boolean().optional(),
    mergePolicy: z.enum(['auto-into-branch', 'stage-only']).optional(),
    verifyGate: z.boolean().optional(),
    concurrency: z.enum(['parallel', 'sequential']).optional(),
    peerMaxIterations: z.number().int().min(1).max(500).optional(),
    wallClockMs: z.number().int().min(60_000).optional(),
  })
  .partial();

export type CollabConfigPatch = z.infer<typeof collabConfigSchema>;

/** Merge defaults ← persisted ← per-run overrides into a complete config. */
export function resolveCollabConfig(
  persisted?: unknown,
  overrides?: Partial<CollabConfig>,
): CollabConfig {
  const parsed = collabConfigSchema.safeParse(persisted ?? {});
  const fromPrefs: CollabConfigPatch = parsed.success ? parsed.data : {};
  return {
    ...DEFAULT_COLLAB_CONFIG,
    ...stripUndefined(fromPrefs),
    ...stripUndefined(overrides ?? {}),
  };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
