/**
 * Per-instance write mutex: a promise chain that serializes async mutators so
 * two overlapping read-modify-write cycles can't both read the same snapshot
 * and clobber each other.
 *
 * The single home for the framework's "serialize file-state mutators"
 * invariant. Stores (vault, memory, permissions, scheduler, webhooks, …) hold
 * one `Mutex` instance and run every mutation through {@link Mutex.run}.
 */
export interface Mutex {
  /** Run `fn` after all previously-queued runs settle. */
  run<T>(fn: () => Promise<T> | T): Promise<T>;
}

export function createMutex(): Mutex {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T> | T): Promise<T> {
      // `.then(fn, fn)` runs `fn` whether the previous run resolved or
      // rejected, so one failed mutation doesn't deadlock the queue.
      const next = chain.then(fn as () => T, fn as () => T);
      // Keep the chain alive across rejections — never let a rejected link
      // permanently poison the lock.
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}
