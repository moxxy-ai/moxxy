import type { Isolator } from '@moxxy/sdk';
import { checkAllCaps } from '../cap-check.js';

/**
 * In-process isolator with capability validation + wall-clock timeout.
 *
 * What it enforces:
 *   - declared `fs` paths — input strings that look like paths must fall
 *     under `fs.read` / `fs.write` globs, else the call is denied.
 *   - declared `net` hosts — same idea for URLs in the input.
 *   - declared `timeMs` — Promise-races the handler against a timer and
 *     aborts via the propagated signal when the budget is exceeded.
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

    return new Promise((resolve, reject) => {
      // Already-aborted: events don't replay, check explicitly first.
      if (signal.aborted) {
        reject(new Error(`[security:inproc] tool '${call.toolName}' aborted`));
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`[security:inproc] tool '${call.toolName}' exceeded ${caps.timeMs}ms budget`));
      }, caps.timeMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error(`[security:inproc] tool '${call.toolName}' aborted`));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      handler(call.input).then(
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
