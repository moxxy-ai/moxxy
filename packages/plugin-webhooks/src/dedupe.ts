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

  constructor(opts: { maxEntries?: number; ttlMs?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? 4096;
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  }

  /** Returns true if this is a new key (now recorded); false if duplicate. */
  check(triggerId: string, key: string): boolean {
    this.evictExpired();
    const k = `${triggerId}:${key}`;
    if (this.seen.has(k)) {
      // Refresh recency by re-inserting at the tail.
      this.seen.delete(k);
      this.seen.set(k, Date.now());
      return false;
    }
    this.seen.set(k, Date.now());
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
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [k, ts] of this.seen) {
      if (ts >= cutoff) break;
      this.seen.delete(k);
    }
  }
}
