/**
 * Per-trigger token-bucket rate limiter for the webhook listener.
 *
 * The POST surface does real work per request (HMAC verify, body parse, regex
 * matching) BEFORE it ACKs, so even a verification-protected endpoint can be
 * flooded into pinning the event loop. A captured valid signature replayed in a
 * tight loop, or simply an attacker hammering a `verification:'none'` trigger,
 * is enough. This caps the rate at which any single trigger is allowed to do
 * that work — admission is decided with O(1), allocation-free arithmetic, well
 * before the expensive verify/parse path.
 *
 * Design notes:
 *   - One bucket per trigger id. Buckets are created lazily and evicted when
 *     idle, with a hard cap on the number tracked so a parade of distinct (but
 *     real) trigger ids — or churn from create/delete — can never grow the map
 *     without bound.
 *   - Refill is computed lazily from elapsed wall-clock time; there are NO
 *     timers, so the limiter holds no handles and needs no teardown.
 *   - Tokens are clamped to [0, capacity]; a long-idle bucket refills to full,
 *     never beyond, so idle time can't bank unlimited burst.
 */

export interface RateLimitOptions {
  /** Sustained requests/second admitted per trigger (the refill rate). */
  readonly ratePerSec?: number;
  /** Max burst (bucket capacity). Defaults to one second's worth, min 1. */
  readonly burst?: number;
  /** Max distinct triggers tracked at once. Oldest-touched is dropped on overflow. */
  readonly maxBuckets?: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class RateLimiter {
  private readonly ratePerSec: number;
  private readonly capacity: number;
  private readonly maxBuckets: number;
  private readonly now: () => number;
  /** Insertion/access-ordered so the LRU overflow drop is the head entry. */
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts: RateLimitOptions = {}) {
    // Guard against hostile/degenerate config: a non-finite or non-positive
    // rate/burst would otherwise disable limiting or NaN-poison the math.
    const rate = opts.ratePerSec;
    this.ratePerSec = Number.isFinite(rate) && (rate as number) > 0 ? (rate as number) : 20;
    const burst = opts.burst;
    this.capacity =
      Number.isFinite(burst) && (burst as number) >= 1
        ? Math.floor(burst as number)
        : Math.max(1, Math.ceil(this.ratePerSec));
    const max = opts.maxBuckets;
    this.maxBuckets = Number.isFinite(max) && (max as number) >= 1 ? Math.floor(max as number) : 1024;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Admit one request for `key`, consuming a token. Returns true when allowed,
   * false when the bucket is empty (caller should reject, typically 429).
   */
  tryAcquire(key: string): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (bucket) {
      // Refresh LRU recency: delete + re-set moves it to the tail.
      this.buckets.delete(key);
    } else {
      bucket = { tokens: this.capacity, lastRefillMs: now };
      // Evict the least-recently-touched bucket(s) before inserting a new one so
      // the map can never exceed maxBuckets, even under a flood of distinct keys.
      while (this.buckets.size >= this.maxBuckets) {
        const oldest = this.buckets.keys().next();
        if (oldest.done) break;
        this.buckets.delete(oldest.value);
      }
    }

    // Lazily refill from elapsed time, clamped to capacity.
    const elapsedMs = now - bucket.lastRefillMs;
    if (elapsedMs > 0) {
      const refill = (elapsedMs / 1000) * this.ratePerSec;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + refill);
      bucket.lastRefillMs = now;
    }

    let allowed: boolean;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      allowed = true;
    } else {
      allowed = false;
    }
    this.buckets.set(key, bucket);
    return allowed;
  }

  /** Number of buckets currently tracked (for tests/introspection). */
  size(): number {
    return this.buckets.size;
  }

  clear(): void {
    this.buckets.clear();
  }
}
