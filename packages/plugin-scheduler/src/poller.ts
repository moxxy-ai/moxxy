import type { SkillRegistry } from '@moxxy/sdk';
import { nextFireTime } from './cron.js';
import { runSchedule, type InboxOptions, type SchedulePromptRunner } from './runner.js';
import { syncSkillSchedules } from './skill-sync.js';
import type { ScheduleEntry, ScheduleStore } from './store.js';

/**
 * Decide whether a schedule is due *now*. A cron schedule is due iff
 * the most recent cron fire-time after `lastRunAt` (or `createdAt`) is
 * <= now. A one-shot schedule is due iff `runAt <= now`. Disabled
 * schedules are never due.
 */
export function isDue(entry: ScheduleEntry, now: number): boolean {
  if (!entry.enabled) return false;
  if (entry.runAt && !entry.cron) {
    return entry.runAt <= now;
  }
  if (!entry.cron) return false;
  const since = entry.lastRunAt ?? entry.createdAt;
  const next = nextFireTime(entry.cron, new Date(since), entry.timeZone);
  if (!next) return false;
  return next.getTime() <= now;
}

export interface SchedulerPollerOptions {
  readonly store: ScheduleStore;
  readonly runner: SchedulePromptRunner;
  /** Poll cadence in ms. Defaults to 30s. Minimum 5s. */
  readonly intervalMs?: number;
  /** Optional inbox-directory override (tests). */
  readonly inbox?: InboxOptions;
  /**
   * Optional skill registry. When set, each tick first reconciles
   * `source='skill'` rows against the registry (via `syncSkillSchedules`)
   * so a skill whose `schedule:` frontmatter was edited, dropped, or whose
   * file was deleted propagates without a restart. The reconcile is
   * idempotent (no store write when nothing changed), so it is cheap.
   */
  readonly skills?: SkillRegistry;
  /** Optional logger; `undefined` => silent. */
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Optional hook fired after each successful schedule run. The
   *  caller (TUI, channel, etc.) uses this to surface a notification
   *  or relay the output to another channel. */
  readonly onFired?: (entry: ScheduleEntry, outcome: { ok: boolean; text: string }) => void;
}

/**
 * Background poller. Single timer; on each tick walks the store and
 * fires every due schedule sequentially (so one slow prompt doesn't
 * spawn N concurrent provider calls). `start()` is idempotent; `stop()`
 * clears the timer + waits for any in-flight tick to settle.
 */
export class SchedulerPoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickPromise: Promise<void> = Promise.resolve();
  private readonly intervalMs: number;

  constructor(private readonly opts: SchedulerPollerOptions) {
    this.intervalMs = Math.max(5_000, opts.intervalMs ?? 30_000);
  }

  start(): void {
    if (this.timer) return;
    this.running = true;
    // Fire an immediate tick on start so a schedule whose nextFire was
    // missed during downtime catches up at boot (e.g. moxxy was off
    // when 9 AM hit; opening it at 9:05 should still trigger today's
    // run).
    this.tickPromise = this.tick();
    this.timer = setInterval(() => {
      // Queue the next tick onto the chain so two slow runs don't
      // overlap. setInterval guarantees the timer keeps firing; the
      // chain serializes execution.
      this.tickPromise = this.tickPromise.then(() => this.tick());
    }, this.intervalMs);
    // Don't keep the event loop alive just for the poller — once every
    // other handle settles, scheduler shouldn't block process exit.
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.tickPromise.catch(() => undefined);
  }

  /** Fire any due schedules right now, ignoring the timer cadence.
   *  Returns the number of schedules that ran. */
  async tickOnce(): Promise<number> {
    let count = 0;
    const original = this.opts.onFired;
    let wrapped: SchedulerPollerOptions['onFired'];
    if (original) {
      wrapped = (entry, outcome) => {
        count += 1;
        original(entry, outcome);
      };
    } else {
      wrapped = () => {
        count += 1;
      };
    }
    await this.tickWith(wrapped);
    return count;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    await this.tickWith(this.opts.onFired);
  }

  private async tickWith(onFired: SchedulerPollerOptions['onFired']): Promise<void> {
    const now = Date.now();
    // Reconcile skill-driven schedules first so edits/deletes to skill
    // frontmatter propagate every tick (not only on skill_created / boot).
    if (this.opts.skills) {
      try {
        await syncSkillSchedules(this.opts.skills, this.opts.store);
      } catch (err) {
        this.opts.logger?.warn?.('scheduler: skill sync during tick failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    let schedules: ReadonlyArray<ScheduleEntry>;
    try {
      schedules = await this.opts.store.list();
    } catch (err) {
      this.opts.logger?.error?.('scheduler: failed to read store', {
        err: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const entry of schedules) {
      if (!isDue(entry, now)) continue;
      try {
        const outcome = await runSchedule(entry, this.opts.runner, this.opts.store, this.opts.inbox);
        this.opts.logger?.info?.('scheduler: fired', {
          schedule: entry.name,
          ok: outcome.ok,
          inbox: outcome.inboxPath,
        });
        onFired?.(entry, { ok: outcome.ok, text: outcome.text });
      } catch (err) {
        this.opts.logger?.warn?.('scheduler: run failed', {
          schedule: entry.name,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
