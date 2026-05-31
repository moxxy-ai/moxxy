import { MoxxyError, defineTool, z } from '@moxxy/sdk';

/**
 * Hard ceiling on a single sleep call (5 min). A sleep blocks the turn for
 * its whole duration, so an unbounded value could wedge the loop; the model
 * can chain `Sleep` calls (checking the abort signal between) for longer
 * polling waits — e.g. "kick off a build, sleep, re-check" patterns.
 */
export const MAX_SLEEP_MS = 300_000;

/** Resolve the requested duration (seconds + ms, summed) to a clamped ms
 *  value. Pure + exported so the clamp is unit-testable without real waiting. */
export function resolveSleepMs(input: { seconds?: number; ms?: number }): number {
  const requested = (input.seconds ?? 0) * 1000 + (input.ms ?? 0);
  return Math.min(Math.round(requested), MAX_SLEEP_MS);
}

export const sleepTool = defineTool({
  name: 'Sleep',
  description:
    'Pause for a set duration before continuing. Use it to wait for an external/async process ' +
    '(a build, a deploy, a server warming up) before re-checking, instead of busy-looping. ' +
    'Give `seconds` and/or `ms` (they sum); capped at 5 minutes per call. Interruptible.',
  inputSchema: z
    .object({
      seconds: z
        .number()
        .positive()
        .optional()
        .describe('Seconds to pause. Summed with `ms` when both are given.'),
      ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Milliseconds to pause. Summed with `seconds` when both are given.'),
    })
    .refine((v) => v.seconds !== undefined || v.ms !== undefined, {
      message: 'Provide `seconds` and/or `ms`.',
    }),
  // No side effects — safe to auto-allow without a permission prompt.
  permission: { action: 'allow' },
  compact: {
    verb: 'Sleeping',
    noun: { one: 'pause', other: 'pauses' },
  },
  isolation: {
    capabilities: {
      net: { mode: 'none' },
      // Slightly above the cap so the isolator's own timeout never fires
      // before a max-length sleep resolves on its own.
      timeMs: MAX_SLEEP_MS + 1_000,
    },
  },
  async handler(input, ctx) {
    const totalMs = resolveSleepMs(input);
    if (ctx.signal.aborted) {
      throw new MoxxyError({ code: 'ABORTED', message: 'Sleep aborted before start' });
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ctx.signal.removeEventListener('abort', onAbort);
        resolve();
      }, totalMs);
      // `{ once: true }` auto-removes this listener after it fires; on abort we
      // also clear the pending timer so it can't leak past a max-length sleep.
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new MoxxyError({ code: 'ABORTED', message: `Sleep interrupted after request for ${totalMs}ms` }));
      };
      ctx.signal.addEventListener('abort', onAbort, { once: true });
    });

    return `slept ${totalMs}ms`;
  },
});
