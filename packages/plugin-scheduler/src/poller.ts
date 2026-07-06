import type { CrossProcessFireLock, SkillRegistry } from '@moxxy/sdk';
import { nextFireTime } from './cron.js';
import type { FiringLock } from './firing-lock.js';
import { runSchedule, type InboxOptions, type SchedulePromptRunner } from './runner.js';
import { syncSkillSchedules } from './skill-sync.js';
import type { ScheduleEntry, ScheduleStore } from './store.js';

/**
 * Decide whether a schedule is due *now*. A cron schedule is due iff
 * the most recent cron fire-time after `lastRunAt` (or `createdAt`) is
 * <= now. A one-shot schedule is due iff `runAt <= now`. Disabled
 * schedules are never due.
 */
/**
 * The instant a cron schedule's next fire is computed *from*: its last run,
 * or — if it has never run — its creation time. Anchoring at `createdAt`
 * (not `now`) is what lets a schedule created during downtime catch up: the
 * first fire that fell in the gap is still in the past relative to the
 * baseline, so it's due immediately. Both `isDue` (the firing decision) and
 * `describeEntry` (the displayed next-fire) MUST use this same baseline or
 * the UI's next-fire contradicts when the poller actually fires.
 */
export function cronBaseline(entry: ScheduleEntry): number {
  return entry.lastRunAt ?? entry.createdAt;
}

/**
 * Memoized next-fire results, keyed by the only inputs that determine the
 * answer: cron expression + baseline instant + timeZone. The walk is pure, so
 * once computed for a (cron, baseline, zone) triple it never changes. This is
 * what keeps steady-state ticks O(1): an explicit-IANA-zone cron (whose walk
 * advances minute-by-minute and can cost a full 366-day window for a sparse or
 * structurally-impossible expression) is otherwise re-walked on EVERY 30s tick
 * — and an impossible one, which returns null and never advances its baseline,
 * re-walks the whole window forever. The baseline only changes when the entry
 * actually fires (lastRunAt advances), so the recompute happens exactly once
 * per fire, not once per tick.
 */
const nextFireCache = new Map<string, number | null>();
const NEXT_FIRE_CACHE_MAX = 4_096;

export function nextCronFire(entry: ScheduleEntry): Date | null {
  if (!entry.cron) return null;
  const baseline = cronBaseline(entry);
  // `|` separates the three key parts: none of cron / a numeric baseline / an
  // IANA timeZone can contain it, so distinct triples never collide into one
  // key (and it keeps this source file plain text — the prior separator was a
  // literal NUL, which made git treat the whole file as binary).
  const key = `${entry.cron}|${baseline}|${entry.timeZone ?? ''}`;
  const cached = nextFireCache.get(key);
  if (cached !== undefined) return cached === null ? null : new Date(cached);
  const next = nextFireTime(entry.cron, new Date(baseline), entry.timeZone);
  // Bound the cache: drop the oldest insertions wholesale once it grows past
  // the cap so a long-lived process with many distinct schedules/baselines
  // can't leak the map unbounded.
  if (nextFireCache.size >= NEXT_FIRE_CACHE_MAX) nextFireCache.clear();
  nextFireCache.set(key, next ? next.getTime() : null);
  return next;
}

export function isDue(entry: ScheduleEntry, now: number): boolean {
  if (!entry.enabled) return false;
  if (entry.runAt && !entry.cron) {
    return entry.runAt <= now;
  }
  if (!entry.cron) return false;
  const next = nextCronFire(entry);
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
  /**
   * Optional per-entry firing mutex shared with the `schedule_run_now` tool.
   * When set, each fire runs under `firingLock.run(entry.id, …)` so a manual
   * run and a background tick can never fire (and race on `store.update` for)
   * the SAME schedule concurrently. `buildSchedulerPlugin` wires one shared
   * instance into both the poller and the tools.
   */
  readonly firingLock?: FiringLock;
  /**
   * This runner process's session identity (its `MOXXY_SESSION_ID`), or
   * undefined for a single-process CLI/TUI with no sticky id. When set, a
   * schedule whose `ownerSessionId` names a DIFFERENT session is skipped — its
   * owning runner will fire it — so a schedule created in one workspace's chat
   * fires on THAT workspace, not whichever of the concurrently-running runners
   * happens to tick first.
   */
  readonly ownerSessionId?: string;
  /**
   * Cross-process "fire exactly once" lock. Owner-less schedules (skill- and
   * workflow-mirrored rows, or rows created without a `MOXXY_SESSION_ID`) exist
   * identically in every runner's view of the shared store, so every poller
   * would otherwise fire them — N times for N runners. Each such fire is gated
   * on claiming this lock for the entry's exact fire instant, so exactly one
   * runner fires it. Owner-bound schedules skip the lock (only their one owner
   * passes the gate above, so there's nothing to race). Optional: without it,
   * owner-less schedules fall back to the per-process guard only.
   */
  readonly fireLock?: CrossProcessFireLock;
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
  /**
   * In-memory guard against re-firing the same computed fire instant. Keyed by
   * `${entry.id}@${fireInstant}`. The persisted `lastRunAt`/`enabled:false`
   * patch is the durable dedup, but if that write throws (disk full, EROFS) the
   * patch never lands and a one-shot stays due / a cron's baseline never
   * advances — so the SAME instant would re-fire (and re-run real side effects:
   * Telegram sends, etc.) on every subsequent tick. This guard makes a fire
   * idempotent for the process lifetime regardless of the persisted write.
   */
  private readonly firedKeys = new Set<string>();
  private static readonly FIRED_KEYS_MAX = 8_192;

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
    this.tickPromise = this.tick().catch(() => undefined);
    this.timer = setInterval(() => {
      // Queue the next tick onto the chain so two slow runs don't
      // overlap. setInterval guarantees the timer keeps firing; the
      // chain serializes execution. The `.catch` keeps one rejected tick
      // from poisoning the chain (every subsequent `.then` would otherwise
      // be skipped, silently freezing all future ticks).
      this.tickPromise = this.tickPromise.then(() => this.tick()).catch(() => undefined);
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
   *  Returns the number of due schedules that were attempted — counted at the
   *  attempt point, so a schedule that fired but failed mid-run (e.g. a
   *  store.update throw) is still counted, unlike piggy-backing on onFired
   *  (which only fires on a clean run). */
  async tickOnce(): Promise<number> {
    // Route through the same serialization chain as the background timer so a
    // manual tick can't run concurrently with an in-flight background tick and
    // double-fire the same due entry (both calling runSchedule → both running
    // the prompt → both racing on store.update). We append our work to the
    // chain, then await our specific result.
    let result = 0;
    this.tickPromise = this.tickPromise.then(async () => {
      result = await this.tickWith(this.opts.onFired);
    });
    await this.tickPromise.catch(() => undefined);
    return result;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    await this.tickWith(this.opts.onFired);
  }

  private async tickWith(onFired: SchedulerPollerOptions['onFired']): Promise<number> {
    const now = Date.now();
    // Reconcile skill-driven schedules first so edits/deletes to skill
    // frontmatter propagate every tick (not only on skill_created / boot).
    if (this.opts.skills) {
      try {
        await syncSkillSchedules(this.opts.skills, this.opts.store);
      } catch (err) {
        const log = this.opts.logger;
        if (log?.warn) {
          log.warn('scheduler: skill sync during tick failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    let schedules: ReadonlyArray<ScheduleEntry>;
    try {
      schedules = await this.opts.store.list();
    } catch (err) {
      const log = this.opts.logger;
      if (log?.error) {
        log.error('scheduler: failed to read store', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
      return 0;
    }
    let attempted = 0;
    for (const entry of schedules) {
      // A malformed row (e.g. a legacy bad timeZone) must never abort the whole
      // tick for the rows after it. `isDue` is defensive now, but keep the guard
      // so any future throw in the firing decision is contained per-entry.
      let due: boolean;
      try {
        due = isDue(entry, now);
      } catch (err) {
        const log = this.opts.logger;
        if (log?.warn) {
          log.warn('scheduler: isDue failed; skipping entry', {
            schedule: entry.name,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }
      if (!due) continue;

      // Owner gate: a schedule created inside a session belongs to that runner.
      // With several runners polling the same shared store, only the owner fires
      // it — so the result lands in the chat that asked for it, and the other
      // runners don't double-fire it. A row with no owner (skill/workflow
      // mirror, or created without MOXXY_SESSION_ID) is ambient and falls
      // through to the cross-process claim below. When THIS poller has no
      // identity (single-process CLI), it owns everything (the claim still keeps
      // a rare second such process from double-firing).
      if (
        entry.ownerSessionId !== undefined &&
        this.opts.ownerSessionId !== undefined &&
        entry.ownerSessionId !== this.opts.ownerSessionId
      ) {
        continue;
      }
      const ownedByThisRunner =
        entry.ownerSessionId !== undefined && entry.ownerSessionId === this.opts.ownerSessionId;

      // Idempotency guard: skip an entry whose exact fire instant was already
      // attempted this process-lifetime. Without this, a one-shot whose
      // disable-write threw (or a cron whose lastRunAt-write threw) stays due
      // and re-fires its real side effects on every tick.
      const fireKey = this.fireKeyFor(entry);
      if (fireKey !== null && this.firedKeys.has(fireKey)) continue;

      // Cross-process exactly-once: an owner-less schedule is identical in every
      // runner's store view, so without coordination every poller fires it.
      // Claim its exact fire instant across processes; only the winner proceeds.
      // Owner-bound rows skip this — exactly one runner reaches here for them.
      if (!ownedByThisRunner && fireKey !== null && this.opts.fireLock) {
        let claimed: boolean;
        try {
          claimed = await this.opts.fireLock.claim(fireKey, now);
        } catch (err) {
          // A lock-dir error must not fire blind (that risks the N-times
          // multi-fire this guards). Skip this tick; the durable lastRunAt and
          // the next tick recover once the fs issue clears.
          const log = this.opts.logger;
          if (log?.warn) {
            log.warn('scheduler: fire-once claim failed; skipping', {
              schedule: entry.name,
              err: err instanceof Error ? err.message : String(err),
            });
          }
          continue;
        }
        if (!claimed) {
          // Another runner is firing this instant. Remember it so we don't
          // re-attempt the claim every tick until lastRunAt propagates.
          this.rememberFired(fireKey);
          continue;
        }
      }

      // Count the attempt BEFORE running so a schedule that genuinely fired
      // but failed mid-run (e.g. store.update throws) is still reflected in
      // the returned count — the figure means "due-and-attempted", not "ran
      // cleanly".
      attempted += 1;
      if (fireKey !== null) this.rememberFired(fireKey);
      try {
        // Route the fire through the shared per-id lock (when wired) so a
        // concurrent `schedule_run_now` for the same entry serializes behind
        // (or ahead of) this one instead of double-firing + racing store.update.
        const outcome = await (this.opts.firingLock
          ? this.opts.firingLock.run(entry.id, () =>
              runSchedule(entry, this.opts.runner, this.opts.store, this.opts.inbox),
            )
          : runSchedule(entry, this.opts.runner, this.opts.store, this.opts.inbox));
        const log = this.opts.logger;
        if (log?.info) {
          log.info('scheduler: fired', {
            schedule: entry.name,
            ok: outcome.ok,
            inbox: outcome.inboxPath,
          });
        }
        onFired?.(entry, { ok: outcome.ok, text: outcome.text });
      } catch (err) {
        // A throw here is typically the post-run persist failing (the prompt
        // itself is caught inside runSchedule). That's a durability failure —
        // the entry's lastRunAt/disabled state did not advance — so surface it
        // as an error, not a warning. The firedKeys guard above stops the
        // re-fire it would otherwise cause.
        const log = this.opts.logger;
        if (log?.error) {
          log.error('scheduler: run failed', {
            schedule: entry.name,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    // Reap expired cross-process markers so the lock dir can't grow without
    // bound. Best-effort and bounded (a readdir of a small dir); never let it
    // fail a tick.
    if (this.opts.fireLock) {
      await this.opts.fireLock.sweep(now).catch(() => undefined);
    }
    return attempted;
  }

  /**
   * Stable key for the specific fire instant an entry is due for, used to
   * dedup re-fires when the post-run persisted write fails. `null` when no
   * concrete instant can be derived (the entry then relies solely on the
   * persisted state, as before).
   */
  private fireKeyFor(entry: ScheduleEntry): string | null {
    if (entry.runAt && !entry.cron) return `${entry.id}@${entry.runAt}`;
    if (entry.cron) {
      const next = nextCronFire(entry);
      if (next) return `${entry.id}@${next.getTime()}`;
    }
    return null;
  }

  private rememberFired(key: string): void {
    // Bound the set: a long-lived process firing many distinct instants would
    // otherwise grow it unbounded. Wholesale clear past the cap — losing the
    // dedup memory only re-exposes the (rare) failed-write re-fire window.
    if (this.firedKeys.size >= SchedulerPoller.FIRED_KEYS_MAX) this.firedKeys.clear();
    this.firedKeys.add(key);
  }
}
