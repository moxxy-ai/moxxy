import {
  definePlugin,
  summarizeTokensByModel,
  type EventLogReader,
  type Plugin,
  type SessionId,
} from '@moxxy/sdk';
import { mergeUsageStats } from '@moxxy/core';

export interface BuildUsageStatsPluginOptions {
  /** Override the on-disk aggregate path. Tests inject a tmp file here. */
  readonly statsPath?: string;
}

/**
 * Optional capabilities the concrete `EventLog` exposes beyond the
 * `EventLogReader` contract. `ctx.log` is the live `EventLog` at runtime
 * (`Session.appContext()` hands us `log.asReader()`, which returns the log
 * itself), so we duck-type these. A reader that lacks them (e.g. a test fake)
 * just degrades to the contract-only path — never crashes.
 */
interface EventLogExtras {
  /** Seq of the first held event; lets us compute the boundary in O(1). */
  readonly baseSeq?: number;
  /** Fires after `clear()`/`/new` empties the log and restarts seqs at 0. */
  onClear?(fn: () => void): () => void;
}

/**
 * Records cross-session token usage. On shutdown it folds THIS run's
 * `provider_response` events by `<provider>/<model>` and merges the delta into
 * `~/.moxxy/usage.json` — a forward-going aggregate the `/usage` panel renders
 * and `/usage clear` resets.
 *
 * Resume-safe by construction: restored events are seeded into the log WITHOUT
 * firing subscribers, and `onInit` runs after seeding. `onInit` records the
 * highest restored event seq, and `onShutdown` folds only events with a
 * strictly greater seq — the live suffix of this run. A session's usage is
 * therefore counted exactly once — when it closes — never re-counted on resume,
 * and the seq boundary stays correct even on a rebased mirror (baseSeq > 0).
 *
 * `/new`-safe: `Session.reset()` calls `log.clear()`, which restarts the
 * authoritative seq stream at 0 WITHOUT re-firing `onInit`. Without reacting to
 * that, the post-`/new` events (seqs 0,1,2…) would all fall at or below the
 * pre-`/new` boundary and be silently dropped. We subscribe to the log's
 * `onClear` and re-baseline the cursor to `null` so the post-`/new` suffix is
 * folded from the new base.
 *
 * Flush-on-close means a hard kill (SIGKILL) drops the in-progress session's
 * delta; that's the accepted trade-off for a single, contention-free write.
 *
 * Best-effort, never load-blocking: both hooks are internally fault-tolerant.
 * A hostile or half-implemented reader (one whose `ofType`/`onClear` throws)
 * degrades — init falls back to the fold-whole-suffix default and shutdown
 * records nothing for the run — instead of rejecting the hook. This holds even
 * when the hooks are invoked directly (outside the host's lifecycle dispatcher).
 */
export function buildUsageStatsPlugin(opts: BuildUsageStatsPluginOptions = {}): Plugin {
  // Boundary tracked by event SEQ, not by index/length. `log.length` is a count
  // of held events while `log.slice(from)` is SEQ-addressed; the two only
  // coincide on a base-0 log. On a rebased mirror (baseSeq > 0, e.g. partial
  // replay), a length-as-seq cursor would clamp to the base and re-fold the
  // entire restored prefix, double-counting usage. Capturing the highest seq
  // restored at init and folding only events with a strictly greater seq is
  // base-independent. `null` (no onInit, or a post-`/new` re-baseline) folds the
  // whole log — the documented suffix-from-base default.
  //
  // Keyed by sessionId so one shared plugin instance stays correct across
  // multiple sessions (the runner/thin-client model hosts many in one process);
  // a single scalar would let one session's onInit clobber another's cursor.
  // The map self-cleans in onShutdown, so it cannot grow unbounded.
  const cursors = new Map<SessionId, number | null>();
  // Per-session `onClear` unsubscribers, so we tear the listener down on
  // shutdown rather than leaking one per init.
  const clearUnsubs = new Map<SessionId, () => void>();
  return definePlugin({
    name: '@moxxy/plugin-usage-stats',
    hooks: {
      onInit(ctx) {
        // Usage stats are a best-effort, non-load-blocking layer: a hostile or
        // half-implemented reader (e.g. one whose `ofType`/`onClear` throws)
        // must NEVER take down init.
        //
        // The two steps are isolated so a failure in one can't poison the other.
        // The boundary is the load-bearing correctness value: if `onClear`
        // registration throws AFTER a valid boundary was computed, we must KEEP
        // that boundary — discarding it (resetting to `null`) would re-fold the
        // whole restored prefix on shutdown and DOUBLE-COUNT the resumed
        // session's usage into the lifetime aggregate. A failed boundary
        // computation, by contrast, falls back to `null` (the documented
        // fold-whole-suffix default) so the run is still counted, just from base.
        try {
          cursors.set(ctx.sessionId, boundarySeq(ctx.log));
        } catch {
          cursors.set(ctx.sessionId, null);
        }
        try {
          const extras = ctx.log as EventLogReader & EventLogExtras;
          if (typeof extras.onClear === 'function') {
            // Replace any stale listener from a prior init of the same session id.
            clearUnsubs.get(ctx.sessionId)?.();
            const unsub = extras.onClear(() => {
              // `clear()` reset the seq stream to base 0; fold the post-wipe
              // suffix from the start rather than against the now-stale boundary.
              cursors.set(ctx.sessionId, null);
            });
            clearUnsubs.set(ctx.sessionId, unsub);
          }
        } catch {
          // No `/new` re-baseline wired for this run — the boundary captured
          // above still stands. A session that never clears is unaffected; one
          // that does would over-count the post-`/new` suffix, the lesser evil
          // versus crashing init or dropping the boundary.
        }
      },
      async onShutdown(ctx) {
        // Tear down the per-session state first and unconditionally, so a later
        // throw in the fold/merge can't strand the `onClear` listener or leave a
        // cursor in the map (which would otherwise grow unbounded under a hosting
        // model that reuses one instance across many sessions).
        try {
          clearUnsubs.get(ctx.sessionId)?.();
        } catch {
          // An unsubscribe that throws must not block the merge below.
        }
        clearUnsubs.delete(ctx.sessionId);
        const initMaxSeq = cursors.has(ctx.sessionId) ? cursors.get(ctx.sessionId)! : null;
        cursors.delete(ctx.sessionId);
        // Best-effort: a throwing reader or a failed fold degrades to "record
        // nothing for this run" rather than rejecting the hook (which the host
        // would log as a spurious failure). `mergeUsageStats` already swallows
        // its own write errors; this guards the read/fold side too.
        try {
          // Only `provider_response` events carry token usage; scan that indexed
          // subset (O(matches)) instead of copying + filtering the full event log
          // (O(total session events)) on this 5s-timeboxed shutdown path.
          const responses = ctx.log.ofType('provider_response');
          const live =
            initMaxSeq === null ? responses : responses.filter((e) => e.seq > initMaxSeq);
          if (live.length === 0) return;
          const delta = summarizeTokensByModel(live);
          await mergeUsageStats(delta, opts.statsPath);
        } catch {
          // Drop this run's usage rather than crash shutdown — explicitly the
          // accepted trade-off for an optional, contention-free aggregate.
        }
      },
    },
  });
}

/**
 * Highest held seq — the resume boundary — without copying the log. Prefers the
 * O(1) `baseSeq + length - 1` identity (every held event has `seq === base +
 * index`); falls back to scanning the indexed `provider_response` subset when a
 * reader doesn't expose `baseSeq`. `null` for an empty log. Using the response
 * subset for the fallback is sound: `onShutdown` only folds responses, so a
 * boundary at the max restored response seq still excludes every restored
 * response and includes every live one.
 */
function boundarySeq(log: EventLogReader & EventLogExtras): number | null {
  if (log.length === 0) return null;
  if (typeof log.baseSeq === 'number') return log.baseSeq + log.length - 1;
  let max: number | null = null;
  for (const e of log.ofType('provider_response')) if (max === null || e.seq > max) max = e.seq;
  return max;
}

export default buildUsageStatsPlugin;
