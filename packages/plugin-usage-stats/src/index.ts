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
 * firing subscribers, and `onInit` runs after seeding. So the cursor captured
 * at init equals the restored-prefix length, and `onShutdown` folds only the
 * live suffix (`log.slice(cursor)`) of this run. A session's usage is therefore
 * counted exactly once — when it closes — never re-counted on resume.
 *
 * Flush-on-close means a hard kill (SIGKILL) drops the in-progress session's
 * delta; that's the accepted trade-off for a single, contention-free write.
 */
export function buildUsageStatsPlugin(opts: BuildUsageStatsPluginOptions = {}): Plugin {
  // Log length at init = count of restored events to skip. Live events appended
  // during this run occupy indices >= cursor.
  let cursor = 0;
  return definePlugin({
    name: '@moxxy/plugin-usage-stats',
    version: '0.0.0',
    hooks: {
      onInit(ctx) {
        cursor = ctx.log.length;
      },
      async onShutdown(ctx) {
        const live = ctx.log.slice(cursor);
        if (live.length === 0) return;
        const delta = summarizeTokensByModel(live);
        await mergeUsageStats(delta, opts.statsPath);
      },
    },
  });
}

export default buildUsageStatsPlugin;
