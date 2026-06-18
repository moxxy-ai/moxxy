import type { Isolator } from '@moxxy/sdk';
import { checkAllCaps } from '../cap-check.js';

/**
 * In-process isolator with capability validation + wall-clock timeout.
 *
 * What it enforces:
 *   - declared `fs` paths — input strings that look like paths must fall
 *     under `fs.read` / `fs.write` globs, else the call is denied.
 *   - declared `net` hosts — same idea for URLs in the input.
 *   - declared `timeMs` — Promise-races the handler against a timer and,
 *     on overrun, ABORTS the signal the handler observes (a derived signal
 *     wired through the call) before rejecting, so signal-aware fs/net/exec
 *     work is actually cancelled rather than left running in the background.
 *
 * What it does NOT enforce (by design — this isolator runs in-process):
 *   - the handler doing fs/net it didn't declare in its input.
 *   - real memory ceilings.
 *   - subprocess spawning.
 *
 * Stronger isolators (`worker`, `subprocess`, `wasm`, `docker`) will
 * cover those gaps via boundary enforcement; they implement the same
 * `Isolator` interface so the security plugin's hook routes to them
 * with no further change.
 */
export const inprocIsolator: Isolator = {
  name: 'inproc',
  strength: 'inproc',
  async run(call, handler, caps, signal) {
    const verdict = checkAllCaps(call.input, caps, call.cwd);
    if (!verdict.ok) {
      throw new Error(`[security:inproc] ${verdict.reason}`);
    }

    if (caps.timeMs === undefined) return handler(call.input);

    // Derive an internal controller. On timeout we abort THIS controller — the
    // handler is bound (in `wrapWithIsolator`) to observe it via `ctx.signal`,
    // so the abort actually cancels the handler's in-flight signal-aware
    // fs/net/exec work instead of leaking past the budget while we only reject
    // our own returned promise. The `signal` arg passed in IS this controller's
    // signal when called through `wrapWithIsolator`; we also forward any
    // external abort onto it.
    const internal = new AbortController();
    const handlerSignal = internal.signal;
    const onExternalAbort = (): void => {
      if (!internal.signal.aborted) {
        internal.abort(signal.reason ?? new Error(`[security:inproc] tool '${call.toolName}' aborted`));
      }
    };

    return new Promise((resolve, reject) => {
      // Already-aborted: events don't replay, check explicitly first.
      if (signal.aborted) {
        onExternalAbort();
        reject(new Error(`[security:inproc] tool '${call.toolName}' aborted`));
        return;
      }
      const timer = setTimeout(() => {
        // Abort the handler-facing signal BEFORE rejecting so runaway work is
        // cancelled at the budget instead of leaking past it.
        const budgetErr = new Error(
          `[security:inproc] tool '${call.toolName}' exceeded ${caps.timeMs}ms budget`,
        );
        internal.abort(budgetErr);
        reject(budgetErr);
      }, caps.timeMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        onExternalAbort();
        reject(new Error(`[security:inproc] tool '${call.toolName}' aborted`));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      runHandler(handler, call.input, handlerSignal).then(
        (out) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(out);
        },
        (err) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  },
};

/**
 * Invoke the bound handler, threading the timeout/abort-aware signal to it via
 * the optional second argument. `wrapWithIsolator` passes a `(input, signal)`
 * shaped bound handler; older callers that pass a `(input)` handler still work
 * (the extra arg is ignored) — the derived signal then just can't reach those
 * handlers, which is the pre-fix behavior, not a regression.
 */
function runHandler(
  handler: (input: unknown) => Promise<unknown>,
  input: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  return Promise.resolve(
    (handler as (input: unknown, signal?: AbortSignal) => Promise<unknown>)(input, signal),
  );
}
