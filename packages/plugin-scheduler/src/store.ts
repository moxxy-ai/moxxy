import { rename } from 'node:fs/promises';
import { createJsonFileStore, type JsonFileStore } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { isValidCron } from './cron.js';

/**
 * Persistent store for scheduled triggers. Single JSON file at
 * `~/.moxxy/schedules.json`. Mutations serialize through a write mutex
 * and land via an atomic whole-file write so a crash mid-write leaves
 * the previous state intact — same pattern used by the vault and
 * permissions store.
 *
 * `source` separates user-created schedules ("manual") from schedules
 * synthesized off of skill frontmatter ("skill"). The two namespaces
 * coexist in one file so the model's `schedule_list` tool surfaces
 * everything in one view, but the skill-sync code only ever
 * adds/removes its own rows.
 */

export const scheduleSourceSchema = z.enum(['manual', 'skill', 'workflow']);
export type ScheduleSource = z.infer<typeof scheduleSourceSchema>;

export const scheduleEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9-]*$/i, 'name must be slug-like'),
    prompt: z.string().min(1),
    cron: z.string().optional(),
    /** Epoch ms for one-shot schedules. Cleared once fired. */
    runAt: z.number().int().optional(),
    /** IANA timezone for cron interpretation. Default = system local. */
    timeZone: z.string().optional(),
    /** Soft hint for delivery target — e.g. "telegram", "inbox". The
     *  prompt itself does the actual send via a tool call. */
    channel: z.string().optional(),
    /** Optional model override the scheduled session should use. */
    model: z.string().optional(),
    enabled: z.boolean().default(true),
    createdAt: z.number().int(),
    lastRunAt: z.number().int().optional(),
    lastResult: z.enum(['ok', 'error']).optional(),
    lastError: z.string().optional(),
    source: scheduleSourceSchema.default('manual'),
    /** When source='skill': the skill name this schedule mirrors. */
    skillName: z.string().optional(),
    /** When source='workflow': the workflow name this schedule fires. */
    workflowName: z.string().optional(),
    /**
     * User deletion marker for source-owned schedules. Skill/workflow rows can
     * be mirrored back by their source on every sync; this marker keeps a user
     * deletion durable without editing the source file from a thin client.
     */
    deletedAt: z.number().int().optional(),
  })
  .superRefine((entry, ctx) => {
    if (!entry.cron && !entry.runAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a schedule needs either `cron` or `runAt`',
        path: ['cron'],
      });
    }
    // NOTE: the documented "exactly one of cron/runAt" contract is enforced at
    // the authoring trust boundaries (the schedule_create tool input and the
    // skill toEntryDraft path), NOT here — this schema validates EVERY internal
    // persisted write (incl. the workflow bridge, which historically may pass
    // both and rely on cron-precedence). Rejecting both here would throw inside
    // those internal writers and poison their reconcile loop. isDue's cron-first
    // precedence remains the well-defined fallback if both somehow persist.
    if (entry.cron && !isValidCron(entry.cron)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invalid cron expression "${entry.cron}"`,
        path: ['cron'],
      });
    }
    // timeZone is likewise validated at the authoring boundaries (tool input /
    // skill draft), not here — the internal workflow bridge passes an
    // unvalidated zone string through this schema. A bad zone that reaches the
    // persisted layer is rendered harmless by nextFireTime, which returns null
    // (entry never due) for a non-IANA zone instead of throwing mid-tick.
  });

export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

const fileSchema = z.object({
  version: z.literal(1),
  schedules: z.array(scheduleEntrySchema),
});

export interface ScheduleStoreOptions {
  /** Override path — primarily for tests. Defaults to ~/.moxxy/schedules.json. */
  readonly file?: string;
  /**
   * Optional logger. When the schedules file is corrupt (bad JSON / schema
   * mismatch) the store quarantines it and resets to empty; without a logger
   * that data loss is silent. `undefined` => silent (the on-disk quarantined
   * copy is still observable).
   */
  readonly logger?: {
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

export function defaultSchedulesFile(): string {
  return moxxyPath('schedules.json');
}

export class ScheduleStore {
  // Generic id-collection store owns the cache, write mutex, RMW `.slice()`
  // copy, and crash-atomic `{ version: 1, schedules: [...] }` write. A corrupt
  // file is quarantined (renamed to `<file>.corrupt-<ts>`) and the store resets
  // to empty so the data loss is observable; an unreadable file resets to empty.
  private readonly store: JsonFileStore<ScheduleEntry>;

  constructor(opts: ScheduleStoreOptions = {}) {
    const file = opts.file ?? defaultSchedulesFile();
    const logger = opts.logger;
    this.store = createJsonFileStore<ScheduleEntry>({
      file,
      itemsKey: 'schedules',
      load: async (raw) => {
        if (raw === null) return [];
        let valid = false;
        let schedules: ScheduleEntry[] = [];
        try {
          const parsed = fileSchema.safeParse(JSON.parse(raw));
          if (parsed.success) {
            valid = true;
            schedules = [...parsed.data.schedules];
          }
        } catch {
          // fall through to quarantine
        }
        if (valid) return schedules;
        // Corrupt file (bad JSON or schema mismatch). Quarantine it under a
        // timestamped name so the data loss is OBSERVABLE (and the original is
        // recoverable) rather than silently masked by an empty reset — a single
        // malformed byte from a partial external write would otherwise make
        // every schedule vanish with no signal. Reset to empty either way so a
        // bad file can't brick the whole scheduler.
        const quarantine = `${file}.corrupt-${Date.now()}`;
        try {
          await rename(file, quarantine);
          logger?.warn?.('scheduler: schedules file was corrupt; quarantined and reset', {
            file,
            quarantine,
          });
        } catch (err) {
          logger?.warn?.('scheduler: schedules file was corrupt; failed to quarantine', {
            file,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        return [];
      },
      // Non-ENOENT read errors were previously swallowed to an empty store too.
      onReadError: (err) => {
        logger?.warn?.('scheduler: failed to read schedules file; using empty set', {
          file,
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      },
    });
  }

  /** Force a re-read on the next access. Tests use this. */
  invalidate(): void {
    this.store.invalidate();
  }

  async list(): Promise<ReadonlyArray<ScheduleEntry>> {
    return (await this.store.read()).filter(isVisibleSchedule);
  }

  async get(id: string): Promise<ScheduleEntry | null> {
    const entry = await this.store.get(id);
    return entry && isVisibleSchedule(entry) ? entry : null;
  }

  async create(
    input: Omit<ScheduleEntry, 'id' | 'createdAt' | 'enabled' | 'source'> &
      Partial<Pick<ScheduleEntry, 'enabled' | 'source' | 'skillName' | 'workflowName'>>,
  ): Promise<ScheduleEntry> {
    const entry: ScheduleEntry = scheduleEntrySchema.parse({
      ...input,
      id: ulid(),
      createdAt: Date.now(),
      enabled: input.enabled ?? true,
      source: input.source ?? 'manual',
    });
    await this.store.mutate((schedules) => {
      schedules.push(entry);
      return schedules;
    });
    return entry;
  }

  async update(id: string, patch: Partial<ScheduleEntry>): Promise<ScheduleEntry | null> {
    let updated: ScheduleEntry | null = null;
    await this.store.mutate((schedules) => {
      const idx = schedules.findIndex((s) => s.id === id);
      if (idx < 0) return schedules;
      if (!isVisibleSchedule(schedules[idx]!)) return schedules;
      const next = scheduleEntrySchema.parse({ ...schedules[idx], ...patch });
      schedules[idx] = next;
      updated = next;
      return schedules;
    });
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    let removed = false;
    await this.store.mutate((schedules) => {
      const idx = schedules.findIndex((s) => s.id === id && isVisibleSchedule(s));
      if (idx < 0) return schedules;
      const entry = schedules[idx]!;
      removed = true;
      if (entry.source === 'manual') {
        return schedules.filter((s) => s.id !== id);
      }
      schedules[idx] = scheduleEntrySchema.parse({
        ...entry,
        enabled: false,
        deletedAt: Date.now(),
      });
      return schedules;
    });
    return removed;
  }

  /**
   * Batch-reconcile every `source='skill'` row against `wanted` (skillName →
   * desired draft) in a SINGLE atomic write, instead of one whole-file
   * serialization + fsync per changed row. The diff (and the resulting array)
   * matches running the equivalent sequence of create/update/delete calls:
   *   - skill rows whose skillName is absent from `wanted` are removed;
   *   - duplicate skill rows sharing a skillName collapse to the first
   *     (later copies are removed) so exactly one row survives per skillName;
   *   - present skillNames with no existing row are created (fresh id +
   *     createdAt), appended in `wanted` iteration order;
   *   - present skillNames with an existing row are updated IN PLACE (id,
   *     createdAt, position preserved) only when a field actually changed.
   * Returns the add/remove/update counts so the caller's telemetry is
   * unchanged. Manual/workflow rows are never touched.
   */
  async reconcileSkillSchedules(
    wanted: ReadonlyMap<string, Omit<ScheduleEntry, 'id' | 'createdAt'>>,
  ): Promise<{ added: number; removed: number; updated: number }> {
    let added = 0;
    let removed = 0;
    let updated = 0;
    await this.store.mutate((schedules) => {
      // 1. Remove skill rows whose skill is gone / dropped its schedule, AND
      //    collapse any duplicate skill rows that share a skillName down to the
      //    first (a prior crash between writes or a hand edit could leave two
      //    rows for the same skill; the stale duplicate would otherwise persist
      //    forever and fire alongside the canonical row). The reconcile thus
      //    converges to exactly one row per wanted skillName.
      const next: ScheduleEntry[] = [];
      const keptSkillNames = new Set<string>();
      for (const s of schedules) {
        if (s.source === 'skill' && s.skillName) {
          if (!wanted.has(s.skillName) || keptSkillNames.has(s.skillName)) {
            if (isVisibleSchedule(s)) removed += 1;
            continue;
          }
          keptSkillNames.add(s.skillName);
        }
        next.push(s);
      }

      // 2. Upsert wanted rows. Updates land in place; creates append. Re-find
      //    positions in `next` since the remove pass reindexed it.
      const posInNext = new Map<string, number>();
      for (let i = 0; i < next.length; i += 1) {
        const s = next[i]!;
        if (s.source === 'skill' && s.skillName && !posInNext.has(s.skillName)) {
          posInNext.set(s.skillName, i);
        }
      }
      for (const [skillName, draft] of wanted) {
        const idx = posInNext.get(skillName);
        if (idx === undefined) {
          next.push(
            scheduleEntrySchema.parse({
              ...draft,
              id: ulid(),
              createdAt: Date.now(),
              enabled: draft.enabled ?? true,
              source: draft.source ?? 'skill',
            }),
          );
          added += 1;
          continue;
        }
        const current = next[idx]!;
        if (!isVisibleSchedule(current)) continue;
        const patch = {
          prompt: draft.prompt,
          ...(draft.cron ? { cron: draft.cron } : { cron: undefined }),
          ...(draft.runAt !== undefined ? { runAt: draft.runAt } : { runAt: undefined }),
          ...(draft.timeZone ? { timeZone: draft.timeZone } : { timeZone: undefined }),
          ...(draft.channel ? { channel: draft.channel } : { channel: undefined }),
          enabled: draft.enabled ?? true,
        };
        const changed =
          current.prompt !== patch.prompt ||
          current.cron !== patch.cron ||
          current.runAt !== patch.runAt ||
          current.timeZone !== patch.timeZone ||
          current.channel !== patch.channel ||
          current.enabled !== patch.enabled;
        if (changed) {
          next[idx] = scheduleEntrySchema.parse({ ...current, ...patch });
          updated += 1;
        }
      }
      return next;
    });
    return { added, removed, updated };
  }

  /**
   * Replace every `source='skill'` schedule for the given `skillName`
   * with the supplied entry, OR remove all of them if `entry` is null.
   * Used by the skill-frontmatter sync hook. Manual schedules are left
   * untouched.
   */
  async syncSkillSchedule(skillName: string, entry: ScheduleEntry | null): Promise<void> {
    await this.store.mutate((schedules) => {
      const existingDeleted = schedules.find(
        (s) => s.source === 'skill' && s.skillName === skillName && !isVisibleSchedule(s),
      );
      const filtered = schedules.filter(
        (s) => !(s.source === 'skill' && s.skillName === skillName),
      );
      if (entry) {
        filtered.push(existingDeleted ?? scheduleEntrySchema.parse({ ...entry, source: 'skill', skillName }));
      }
      return filtered;
    });
  }

  /**
   * Replace the `source='workflow'` schedule for `workflowName` with the
   * supplied entry, or remove it if `entry` is null. Mirrors
   * {@link syncSkillSchedule}; manual/skill schedules are left untouched.
   * Used by the workflows integration to mirror a workflow's `on.schedule`
   * into the shared poller without a separate timer.
   */
  async syncWorkflowSchedule(workflowName: string, entry: ScheduleEntry | null): Promise<void> {
    await this.store.mutate((schedules) => {
      const existingDeleted = schedules.find(
        (s) => s.source === 'workflow' && s.workflowName === workflowName && !isVisibleSchedule(s),
      );
      const filtered = schedules.filter(
        (s) => !(s.source === 'workflow' && s.workflowName === workflowName),
      );
      if (entry) {
        // The workflow bridge passes `id: ''` as a "store assigns it" sentinel;
        // mint a real id here so the (id-min-1) schema can't throw mid-mutate
        // and silently strand every workflow schedule. A prior soft-deleted row
        // (its deletion marker kept durable) takes precedence so a user delete
        // isn't resurrected on the next sync.
        filtered.push(
          existingDeleted ??
            scheduleEntrySchema.parse({
              ...entry,
              id: entry.id || ulid(),
              source: 'workflow',
              workflowName,
            }),
        );
      }
      return filtered;
    });
  }
}

function isVisibleSchedule(entry: ScheduleEntry): boolean {
  return entry.deletedAt === undefined;
}
