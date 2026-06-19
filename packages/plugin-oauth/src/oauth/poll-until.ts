/**
 * Shared polling primitive for OAuth-style "ask again later" modes. Handles
 * the gnarly bits — deadline math, abort-responsive sleep, interval bumps
 * for `slow_down`-style backpressure — so each device-flow dialect only has
 * to encode its HTTP shape, not the timing harness.
 *
 * Consumed by both `runDeviceCodeFlow` (RFC 8628) and the Codex device flow
 * (non-standard OpenAI endpoints). The polling fn returns `{done}` to finish
 * or `{pending}` to keep going, and may mutate `state.intervalMs` mid-flight
 * to apply a `slow_down` bump.
 */

import { MoxxyError } from '@moxxy/sdk';

export interface PollState {
  /** Mutable so the polling fn can bump on `slow_down`. */
  intervalMs: number;
  /**
   * The flow's abort signal, threaded through so a polling fn can pass it
   * into its in-flight fetch and cancel a hung request — not just the
   * inter-poll sleep. Undefined when the caller supplied no signal.
   */
  readonly signal?: AbortSignal;
}

export type PollOutcome<T> = { done: T } | { pending: true };

export interface PollUntilOpts {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /**
   * Wait BEFORE the first call. RFC 8628 says clients SHOULD wait `interval`
   * before the first poll; some flows (e.g. Codex) poll immediately. Default
   * true to match the more conservative RFC behavior.
   */
  readonly leadingWait?: boolean;
  /** Used in timeout / abort error messages. */
  readonly label?: string;
}

export async function pollUntil<T>(
  fn: (state: PollState) => Promise<PollOutcome<T>>,
  opts: PollUntilOpts,
): Promise<T> {
  const state: PollState = {
    intervalMs: opts.intervalMs,
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  const leadingWait = opts.leadingWait ?? true;
  const deadline = Date.now() + opts.timeoutMs;
  const label = opts.label ?? 'poll';

  let first = true;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw abortedError(label);
    if (!first || leadingWait) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(state.intervalMs, remaining), opts.signal, label);
    }
    first = false;
    const result = await fn(state);
    if ('done' in result) return result.done;
  }
  throw new MoxxyError({
    code: 'OAUTH_FLOW_TIMEOUT',
    message: `${label} timed out waiting for completion`,
    context: { label, timeout_ms: opts.timeoutMs },
  });
}

function abortedError(label: string): MoxxyError {
  return new MoxxyError({
    code: 'NETWORK_ABORTED',
    message: `${label} aborted`,
    context: { label },
  });
}

function sleep(ms: number, signal: AbortSignal | undefined, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortedError(label));
    // `{ once: true }` only auto-removes a listener that actually FIRES; on the
    // timer-resolved path it would linger. pollUntil calls sleep() once per
    // poll cycle against the SAME long-lived signal, so an unremoved listener
    // accumulates one-per-iteration (~120 over a 10-min device flow), tripping
    // MaxListenersExceededWarning and retaining each closure. Remove on BOTH
    // exits so it's exactly one add / one remove per sleep.
    const onAbort = (): void => {
      clearTimeout(t);
      reject(abortedError(label));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
