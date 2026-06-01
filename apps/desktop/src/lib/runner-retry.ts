/**
 * Run `action`, retrying ONLY while it fails because the runner link is
 * (re)connecting — never on any other error.
 *
 * The desktop's runner connection can be momentarily down: e.g. right after the
 * OAuth browser detour the `moxxy serve` socket sometimes drops (notably on
 * Windows, where the long idle window over a named pipe is fragile), and the
 * supervisor re-establishes it within a few seconds. A command fired into that
 * gap throws `not-connected`; rather than fail the action the user just
 * completed, we wait across the reconnect and retry.
 */
export async function retryWhileReconnecting<T>(
  action: () => Promise<T>,
  opts: {
    /** True iff the error means "runner not connected yet" (worth retrying). */
    isReconnecting: (e: unknown) => boolean;
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? ((): number => Date.now());
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      return await action();
    } catch (e) {
      if (!opts.isReconnecting(e) || now() >= deadline) throw e;
      await sleep(intervalMs);
    }
  }
}
