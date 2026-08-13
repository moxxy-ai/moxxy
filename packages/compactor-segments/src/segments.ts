import { activeCompactionRanges, toolResultBytes, type MoxxyEvent } from '@moxxy/sdk';

/**
 * Pure log analysis behind the `segments` compactor. No provider, no I/O, so
 * the policy (what becomes a sub-session, when it folds into a chapter, what
 * the window may swallow) is testable without a model.
 */

export interface SegmentOptions {
  /** Turns kept verbatim at the tail, including the in-progress one. */
  readonly keepRecentTurns: number;
  /** A sub-session must carry at least this many context chars to be worth summarizing. */
  readonly minSegmentChars: number;
  /** Live summaries tolerated before the oldest fold into a chapter. */
  readonly maxSegments: number;
  /** How many of the oldest live summaries one chapter absorbs. */
  readonly foldSegments: number;
}

export const DEFAULTS: SegmentOptions = {
  keepRecentTurns: 3,
  minSegmentChars: 2_000,
  maxSegments: 12,
  foldSegments: 6,
};

export function resolveOptions(opts: Partial<SegmentOptions> = {}): SegmentOptions {
  // Clamp every knob: a programmatic caller passing NaN/0 must not be able to
  // disable the bound (which is the whole point of this compactor) or compact
  // the turn that is still running.
  const num = (v: number | undefined, fallback: number, min: number): number =>
    Number.isFinite(v) ? Math.max(min, Math.floor(v!)) : fallback;
  const maxSegments = num(opts.maxSegments, DEFAULTS.maxSegments, 2);
  return {
    keepRecentTurns: num(opts.keepRecentTurns, DEFAULTS.keepRecentTurns, 1),
    minSegmentChars: num(opts.minSegmentChars, DEFAULTS.minSegmentChars, 200),
    maxSegments,
    // Folding must consume at least two summaries (folding one is a rename) and
    // can never exceed the cap it is trying to get back under.
    foldSegments: Math.min(maxSegments, num(opts.foldSegments, DEFAULTS.foldSegments, 2)),
  };
}

/** Event types that actually reach the model, and so must never be silently
 *  swallowed by a compaction window they aren't summarized into. */
const PROJECTED_TYPES = new Set([
  'user_prompt',
  'assistant_message',
  'reasoning_message',
  'tool_call_requested',
  'tool_result',
]);

function isProjected(e: MoxxyEvent): boolean {
  return PROJECTED_TYPES.has(e.type);
}

/** Chars this event contributes to the projected context. Mirrors the SDK's
 *  per-event costing so `tokensSaved` reflects the real context delta. */
export function contextChars(e: MoxxyEvent): number {
  switch (e.type) {
    case 'user_prompt': {
      let n = e.text.length;
      for (const att of e.attachments ?? []) {
        if (att.kind === 'file' || att.kind === 'stdin') n += att.content.length;
      }
      return n;
    }
    case 'assistant_message':
      return e.content.length;
    case 'tool_call_requested':
      return e.name.length + safeJsonLen(e.input);
    case 'tool_result':
      if (e.error) return (e.error.message?.length ?? 0) + 12;
      return toolResultBytes(e.output);
    default:
      return 0;
  }
}

function safeJsonLen(v: unknown): number {
  try {
    return JSON.stringify(v ?? '').length;
  } catch {
    return 0;
  }
}

export interface SegmentPlan {
  readonly kind: 'segment';
  /** Inclusive seq window this summary will replace. */
  readonly from: number;
  readonly to: number;
  /** Turns folded into this sub-session, oldest first. */
  readonly turnIds: ReadonlyArray<string>;
  /** 1-based ordinal, never reused across a session. */
  readonly ordinal: number;
  /** Context chars the window costs today. */
  readonly originalChars: number;
  readonly events: ReadonlyArray<MoxxyEvent>;
}

export interface ChapterPlan {
  readonly kind: 'chapter';
  readonly from: number;
  readonly to: number;
  readonly ordinal: number;
  /** The live summaries being folded, oldest first. */
  readonly summaries: ReadonlyArray<string>;
  readonly originalChars: number;
}

export type CompactionPlan = SegmentPlan | ChapterPlan;

/**
 * Decide the next compaction step, or null when the log is already as compact
 * as this policy wants it.
 *
 * Order matters: an over-cap summary index is folded FIRST, so the index can
 * never grow past `maxSegments` even while new sub-sessions keep arriving.
 */
export function planCompaction(
  events: ReadonlyArray<MoxxyEvent>,
  opts: SegmentOptions,
): CompactionPlan | null {
  if (events.length === 0) return null;
  const live = activeCompactionRanges(events);
  if (live.length > opts.maxSegments) {
    const chapter = planChapter(events, live, opts);
    if (chapter) return chapter;
  }
  return planSegment(events, live, opts);
}

function planChapter(
  events: ReadonlyArray<MoxxyEvent>,
  live: ReadonlyArray<{ from: number; to: number; summary: string }>,
  opts: SegmentOptions,
): ChapterPlan | null {
  const ordered = [...live].sort((a, b) => a.from - b.from);
  const candidates = ordered.slice(0, opts.foldSegments);
  if (candidates.length < 2) return null;

  // Grow the fold one summary at a time, stopping before any window that would
  // swallow a projected event no summary covers. Compaction/elision bookkeeping
  // events inside the window are fine; projection ignores them.
  const covered = (seq: number): boolean =>
    ordered.some((r) => seq >= r.from && seq <= r.to);
  let taken = 0;
  let to = -1;
  for (let i = 0; i < candidates.length; i++) {
    const next = candidates[i]!;
    const clean = events.every(
      (e) => !isProjected(e) || e.seq < candidates[0]!.from || e.seq > next.to || covered(e.seq),
    );
    if (!clean) break;
    taken = i + 1;
    to = next.to;
  }
  if (taken < 2) return null;

  const folded = candidates.slice(0, taken);
  return {
    kind: 'chapter',
    from: folded[0]!.from,
    to,
    ordinal: countSummaries(events, '[chapter ') + 1,
    summaries: folded.map((r) => r.summary),
    originalChars: folded.reduce((n, r) => n + r.summary.length, 0),
  };
}

function planSegment(
  events: ReadonlyArray<MoxxyEvent>,
  live: ReadonlyArray<{ from: number; to: number }>,
  opts: SegmentOptions,
): SegmentPlan | null {
  const covered = (seq: number): boolean => live.some((r) => seq >= r.from && seq <= r.to);

  // Distinct turns in log order. The LAST `keepRecentTurns` of them (which
  // includes the in-progress turn, since it is appending right now) stay
  // verbatim. This is what keeps "no, the other one" answerable without a
  // recall round-trip.
  const turnOrder: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!seen.has(e.turnId)) {
      seen.add(e.turnId);
      turnOrder.push(e.turnId);
    }
  }
  const eligible = turnOrder.slice(0, Math.max(0, turnOrder.length - opts.keepRecentTurns));
  if (eligible.length === 0) return null;

  // Skip turns already summarized: a turn counts as done when it has no
  // uncovered projected event left.
  const uncoveredOf = (turnId: string): ReadonlyArray<MoxxyEvent> =>
    events.filter((e) => e.turnId === turnId && !covered(e.seq));
  let start = 0;
  while (start < eligible.length && uncoveredOf(eligible[start]!).every((e) => !isProjected(e))) {
    start += 1;
  }
  if (start >= eligible.length) return null;

  // Accumulate consecutive eligible turns until the sub-session is substantial
  // enough that a summary is smaller than what it replaces. Without this, a
  // one-word turn would be re-summarized on every iteration forever (its
  // summary can never be shorter than "ok").
  const turnIds: string[] = [];
  let originalChars = 0;
  let from = Number.MAX_SAFE_INTEGER;
  let to = -1;
  for (let i = start; i < eligible.length; i++) {
    const turnId = eligible[i]!;
    const turnEvents = events.filter((e) => e.turnId === turnId);
    if (turnEvents.length === 0) continue;
    turnIds.push(turnId);
    for (const e of turnEvents) {
      from = Math.min(from, e.seq);
      to = Math.max(to, e.seq);
      if (!covered(e.seq)) originalChars += contextChars(e);
    }
    if (originalChars >= opts.minSegmentChars) break;
  }
  if (turnIds.length === 0 || to < 0) return null;
  // Still too small even after taking every eligible turn, so wait for more
  // history rather than paying a summarization call that saves nothing.
  if (originalChars < opts.minSegmentChars) return null;

  // The window must not swallow a projected event belonging to a turn outside
  // this segment (possible when turns interleave, e.g. concurrent HTTP turns).
  const inSegment = new Set(turnIds);
  const trespass = events.find(
    (e) => isProjected(e) && e.seq >= from && e.seq <= to && !inSegment.has(e.turnId) && !covered(e.seq),
  );
  if (trespass) {
    to = trespass.seq - 1;
    if (to < from) return null;
  }

  const windowEvents = events.filter((e) => e.seq >= from && e.seq <= to && !covered(e.seq));
  if (!windowEvents.some(isProjected)) return null;

  return {
    kind: 'segment',
    from,
    to,
    turnIds,
    ordinal: countSummaries(events, '[segment ') + 1,
    originalChars: windowEvents.reduce((n, e) => n + contextChars(e), 0),
    events: windowEvents,
  };
}

/** Ordinals are derived from history (including summaries later superseded by a
 *  chapter) so a number is never reused and a stale reference stays unambiguous. */
function countSummaries(events: ReadonlyArray<MoxxyEvent>, prefix: string): number {
  let n = 0;
  for (const e of events) {
    if (e.type === 'compaction' && e.summary.startsWith(prefix)) n += 1;
  }
  return n;
}

export function segmentHeader(plan: SegmentPlan): string {
  const turns = plan.turnIds.join(', ');
  return `[segment ${plan.ordinal} · turn ${turns} · seq ${plan.from}-${plan.to}]`;
}

export function chapterHeader(plan: ChapterPlan, coveredSegments: number): string {
  return `[chapter ${plan.ordinal} · folds ${coveredSegments} earlier summaries · seq ${plan.from}-${plan.to}]`;
}

/** One line per event: the input the summarizer compresses. */
export function buildDigest(events: ReadonlyArray<MoxxyEvent>): string {
  return events.map(describeEvent).filter(Boolean).join('\n');
}

function describeEvent(e: MoxxyEvent): string | null {
  switch (e.type) {
    case 'user_prompt':
      // The prompt IS the sub-session's brief, so it gets a far longer window
      // than the surrounding chatter.
      return `[user] ${e.text.slice(0, 2_000)}`;
    case 'assistant_message':
      return `[assistant] ${e.content.slice(0, 800)}`;
    case 'tool_call_requested':
      return `[tool_use] ${e.name}(${safeJsonStr(e.input).slice(0, 160)})`;
    case 'tool_result':
      return `[tool_result ${e.ok ? 'ok' : 'err'}] ${
        typeof e.output === 'string' ? e.output.slice(0, 200) : ''
      }${e.error?.message?.slice(0, 200) ?? ''}`;
    default:
      return null;
  }
}

function safeJsonStr(v: unknown): string {
  try {
    return JSON.stringify(v ?? {}) ?? '{}';
  } catch {
    return '[unserializable]';
  }
}
