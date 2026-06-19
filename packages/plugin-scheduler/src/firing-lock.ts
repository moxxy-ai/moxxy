/**
 * Per-schedule firing mutex.
 *
 * Two code paths can fire the SAME schedule concurrently:
 *   - the background poller tick (`SchedulerPoller.tickWith → runSchedule`), and
 *   - the manual `schedule_run_now` tool (`tools.ts → runSchedule`).
 *
 * Without coordination they can both observe the same due entry, both call
 * `runSchedule`, both run the prompt (real side effects: Telegram sends,
 * provider calls), both write the inbox, and race on `store.update` —
 * last-writer-wins clobbering `lastRunAt`. The poller's in-memory `firedKeys`
 * dedup only guards the poller against itself; it does not see the tool path.
 *
 * This lock serializes fires PER ENTRY id (different ids still run
 * concurrently, so one slow schedule never blocks an unrelated one). Sharing a
 * single instance between the poller and the tools — wired in
 * `buildSchedulerPlugin` — makes a manual run and a background run of the same
 * schedule mutually exclusive.
 */
export class FiringLock {
  private readonly chains = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` while holding the lock for `id`. Calls for the same id queue
   * behind each other; calls for distinct ids proceed in parallel. The lock is
   * always released (even if `fn` throws), and the per-id chain entry is pruned
   * once it drains so the map can't grow unbounded across many one-shot ids.
   */
  async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    // Swallow the predecessor's rejection so one failed fire doesn't reject
    // every queued fire behind it; each `fn` owns its own error handling.
    const gate = prev.then(
      () => fn(),
      () => fn(),
    );
    this.chains.set(id, gate);
    try {
      return await gate;
    } finally {
      // Prune only if no later call has extended the chain in the meantime —
      // otherwise we'd drop a still-pending tail and lose serialization.
      if (this.chains.get(id) === gate) this.chains.delete(id);
    }
  }
}
