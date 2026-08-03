import type { CompactionEvent, MoxxyEvent } from './events.js';

/**
 * Shared compaction decision logic: the single source of truth for "which
 * summary ranges are live", consumed by BOTH `projectMessagesFromLog` (what we
 * send) and `estimateContextTokens` (what we think we send). Same reasoning as
 * the sibling `elision-state` module: one leaf module keeps the estimate and
 * the projection from drifting, and avoids a circular import between them.
 */

export interface CompactionRange {
  readonly from: number;
  readonly to: number;
  readonly summary: string;
}

/**
 * The compaction ranges that still contribute a summary to the projection.
 *
 * Two filters:
 *  1. Well-formedness. A compaction that saved nothing, carries an empty
 *     summary, or has an inverted range is inert (this is what lets the
 *     "nothing to compact" no-op event exist without affecting projection).
 *  2. **Supersession**. A range fully contained in a LATER range is dropped.
 *     This is what lets a compactor fold its own earlier summaries into a
 *     coarser one (segment summaries → a chapter summary). Without it, the
 *     rolled-up range and every range it swallowed would both project, so the
 *     summary index could only ever grow, and an index that grows without
 *     bound defeats the point of compacting in the first place.
 *
 * For a well-formed log written by a compactor that never re-compacts, no range
 * contains another and this is exactly the old unconditional filter. The scan is
 * O(n²) in the number of compaction events, which is bounded by the active
 * compactor's segment cap (tens), not by the length of the session.
 */
export function activeCompactionRanges(
  events: ReadonlyArray<MoxxyEvent>,
): ReadonlyArray<CompactionRange> {
  const wellFormed = events.filter(
    (event): event is CompactionEvent =>
      event.type === 'compaction' &&
      event.tokensSaved > 0 &&
      event.summary.trim().length > 0 &&
      event.replacedRange[0] <= event.replacedRange[1],
  );
  const live: CompactionRange[] = [];
  for (let i = 0; i < wellFormed.length; i++) {
    const range = wellFormed[i]!.replacedRange;
    let superseded = false;
    for (let j = i + 1; j < wellFormed.length; j++) {
      const later = wellFormed[j]!.replacedRange;
      if (later[0] <= range[0] && range[1] <= later[1]) {
        superseded = true;
        break;
      }
    }
    if (superseded) continue;
    live.push({ from: range[0], to: range[1], summary: wellFormed[i]!.summary });
  }
  return live;
}

function eventInCompactionRange(
  seq: number,
  ranges: ReadonlyArray<CompactionRange>,
): CompactionRange | null {
  for (const range of ranges) {
    if (seq >= range.from && seq <= range.to) return range;
  }
  return null;
}

/**
 * A compaction lookup that answers "which range (if any) contains `seq`" in
 * O(log ranges) instead of {@link eventInCompactionRange}'s O(ranges) linear
 * scan per event. Compaction ranges are non-overlapping ascending seq prefixes,
 * so a seq belongs to at most one range and binary search over the
 * sorted-by-`from` array returns the SAME range the linear first-match did,
 * byte-identical projection.
 *
 * Defensive fallback: if the ranges are NOT strictly non-overlapping (which the
 * compaction invariant forbids, but a hand-crafted/corrupt log could violate),
 * we keep the exact linear first-match semantics so the projection can never
 * diverge from the old code.
 */
export function makeCompactionLookup(
  ranges: ReadonlyArray<CompactionRange>,
): (seq: number) => CompactionRange | null {
  if (ranges.length === 0) return () => null;
  if (ranges.length === 1) {
    const only = ranges[0]!;
    return (seq) => (seq >= only.from && seq <= only.to ? only : null);
  }
  // Sort a copy by `from` (stable enough: ranges are non-overlapping). Verify
  // the non-overlap invariant on the sorted copy; only then is binary search
  // provably equivalent to the linear first-match.
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  let nonOverlapping = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.from <= sorted[i - 1]!.to) {
      nonOverlapping = false;
      break;
    }
  }
  if (!nonOverlapping) return (seq) => eventInCompactionRange(seq, ranges);
  return (seq) => {
    // Largest `from <= seq`, then a single containment check.
    let lo = 0;
    let hi = sorted.length - 1;
    let cand = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]!.from <= seq) {
        cand = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (cand < 0) return null;
    const range = sorted[cand]!;
    return seq <= range.to ? range : null;
  };
}
