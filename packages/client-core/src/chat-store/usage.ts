/**
 * Token accounting side-channel.
 *
 * `provider_response` events carry the provider-reported usage but are NOT
 * rendered or persisted, so they never enter the display log — the store
 * folds them into a {@link UsageSnapshot} instead (powers the composer's
 * context meter + usage modal). Each fold is O(1).
 */

import type { MoxxyEvent } from '@moxxy/sdk';

/**
 * Token accounting accumulated from `provider_response` events.
 */
export interface UsageSnapshot {
  /** Prompt size of the most recent call (input + cache read + cache write). */
  readonly latestPrompt: number | null;
  /** Per-call prompt sizes in order — feeds the growth sparkline. */
  readonly perCall: ReadonlyArray<number>;
  readonly calls: number;
  readonly totalInput: number;
  readonly totalCacheRead: number;
  readonly totalCacheCreation: number;
  readonly totalOutput: number;
}

/**
 * Cap on {@link UsageSnapshot.perCall} — the only unbounded field. It feeds a
 * growth sparkline, which shows a fixed-width trailing window, so keeping more
 * than this many points is invisible. The cumulative `total*`/`calls` counters
 * still fold EVERY call, so head-trimming `perCall` is lossless for the meter.
 * Head-evict (drop the oldest) past this so a multi-hour session can't grow the
 * array (and its per-call copy) without bound.
 */
export const PER_CALL_CAP = 200;

export const EMPTY_USAGE: UsageSnapshot = Object.freeze({
  latestPrompt: null,
  perCall: Object.freeze([]),
  calls: 0,
  totalInput: 0,
  totalCacheRead: 0,
  totalCacheCreation: 0,
  totalOutput: 0,
});

/** Compact token count for notices — 1.2k / 3.4M / 812. */
export function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

type ProviderResponse = Extract<MoxxyEvent, { type: 'provider_response' }>;

/** Fold one provider_response into the accumulator, or null if it carried no
 *  usage (so callers can skip a re-render). */
export function recordUsage(prev: UsageSnapshot, e: ProviderResponse): UsageSnapshot | null {
  const hasUsage =
    e.inputTokens !== undefined ||
    e.outputTokens !== undefined ||
    e.cacheReadTokens !== undefined ||
    e.cacheCreationTokens !== undefined;
  if (!hasUsage) return null;
  const hasPrompt =
    e.inputTokens !== undefined ||
    e.cacheReadTokens !== undefined ||
    e.cacheCreationTokens !== undefined;
  const prompt = (e.inputTokens ?? 0) + (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0);
  // Append the new prompt size, then head-evict so the sparkline source stays
  // bounded at PER_CALL_CAP. `slice(-cap)` keeps the most recent window; the
  // cumulative counters below are unaffected, so the meter loses nothing.
  let perCall = prev.perCall;
  if (hasPrompt) {
    const next = [...prev.perCall, prompt];
    perCall = next.length > PER_CALL_CAP ? next.slice(next.length - PER_CALL_CAP) : next;
  }
  return {
    latestPrompt: hasPrompt ? prompt : prev.latestPrompt,
    perCall,
    calls: prev.calls + 1,
    totalInput: prev.totalInput + (e.inputTokens ?? 0),
    totalCacheRead: prev.totalCacheRead + (e.cacheReadTokens ?? 0),
    totalCacheCreation: prev.totalCacheCreation + (e.cacheCreationTokens ?? 0),
    totalOutput: prev.totalOutput + (e.outputTokens ?? 0),
  };
}
