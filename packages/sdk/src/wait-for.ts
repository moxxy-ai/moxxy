/**
 * Event-driven waiting: sleep until something says "look again", not on a
 * fixed poll interval. A waiter resumes the moment its job reports progress,
 * and a deadline only bounds the wait — it never means the job finished.
 */

/** Subscribes `wake` to a change signal; returns the unsubscribe. */
export type WakeSource = (wake: () => void) => () => void;

export type WaitOutcome<T> =
  | { readonly status: 'ready'; readonly value: T }
  /** The deadline passed while the job was still running. */
  | { readonly status: 'timeout' }
  | { readonly status: 'aborted' };

export interface WaitForOptions {
  /** Every signal after which `check` may give a different answer. */
  readonly wakeOn: ReadonlyArray<WakeSource>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Resolve once `check` returns a value (anything but `undefined`), re-checking
 * only when a wake source fires. Subscribes BEFORE the first check, so a job
 * that finishes between "read the status" and "start listening" is never
 * missed. Every listener and timer is released on any outcome.
 */
export function waitFor<T>(
  check: () => T | undefined,
  opts: WaitForOptions,
): Promise<WaitOutcome<T>> {
  return new Promise((resolve, reject) => {
    const { signal, timeoutMs } = opts;
    if (signal?.aborted) {
      resolve({ status: 'aborted' });
      return;
    }
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribes: Array<() => void> = [];

    const finish = (outcome: WaitOutcome<T> | Error): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      for (const unsubscribe of unsubscribes) unsubscribe();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    const onAbort = (): void => finish({ status: 'aborted' });
    const recheck = (): void => {
      if (settled) return;
      let value: T | undefined;
      try {
        value = check();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (value !== undefined) finish({ status: 'ready', value });
    };

    for (const source of opts.wakeOn) unsubscribes.push(source(recheck));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs !== undefined) timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
    recheck();
  });
}

/** A wake source that fires once after `ms` — for conditions that turn on time
 *  itself (a boot deadline), so they are re-checked exactly when they can flip. */
export function wakeAfter(ms: number): WakeSource {
  return (wake) => {
    const timer = setTimeout(wake, ms);
    return () => clearTimeout(timer);
  };
}
