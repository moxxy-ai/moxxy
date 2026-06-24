import { definePlugin, type CrossProcessFireLock, type Plugin, type SkillRegistry } from '@moxxy/sdk';
import { CrossProcessFireLock as CrossProcessFireLockImpl, moxxyPath } from '@moxxy/sdk/server';
import { isValidCron, isValidTimeZone, nextFireTime, parseCron } from './cron.js';
import { FiringLock } from './firing-lock.js';
import { SchedulerPoller, isDue } from './poller.js';
import { defaultInboxDir, runSchedule, type InboxOptions, type SchedulePromptResult, type SchedulePromptRunner } from './runner.js';
import { syncSkillSchedules } from './skill-sync.js';
import {
  defaultSchedulesFile,
  ScheduleStore,
  scheduleEntrySchema,
  scheduleSourceSchema,
  type ScheduleEntry,
  type ScheduleSource,
  type ScheduleStoreOptions,
} from './store.js';
import { buildSchedulerTools, describeScheduleEntry, type SchedulerToolDeps } from './tools.js';

export {
  FiringLock,
  SchedulerPoller,
  ScheduleStore,
  buildSchedulerTools,
  describeScheduleEntry,
  isDue,
  isValidCron,
  isValidTimeZone,
  nextFireTime,
  parseCron,
  defaultInboxDir,
  defaultSchedulesFile,
  runSchedule,
  scheduleEntrySchema,
  scheduleSourceSchema,
  syncSkillSchedules,
  type InboxOptions,
  type ScheduleEntry,
  type ScheduleSource,
  type ScheduleStoreOptions,
  type SchedulePromptResult,
  type SchedulePromptRunner,
  type SchedulerToolDeps,
};

export interface BuildSchedulerPluginOptions {
  /** Persistent store. Default: ScheduleStore({ file: ~/.moxxy/schedules.json }). */
  readonly store?: ScheduleStore;
  /**
   * Bootstrap-provided runner that knows how to execute a prompt in an
   * isolated session. Required — without it, scheduled fires have
   * nothing to dispatch to.
   */
  readonly runner: SchedulePromptRunner;
  /**
   * Skill registry to mirror into schedules. Optional — without it,
   * only manually-created schedules fire.
   */
  readonly skills?: SkillRegistry;
  readonly inbox?: InboxOptions;
  readonly intervalMs?: number;
  /**
   * This runner's session identity (`MOXXY_SESSION_ID`). When set, schedules
   * created in a session are stamped with it and fire only on their owning
   * runner — so with several runners polling the same shared store, a schedule
   * lands in the chat that created it instead of whichever poller ticks first.
   */
  readonly ownerSessionId?: string;
  /**
   * Cross-process "fire exactly once" lock for owner-less (skill/workflow/
   * unstamped) schedules. Defaults to one rooted at `~/.moxxy/locks/scheduler`.
   * Inject a test-scoped instance (or `null` to disable) in tests.
   */
  readonly fireLock?: CrossProcessFireLock | null;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Notification hook (the channel uses this to push a "scheduled task
   *  ran" toast). */
  readonly onFired?: (entry: ScheduleEntry, outcome: { ok: boolean; text: string }) => void;
}

/**
 * Build the scheduler plugin. The returned `plugin` registers the six
 * scheduler tools; its `onInit` hook starts a `SchedulerPoller` (and
 * primes it with skill-driven schedules) and `onShutdown` stops it.
 *
 * Returns the poller + store so the CLI can expose `moxxy schedule
 * run <id>` and similar one-shot subcommands without going through
 * the model.
 */
export function buildSchedulerPlugin(opts: BuildSchedulerPluginOptions): {
  readonly plugin: Plugin;
  readonly store: ScheduleStore;
  readonly poller: SchedulerPoller;
} {
  const store = opts.store ?? new ScheduleStore({ ...(opts.logger ? { logger: opts.logger } : {}) });
  // Single per-entry firing mutex shared between the background poller and the
  // `schedule_run_now` tool so a manual run and a background tick can never
  // double-fire (and race store.update on) the same schedule.
  const firingLock = new FiringLock();
  // Cross-process fire-once lock for owner-less schedules. `null` explicitly
  // disables it (tests); otherwise default to a shared dir under ~/.moxxy.
  const fireLock =
    opts.fireLock === null
      ? undefined
      : (opts.fireLock ?? new CrossProcessFireLockImpl({ dir: moxxyPath('locks', 'scheduler') }));
  const poller = new SchedulerPoller({
    store,
    runner: opts.runner,
    firingLock,
    ...(opts.skills ? { skills: opts.skills } : {}),
    ...(opts.intervalMs !== undefined ? { intervalMs: opts.intervalMs } : {}),
    ...(opts.inbox ? { inbox: opts.inbox } : {}),
    ...(opts.ownerSessionId !== undefined ? { ownerSessionId: opts.ownerSessionId } : {}),
    ...(fireLock ? { fireLock } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(opts.onFired ? { onFired: opts.onFired } : {}),
  });

  const tools = buildSchedulerTools({
    store,
    runner: opts.runner,
    firingLock,
    ...(opts.ownerSessionId !== undefined ? { ownerSessionId: opts.ownerSessionId } : {}),
    ...(opts.inbox ? { inbox: opts.inbox } : {}),
  });

  const plugin = definePlugin({
    name: '@moxxy/plugin-scheduler',
    version: '0.0.0',
    tools,
    hooks: {
      onInit: async () => {
        if (opts.skills) {
          try {
            await syncSkillSchedules(opts.skills, store);
          } catch (err) {
            opts.logger?.warn?.('scheduler: initial skill sync failed', {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        poller.start();
      },
      onShutdown: async () => {
        await poller.stop();
      },
      // Re-sync skill-driven schedules whenever a skill_created event
      // lands — covers the "the model just synthesized a new skill
      // with a schedule" case for an immediate response. Skill edits and
      // deletes are reconciled by the poller's per-tick re-sync (it is
      // primed with `opts.skills`).
      onEvent: async (event) => {
        if (event.type !== 'skill_created') return;
        if (!opts.skills) return;
        try {
          await syncSkillSchedules(opts.skills, store);
        } catch (err) {
          opts.logger?.warn?.('scheduler: skill sync after skill_created failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  });

  return { plugin, store, poller };
}
