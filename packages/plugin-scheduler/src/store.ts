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
  })
  .superRefine((entry, ctx) => {
    if (!entry.cron && !entry.runAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a schedule needs either `cron` or `runAt`',
        path: ['cron'],
      });
    }
    if (entry.cron && !isValidCron(entry.cron)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invalid cron expression "${entry.cron}"`,
        path: ['cron'],
      });
    }
  });

export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

const fileSchema = z.object({
  version: z.literal(1),
  schedules: z.array(scheduleEntrySchema),
});

export interface ScheduleStoreOptions {
  /** Override path — primarily for tests. Defaults to ~/.moxxy/schedules.json. */
  readonly file?: string;
}

export function defaultSchedulesFile(): string {
  return moxxyPath('schedules.json');
}

export class ScheduleStore {
  // Generic id-collection store owns the cache, write mutex, RMW `.slice()`
  // copy, and crash-atomic `{ version: 1, schedules: [...] }` write. A corrupt
  // or unreadable file resets to empty and is left in place for inspection —
  // same behavior as before, now via the shared `load` hook.
  private readonly store: JsonFileStore<ScheduleEntry>;

  constructor(opts: ScheduleStoreOptions = {}) {
    this.store = createJsonFileStore<ScheduleEntry>({
      file: opts.file ?? defaultSchedulesFile(),
      itemsKey: 'schedules',
      load: (raw) => {
        if (raw === null) return [];
        try {
          const parsed = fileSchema.safeParse(JSON.parse(raw));
          return parsed.success ? [...parsed.data.schedules] : [];
        } catch {
          // Corrupt file — start fresh rather than crash. The bad file is
          // left in place so the user can inspect it.
          return [];
        }
      },
      // Non-ENOENT read errors were previously swallowed to an empty store too.
      onReadError: () => [],
    });
  }

  /** Force a re-read on the next access. Tests use this. */
  invalidate(): void {
    this.store.invalidate();
  }

  async list(): Promise<ReadonlyArray<ScheduleEntry>> {
    return this.store.read();
  }

  async get(id: string): Promise<ScheduleEntry | null> {
    return this.store.get(id);
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
      const before = schedules.length;
      const after = schedules.filter((s) => s.id !== id);
      removed = after.length < before;
      return after;
    });
    return removed;
  }

  /**
   * Batch-reconcile every `source='skill'` row against `wanted` (skillName →
   * desired draft) in a SINGLE atomic write, instead of one whole-file
   * serialization + fsync per changed row. The diff (and the resulting array)
   * is byte-identical to running the equivalent sequence of
   * create/update/delete calls:
   *   - skill rows whose skillName is absent from `wanted` are removed;
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
      // Index existing skill rows by skillName (first wins — mirrors the
      // existingSkill map the sequential reconcile built).
      const existingByName = new Map<string, number>();
      for (let i = 0; i < schedules.length; i += 1) {
        const s = schedules[i]!;
        if (s.source === 'skill' && s.skillName && !existingByName.has(s.skillName)) {
          existingByName.set(s.skillName, i);
        }
      }

      // 1. Remove skill rows whose skill is gone / dropped its schedule.
      const next: ScheduleEntry[] = [];
      for (const s of schedules) {
        if (s.source === 'skill' && s.skillName && !wanted.has(s.skillName)) {
          removed += 1;
          continue;
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
      const filtered = schedules.filter(
        (s) => !(s.source === 'skill' && s.skillName === skillName),
      );
      if (entry) {
        filtered.push(scheduleEntrySchema.parse({ ...entry, source: 'skill', skillName }));
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
      const filtered = schedules.filter(
        (s) => !(s.source === 'workflow' && s.workflowName === workflowName),
      );
      if (entry) {
        filtered.push(scheduleEntrySchema.parse({ ...entry, source: 'workflow', workflowName }));
      }
      return filtered;
    });
  }
}
