import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { isValidCron } from './cron.js';
import { nextCronFire } from './poller.js';
import { runSchedule, type InboxOptions, type SchedulePromptRunner } from './runner.js';
import type { ScheduleEntry, ScheduleStore } from './store.js';

const cronOrTimestamp = z
  .object({
    cron: z.string().optional(),
    runAt: z
      .union([
        z.number().int(),
        z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
          message: 'runAt must be an ISO timestamp or epoch-ms',
        }),
      ])
      .optional(),
    timeZone: z.string().optional(),
  })
  .refine((v) => !!v.cron || v.runAt !== undefined, {
    message: 'provide either `cron` or `runAt`',
  });

export function describeScheduleEntry(entry: ScheduleEntry): Record<string, unknown> {
  let nextFireAt: number | null = null;
  if (entry.cron) {
    // Share the poller's baseline (lastRunAt ?? createdAt) so the displayed
    // next-fire agrees with when isDue actually fires — anchoring at `now`
    // here used to hide a created-during-downtime catch-up the poller fires
    // immediately.
    const next = nextCronFire(entry);
    nextFireAt = next ? next.getTime() : null;
  } else if (entry.runAt && entry.enabled) {
    nextFireAt = entry.runAt;
  }
  return {
    id: entry.id,
    name: entry.name,
    enabled: entry.enabled,
    cron: entry.cron ?? null,
    runAt: entry.runAt ?? null,
    timeZone: entry.timeZone ?? null,
    channel: entry.channel ?? null,
    model: entry.model ?? null,
    promptPreview: entry.prompt.slice(0, 200),
    source: entry.source,
    skillName: entry.skillName ?? null,
    createdAt: entry.createdAt,
    lastRunAt: entry.lastRunAt ?? null,
    lastResult: entry.lastResult ?? null,
    lastError: entry.lastError ?? null,
    nextFireAt,
    nextFireIso: nextFireAt ? new Date(nextFireAt).toISOString() : null,
  };
}

export interface SchedulerToolDeps {
  readonly store: ScheduleStore;
  readonly runner: SchedulePromptRunner;
  readonly inbox?: InboxOptions;
}

export function buildSchedulerTools(deps: SchedulerToolDeps): ReadonlyArray<ToolDef> {
  const { store, runner } = deps;
  return [
    defineTool({
      name: 'schedule_create',
      description:
        'Create a scheduled prompt that fires on a cron (recurring) or a single timestamp ' +
        '(one-shot). The prompt runs in an isolated session at fire time; the final ' +
        "assistant message is appended to the user's inbox. Cron uses 5-field POSIX " +
        "syntax in the user's local timezone (override via `timeZone`). For Telegram or " +
        'other delivery, write the prompt to call the right send tool itself (e.g. ' +
        '"...then call telegram_send_message with the summary").',
      inputSchema: z
        .object({
          name: z
            .string()
            .min(1)
            .max(120)
            .regex(/^[a-z0-9][a-z0-9-]*$/i, 'name must be slug-like (letters, digits, hyphens)'),
          prompt: z.string().min(1),
          channel: z.string().optional(),
          model: z.string().optional(),
        })
        .and(cronOrTimestamp),
      permission: { action: 'prompt' },
      handler: async (input) => {
        const runAt =
          typeof input.runAt === 'string' ? Date.parse(input.runAt) : input.runAt;
        if (input.cron && !isValidCron(input.cron)) {
          throw new Error(`invalid cron expression "${input.cron}"`);
        }
        const created = await store.create({
          name: input.name,
          prompt: input.prompt,
          ...(input.cron ? { cron: input.cron } : {}),
          ...(runAt !== undefined ? { runAt } : {}),
          ...(input.timeZone ? { timeZone: input.timeZone } : {}),
          ...(input.channel ? { channel: input.channel } : {}),
          ...(input.model ? { model: input.model } : {}),
        });
        return describeScheduleEntry(created);
      },
    }),

    defineTool({
      name: 'schedule_list',
      description:
        'List every scheduled prompt — both manually-created and skill-driven — with ' +
        'their next computed fire time and last run outcome.',
      inputSchema: z.object({
        includeDisabled: z.boolean().default(true),
        source: z.enum(['manual', 'skill', 'all']).default('all'),
      }),
      handler: async ({ includeDisabled, source }) => {
        const entries = await store.list();
        const filtered = entries.filter((e) => {
          if (!includeDisabled && !e.enabled) return false;
          if (source !== 'all' && e.source !== source) return false;
          return true;
        });
        return filtered.map(describeScheduleEntry);
      },
    }),

    defineTool({
      name: 'schedule_delete',
      description:
        'Permanently remove a schedule by id. To temporarily pause, use schedule_disable ' +
        'instead. Skill-driven schedules will be re-created from the skill frontmatter ' +
        "on the next sync unless you also remove the skill's `schedule:` field.",
      inputSchema: z.object({ id: z.string().min(1) }),
      permission: { action: 'prompt' },
      handler: async ({ id }) => {
        const ok = await store.delete(id);
        return { deleted: ok };
      },
    }),

    defineTool({
      name: 'schedule_enable',
      description: 'Re-enable a previously disabled schedule.',
      inputSchema: z.object({ id: z.string().min(1) }),
      handler: async ({ id }) => {
        const updated = await store.update(id, { enabled: true });
        if (!updated) return { ok: false, reason: 'no schedule with that id' };
        return { ok: true, schedule: describeScheduleEntry(updated) };
      },
    }),

    defineTool({
      name: 'schedule_disable',
      description: 'Pause a schedule without deleting it. Re-enable later with schedule_enable.',
      inputSchema: z.object({ id: z.string().min(1) }),
      handler: async ({ id }) => {
        const updated = await store.update(id, { enabled: false });
        if (!updated) return { ok: false, reason: 'no schedule with that id' };
        return { ok: true, schedule: describeScheduleEntry(updated) };
      },
    }),

    defineTool({
      name: 'schedule_run_now',
      description:
        'Fire a schedule immediately, bypassing its cron/runAt. Useful for testing a ' +
        'newly-created schedule without waiting for the next tick. Updates lastRunAt as ' +
        'if it had fired at the scheduled time.',
      inputSchema: z.object({ id: z.string().min(1) }),
      permission: { action: 'prompt' },
      handler: async ({ id }) => {
        const entry = await store.get(id);
        if (!entry) throw new Error(`no schedule with id "${id}"`);
        const outcome = await runSchedule(entry, runner, store, deps.inbox);
        return {
          ok: outcome.ok,
          inboxPath: outcome.inboxPath ?? null,
          ...(outcome.error ? { error: outcome.error } : {}),
          text: outcome.text.slice(0, 4000),
        };
      },
    }),
  ];
}
