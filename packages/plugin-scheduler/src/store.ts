import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ulid } from 'ulid';
import { z } from 'zod';
import { isValidCron } from './cron.js';

/**
 * Persistent store for scheduled triggers. Single JSON file at
 * `~/.moxxy/schedules.json`. Mutations serialize through a
 * promise-chain mutex (each `mutate()` awaits the previous one) and
 * land via tmp-file + rename so a crash mid-write leaves the previous
 * state intact — same pattern used by the vault and permissions store.
 *
 * `source` separates user-created schedules ("manual") from schedules
 * synthesized off of skill frontmatter ("skill"). The two namespaces
 * coexist in one file so the model's `schedule_list` tool surfaces
 * everything in one view, but the skill-sync code only ever
 * adds/removes its own rows.
 */

export const scheduleSourceSchema = z.enum(['manual', 'skill']);
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
  return path.join(process.env.MOXXY_HOME ?? path.join(homedir(), '.moxxy'), 'schedules.json');
}

export class ScheduleStore {
  private readonly file: string;
  private cache: ScheduleEntry[] | null = null;
  private mutation: Promise<void> = Promise.resolve();

  constructor(opts: ScheduleStoreOptions = {}) {
    this.file = opts.file ?? defaultSchedulesFile();
  }

  /** Force a re-read on the next access. Tests use this. */
  invalidate(): void {
    this.cache = null;
  }

  async list(): Promise<ReadonlyArray<ScheduleEntry>> {
    await this.ensureLoaded();
    return this.cache!.slice();
  }

  async get(id: string): Promise<ScheduleEntry | null> {
    await this.ensureLoaded();
    return this.cache!.find((s) => s.id === id) ?? null;
  }

  async create(
    input: Omit<ScheduleEntry, 'id' | 'createdAt' | 'enabled' | 'source'> &
      Partial<Pick<ScheduleEntry, 'enabled' | 'source' | 'skillName'>>,
  ): Promise<ScheduleEntry> {
    const entry: ScheduleEntry = scheduleEntrySchema.parse({
      ...input,
      id: ulid(),
      createdAt: Date.now(),
      enabled: input.enabled ?? true,
      source: input.source ?? 'manual',
    });
    await this.mutate((schedules) => {
      schedules.push(entry);
      return schedules;
    });
    return entry;
  }

  async update(id: string, patch: Partial<ScheduleEntry>): Promise<ScheduleEntry | null> {
    let updated: ScheduleEntry | null = null;
    await this.mutate((schedules) => {
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
    await this.mutate((schedules) => {
      const before = schedules.length;
      const after = schedules.filter((s) => s.id !== id);
      removed = after.length < before;
      return after;
    });
    return removed;
  }

  /**
   * Replace every `source='skill'` schedule for the given `skillName`
   * with the supplied entry, OR remove all of them if `entry` is null.
   * Used by the skill-frontmatter sync hook. Manual schedules are left
   * untouched.
   */
  async syncSkillSchedule(skillName: string, entry: ScheduleEntry | null): Promise<void> {
    await this.mutate((schedules) => {
      const filtered = schedules.filter(
        (s) => !(s.source === 'skill' && s.skillName === skillName),
      );
      if (entry) {
        filtered.push(scheduleEntrySchema.parse({ ...entry, source: 'skill', skillName }));
      }
      return filtered;
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache) return;
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      this.cache = parsed.success ? [...parsed.data.schedules] : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = [];
      } else {
        // Corrupt file — start fresh rather than crash. The bad file is
        // left in place so the user can inspect it.
        this.cache = [];
      }
    }
  }

  /**
   * Read-modify-write the cached array under the chain mutex. The
   * mutator receives a fresh shallow copy; whatever it returns becomes
   * the new state. Persists atomically.
   */
  private async mutate(
    fn: (schedules: ScheduleEntry[]) => ScheduleEntry[],
  ): Promise<void> {
    const next = this.mutation.then(async () => {
      await this.ensureLoaded();
      const updated = fn(this.cache!.slice());
      this.cache = updated;
      await this.persist(updated);
    });
    this.mutation = next.catch(() => undefined);
    return next;
  }

  private async persist(schedules: ScheduleEntry[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({ version: 1, schedules }, null, 2);
    await writeFile(tmp, payload, 'utf8');
    await rename(tmp, this.file);
  }
}
