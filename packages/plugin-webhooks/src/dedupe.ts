/**
 * In-memory LRU for delivery idempotency. Webhook providers retry, so a
 * single delivery id (X-GitHub-Delivery, Stripe `evt_*`, ...) may arrive
 * multiple times. We dedupe by `<triggerId>:<key>` for a bounded window.
 *
 * Not persistent — a restart resets the cache, which is acceptable:
 * worst case the agent processes the same event twice immediately
 * after restart, which is rare and self-limiting.
 */
export class DeliveryDedupeCache {
  private readonly seen = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  /** Sweep TTL-expired entries at most once per this interval. The LRU overflow
   *  cap already bounds memory, so the TTL sweep need not run on every check —
   *  amortizing it keeps the pre-ACK path O(1) under retry storms. */
  private readonly sweepEveryMs: number;
  private lastSweepMs = -Infinity;

  constructor(opts: { maxEntries?: number; ttlMs?: number; sweepEveryMs?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? 4096;
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
    // Sweep at most a few times per minute by default; small enough that the
    // TTL semantics stay effectively unchanged, large enough to skip the scan
    // on a burst. Overridable (tests use a tiny value for determinism).
    this.sweepEveryMs = opts.sweepEveryMs ?? Math.min(this.ttlMs, 15_000);
  }

  /** Returns true if this is a new key (now recorded); false if duplicate. */
  check(triggerId: string, key: string): boolean {
    const now = Date.now();
    this.evictExpired(now);
    const k = `${triggerId}:${key}`;
    const seenAt = this.seen.get(k);
    // Honor the TTL on the looked-up key directly so amortizing the full sweep
    // never makes an already-expired key read as a live duplicate: a sweep that
    // hasn't run yet must not keep re-firing the same delivery as "seen".
    if (seenAt !== undefined && seenAt >= now - this.ttlMs) {
      // Refresh recency by re-inserting at the tail.
      this.seen.delete(k);
      this.seen.set(k, now);
      return false;
    }
    if (seenAt !== undefined) this.seen.delete(k);
    this.seen.set(k, now);
    if (this.seen.size > this.maxEntries) {
      // Map preserves insertion order; drop the oldest.
      const first = this.seen.keys().next();
      if (!first.done) this.seen.delete(first.value);
    }
    return true;
  }

  size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
    this.lastSweepMs = -Infinity;
  }

  /**
   * Drop TTL-expired entries from the (insertion-ordered) head. Amortized: runs
   * at most once per {@link sweepEveryMs}; the LRU overflow cap bounds memory
   * between sweeps, and {@link check} TTL-checks the specific key it reads so
   * correctness never depends on a sweep having happened.
   */
  private evictExpired(now: number): void {
    if (now - this.lastSweepMs < this.sweepEveryMs) return;
    this.lastSweepMs = now;
    const cutoff = now - this.ttlMs;
    for (const [k, ts] of this.seen) {
      if (ts >= cutoff) break;
      this.seen.delete(k);
    }
  }
}
