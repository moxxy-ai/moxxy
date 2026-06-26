/**
 * In-memory LRU for Slack event idempotency. Slack retries deliveries (with an
 * `X-Slack-Retry-Num` header) and the same `event_id` may arrive more than
 * once, so we dedupe by `event_id` for a bounded window. Copied from
 * `@moxxy/plugin-webhooks/src/dedupe.ts` (the at-least-once delivery pattern is
 * identical) — keyed by a single namespace here since one Slack app maps to one
 * channel.
 *
 * Not persistent — a restart resets the cache, which is acceptable: worst case
 * the agent processes one event twice immediately after restart, which is rare
 * and self-limiting.
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
    this.sweepEveryMs = opts.sweepEveryMs ?? Math.min(this.ttlMs, 15_000);
  }

  /** Returns true if this is a new key (now recorded); false if a duplicate. */
  check(key: string): boolean {
    const now = Date.now();
    this.evictExpired(now);
    const seenAt = this.seen.get(key);
    // Honor the TTL on the looked-up key directly so amortizing the full sweep
    // never makes an already-expired key read as a live duplicate.
    if (seenAt !== undefined && seenAt >= now - this.ttlMs) {
      this.seen.delete(key);
      this.seen.set(key, now);
      return false;
    }
    if (seenAt !== undefined) this.seen.delete(key);
    this.seen.set(key, now);
    if (this.seen.size > this.maxEntries) {
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
