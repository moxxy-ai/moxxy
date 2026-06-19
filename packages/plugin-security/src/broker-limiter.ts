/**
 * Shared in-flight concurrency limiter for broker ops.
 *
 * A `broker-request` line is tiny for an isolated child/worker to send, but
 * each one fans out into a real, heavyweight parent-side handle: an open fd
 * (`fs.*`), a socket (`fetch`), or a spawned exec child (`exec`). The byte
 * caps on the isolators' transports bound what the child can *send*, but they
 * do NOT bound the work the PARENT (the trust boundary) holds: a hostile child
 * can stream thousands of cheap request lines and drive the host to exhaust
 * fds / sockets / PIDs — a resource-exhaustion attack the byte cap can't catch.
 *
 * This caps how many brokered ops the parent runs concurrently per child.
 * Requests beyond the ceiling are rejected back to the child (its `rpc` promise
 * rejects) rather than queued or crashing the parent — degrade, never crash.
 *
 * Single-sourced here because BOTH out-of-process isolators (worker +
 * subprocess) need the identical bound; a divergence would mean a hostile
 * child gets a weaker limit depending on which isolator the host picked.
 */

/**
 * Default ceiling on concurrent parent-side brokered ops per isolated child.
 * Comfortably above any legitimate handler's parallelism while still bounding a
 * flood. Both isolators expose this as a tunable option.
 */
export const DEFAULT_MAX_INFLIGHT_BROKER_OPS = 128;

/**
 * Tiny counting limiter. Not a queue: `tryAcquire` returns `false` when the
 * ceiling is already in use so the caller can reject the op back to the child
 * instead of buffering unbounded pending work (which would just move the
 * exhaustion from handles to memory).
 */
export class BrokerOpLimiter {
  readonly limit: number;
  #inflight = 0;

  /**
   * @param max Ceiling on concurrent ops. Coerced to a finite integer >= 1
   *   (a NaN / <1 value would otherwise disable the guard or wedge every op),
   *   defaulting to {@link DEFAULT_MAX_INFLIGHT_BROKER_OPS}.
   */
  constructor(max?: number) {
    const n = Math.floor(Number(max ?? DEFAULT_MAX_INFLIGHT_BROKER_OPS));
    this.limit = Number.isFinite(n) ? Math.max(1, n) : DEFAULT_MAX_INFLIGHT_BROKER_OPS;
  }

  /** Current number of ops counted as in-flight. */
  get inflight(): number {
    return this.#inflight;
  }

  /**
   * Reserve a slot. Returns `true` (slot taken — the caller MUST later call
   * {@link release} exactly once) or `false` (at capacity — reject the op).
   */
  tryAcquire(): boolean {
    if (this.#inflight >= this.limit) return false;
    this.#inflight++;
    return true;
  }

  /** Free a slot previously taken by {@link tryAcquire}. Never goes negative. */
  release(): void {
    if (this.#inflight > 0) this.#inflight--;
  }
}
