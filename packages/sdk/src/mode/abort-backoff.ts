/**
 * Shared retry primitives for loop strategies (mode-default / mode-goal).
 *
 * Both modes back off between retryable provider failures with an identical
 * exponential schedule and an abort-aware sleep. The logic was duplicated in
 * each mode's loop; these are the single source of truth they now import.
 */

/**
 * Sleep `ms` milliseconds, settling early if `signal` aborts. Rejects with the
 * signal's abort reason (an `AbortError`-style `DOMException` when none) on
 * abort so a back-off never silently outlives a cancelled turn, and crucially
 * NEVER leaks the abort listener or the timer in any settle path (resolve,
 * reject, or already-aborted) — a leaked listener on a long-lived signal
 * accumulates across a turn's many retries.
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    if (signal) {
      onAbort = (): void => {
        clearTimeout(timer);
        reject(abortReason(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function abortReason(signal: AbortSignal): unknown {
  // Prefer the caller-supplied reason; fall back to a standard AbortError.
  const reason = (signal as { reason?: unknown }).reason;
  if (reason !== undefined) return reason;
  return new DOMException('The operation was aborted', 'AbortError');
}

/**
 * Exponential back-off for a 1-based retry `attempt`: `baseMs * 2^(attempt-1)`,
 * clamped to `[baseMs, maxMs]` (default cap 30_000ms). `attempt <= 1` yields
 * `baseMs`. Matches the schedule both modes used before extraction.
 */
export function nextBackoffMs(attempt: number, baseMs: number, maxMs = 30_000): number {
  const exp = Math.max(0, Math.floor(attempt) - 1);
  return Math.min(maxMs, baseMs * 2 ** exp);
}
