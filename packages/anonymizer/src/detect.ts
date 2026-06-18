/**
 * Detection orchestration: run the enabled detectors, fold in custom-term and
 * external (NER) spans, then resolve overlaps so each character is claimed by at
 * most one category — the highest-priority one.
 */

import { DETECTORS, detectCustom } from './detectors.js';
import type { DetectOptions, PiiCategory, PiiSpan } from './types.js';
import { STRUCTURED_CATEGORIES } from './types.js';

/**
 * Overlap-resolution priority. A 16-digit Luhn-valid card overlaps a phone
 * pattern; keeping the higher-priority category stops it being mis-tagged.
 * Structured + validated categories outrank looser ones (phone, date).
 */
const PRIORITY: Record<PiiCategory, number> = {
  creditCard: 100,
  iban: 95,
  ssn: 90,
  email: 80,
  url: 70,
  ipv6: 66,
  ipv4: 64,
  mac: 60,
  person: 55,
  org: 50,
  location: 48,
  nationalId: 45,
  custom: 40,
  phone: 30,
  date: 10,
};

/**
 * Detect PII in `text`. Returns non-overlapping spans in document order.
 *
 * `customTerms` always run when provided (independent of `categories`).
 * `extraSpans` (e.g. on-device NER) are merged through the same overlap pass.
 */
export function detect(text: string, opts: DetectOptions = {}): PiiSpan[] {
  const categories = new Set(opts.categories ?? STRUCTURED_CATEGORIES);
  const raw: PiiSpan[] = [];

  for (const cat of categories) {
    const fn = DETECTORS[cat];
    if (fn) raw.push(...fn(text));
  }
  if (opts.customTerms?.length) raw.push(...detectCustom(text, opts.customTerms));
  if (opts.extraSpans?.length) raw.push(...opts.extraSpans);

  return resolveOverlaps(raw);
}

/** First index `i` in the start-sorted `kept` array with `kept[i].start >= start`. */
function lowerBoundByStart(kept: readonly PiiSpan[], start: number): number {
  let lo = 0;
  let hi = kept.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (kept[mid]!.start < start) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Greedy interval selection by priority: keep the strongest span, drop anything
 *  overlapping it. Exact-duplicate spans collapse to one.
 *
 *  `kept` is maintained sorted by `start` (insertion via binary search). Because
 *  kept spans are mutually non-overlapping, a candidate overlaps some kept span
 *  iff the single kept span with the greatest `start < candidate.end` also has
 *  `end > candidate.start` — so the overlap test is O(log n), not a linear scan
 *  over every kept span. This keeps the whole pass O(n log n) instead of O(n²),
 *  which matters on large documents (tens of thousands of detections, e.g. a log
 *  file full of IPs/emails) that would otherwise freeze the renderer. */
function resolveOverlaps(spans: readonly PiiSpan[]): PiiSpan[] {
  const valid = spans.filter((s) => s.end > s.start);
  const ordered = [...valid].sort(
    (a, b) =>
      PRIORITY[b.category] - PRIORITY[a.category] ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  );
  const kept: PiiSpan[] = []; // invariant: sorted by start, mutually non-overlapping
  for (const span of ordered) {
    const i = lowerBoundByStart(kept, span.end);
    // The only kept span that can overlap `span` is its left neighbour (the one
    // with the largest start below `span.end`); every earlier kept span ends at
    // or before that neighbour's start, so it cannot reach `span.start`.
    const left = i > 0 ? kept[i - 1]! : null;
    const overlaps = left ? span.start < left.end && left.start < span.end : false;
    if (!overlaps) kept.splice(i, 0, span);
  }
  return kept;
}
