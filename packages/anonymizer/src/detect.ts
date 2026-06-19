/**
 * Detection orchestration: select the enabled detectors (by category + region,
 * or by an explicit id allow-list), run them, fold in custom-term and external
 * (NER) spans, then resolve overlaps so each character is claimed by at most one
 * category — the highest-priority one.
 */

import {
  DICTIONARY,
  DETECTOR_BY_ID,
  DEFAULT_CATEGORIES,
  detectCustom,
  type DetectorDef,
} from './dictionary.js';
import type { DetectOptions, PiiCategory, PiiSpan, Region } from './types.js';
import { ALL_REGIONS } from './types.js';

/**
 * Overlap-resolution priority. A 16-digit Luhn-valid card overlaps a phone
 * pattern; keeping the higher-priority category stops it being mis-tagged.
 * Structured + checksum-validated categories outrank looser ones (phone, date,
 * postalCode). Higher number wins.
 */
const PRIORITY: Record<PiiCategory, number> = {
  // deviceId (IMEI) outranks creditCard because an IMEI is a 15-digit Luhn-valid
  // run — a subset of the card pattern — and only fires when an `IMEI` keyword is
  // nearby, so when both match the same digits the context-gated IMEI is the
  // right call (a real Amex sitting next to the word "IMEI" is implausible).
  deviceId: 102,
  creditCard: 100,
  iban: 98,
  bankAccount: 96,
  ssn: 94,
  nationalId: 92,
  taxId: 90,
  healthId: 88,
  vehicleId: 86,
  crypto: 82,
  secret: 80,
  email: 78,
  url: 70,
  passport: 68,
  driverLicense: 66,
  ipv6: 64,
  ipv4: 62,
  mac: 60,
  person: 55,
  org: 50,
  location: 48,
  postalCode: 44,
  custom: 40,
  phone: 30,
  date: 10,
};

/** Resolve which detectors to run from the options. */
export function selectDetectors(opts: DetectOptions = {}): DetectorDef[] {
  if (opts.detectorIds) {
    return opts.detectorIds
      .map((id) => DETECTOR_BY_ID.get(id))
      .filter((d): d is DetectorDef => !!d);
  }
  const categories = new Set<PiiCategory>(opts.categories ?? DEFAULT_CATEGORIES);
  const regions = new Set<Region>(opts.regions ?? ALL_REGIONS);
  return DICTIONARY.filter(
    (d) => categories.has(d.category) && (d.region === 'global' || regions.has(d.region)),
  );
}

/**
 * Detect PII in `text`. Returns non-overlapping spans in document order.
 *
 * `customTerms` always run when provided (independent of `categories`).
 * `extraSpans` (e.g. on-device NER) are merged through the same overlap pass.
 */
export function detect(text: string, opts: DetectOptions = {}): PiiSpan[] {
  const raw: PiiSpan[] = [];
  for (const d of selectDetectors(opts)) raw.push(...d.detect(text));
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
