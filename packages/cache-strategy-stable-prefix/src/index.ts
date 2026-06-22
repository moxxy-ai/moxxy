import {
  defineCacheStrategy,
  definePlugin,
  type CacheHint,
  type CacheStrategyContext,
  type CacheStrategyDef,
  type ProviderMessage,
} from '@moxxy/sdk';

/**
 * Default prompt-cache strategy. Places up to 4 Anthropic breakpoints:
 *
 *  1. end of the tools array        — static for the whole session
 *  2. end of the system prompt      — static given a stable skill set
 *  3. end of the stable prefix      — the elision/compaction boundary, when
 *                                     the mode reports one (`stablePrefixMessageIndex`);
 *                                     a long-lived breakpoint that survives across turns
 *  4. end of the last message       — the rolling tail, so each inner iteration of a
 *                                     turn reads everything prior from cache and only
 *                                     pays full price for its own new delta. Volatile
 *                                     trailing messages (`volatileTailMessageCount`,
 *                                     e.g. goal mode's idle nudge) are excluded — they
 *                                     are call-local, so caching them is a write that
 *                                     can never be read back
 *
 * The decisive correctness property is determinism: every breakpoint is a
 * pure function of the (append-only) message list, so the cached prefix stays
 * byte-identical across the iterations of a turn and the cache actually hits.
 */
export function createStablePrefixCacheStrategy(): CacheStrategyDef {
  return defineCacheStrategy({
    name: 'stable-prefix',
    plan(messages: ReadonlyArray<ProviderMessage>, ctx: CacheStrategyContext): ReadonlyArray<CacheHint> {
      const hints: CacheHint[] = [{ target: 'tools' }, { target: 'system' }];

      // Volatile trailing messages (e.g. goal mode's idle nudge) are injected
      // for this call only — they won't recur at the same position next call,
      // so a breakpoint on/after them is a guaranteed-wasted cache write.
      // Place the rolling tail breakpoint on the last STABLE message instead.
      // A malformed count (NaN/float/negative) must degrade to caching the true
      // tail, never to silently dropping the rolling-tail breakpoint entirely.
      const volatileTail = Math.max(
        0,
        Math.trunc(Number.isFinite(ctx.volatileTailMessageCount) ? ctx.volatileTailMessageCount! : 0),
      );
      const lastIdx = lastNonSystemIndex(messages, messages.length - volatileTail);
      if (lastIdx < 0) return hints; // nothing but a system prompt (or volatile tail) yet

      // Long-lived breakpoint at the stable prefix boundary (e.g. the elision
      // high-water mark). Only when it is strictly before the tail — otherwise
      // the tail breakpoint already covers it. Constraints, each defending a
      // silently-dropped breakpoint the provider would never honor:
      //   - integer & in range: the Anthropic translator matches the hint's
      //     messageIndex against integer message positions; a NaN/float/out-of-
      //     range index matches none and is dropped with no error (same hazard
      //     the rolling tail normalizes via Math.trunc on the volatile count).
      //   - non-system role: a cache_control on a system-role message is skipped
      //     by the translator, exactly as lastNonSystemIndex defends the tail.
      const stableIdx = ctx.stablePrefixMessageIndex;
      if (
        stableIdx != null &&
        Number.isInteger(stableIdx) &&
        stableIdx >= 0 &&
        stableIdx < lastIdx &&
        messages[stableIdx]?.role !== 'system'
      ) {
        hints.push({ target: { messageIndex: stableIdx } });
      }

      // Rolling tail breakpoint.
      hints.push({ target: { messageIndex: lastIdx } });

      return hints; // ≤ 4, Anthropic's limit
    },
  });
}

function lastNonSystemIndex(
  messages: ReadonlyArray<ProviderMessage>,
  endExclusive: number = messages.length,
): number {
  for (let i = Math.min(endExclusive, messages.length) - 1; i >= 0; i--) {
    if (messages[i]!.role !== 'system') return i;
  }
  return -1;
}

/** Opt-out strategy: emits no breakpoints. Selected when caching is disabled. */
export function createNoCacheStrategy(): CacheStrategyDef {
  return defineCacheStrategy({ name: 'none', plan: () => [] });
}

export const stablePrefixCacheStrategyPlugin = definePlugin({
  name: '@moxxy/cache-strategy-stable-prefix',
  version: '0.0.0',
  // First entry auto-activates → caching on by default. `none` is the opt-out.
  cacheStrategies: [createStablePrefixCacheStrategy(), createNoCacheStrategy()],
});

export default stablePrefixCacheStrategyPlugin;
