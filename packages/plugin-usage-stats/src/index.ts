import { definePlugin, summarizeTokensByModel, type Plugin } from '@moxxy/sdk';
import { mergeUsageStats } from '@moxxy/core';

export interface BuildUsageStatsPluginOptions {
  /** Override the on-disk aggregate path. Tests inject a tmp file here. */
  readonly statsPath?: string;
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
 * Flush-on-close means a hard kill (SIGKILL) drops the in-progress session's
 * delta; that's the accepted trade-off for a single, contention-free write.
 */
export function buildUsageStatsPlugin(opts: BuildUsageStatsPluginOptions = {}): Plugin {
  // Track the boundary by event SEQ, not by index/length. `log.length` is a
  // count of held events while `log.slice(from)` is SEQ-addressed; the two only
  // coincide on a base-0 log. On a rebased mirror (baseSeq > 0, e.g. partial
  // replay), a length-as-seq cursor would clamp to the base and re-fold the
  // entire restored prefix, double-counting usage. Capturing the highest seq
  // restored at init and folding only events with a strictly greater seq is
  // base-independent. `null` (no onInit) folds the whole log — the documented
  // abnormal-lifecycle default.
  let initMaxSeq: number | null = null;
  return definePlugin({
    name: '@moxxy/plugin-usage-stats',
    version: '0.0.0',
    hooks: {
      onInit(ctx) {
        initMaxSeq = maxSeq(ctx.log.slice());
      },
      async onShutdown(ctx) {
        const live =
          initMaxSeq === null
            ? ctx.log.slice()
            : ctx.log.slice().filter((e) => e.seq > initMaxSeq!);
        if (live.length === 0) return;
        const delta = summarizeTokensByModel(live);
        await mergeUsageStats(delta, opts.statsPath);
      },
    },
  });
}

/** Highest `seq` among the events, or `null` for an empty log. */
function maxSeq(events: ReadonlyArray<{ seq: number }>): number | null {
  let max: number | null = null;
  for (const e of events) if (max === null || e.seq > max) max = e.seq;
  return max;
}

export default buildUsageStatsPlugin;
