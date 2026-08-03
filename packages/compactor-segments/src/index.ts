import {
  abortError,
  activeCompactionRanges,
  defineCompactor,
  definePlugin,
  defineTool,
  summarizeWithProvider,
  z,
  type CompactContext,
  type CompactorDef,
  type EventLogReader,
  type MoxxyEvent,
  type TokenBudget,
} from '@moxxy/sdk';
import {
  buildDigest,
  chapterHeader,
  planCompaction,
  resolveOptions,
  segmentHeader,
  type ChapterPlan,
  type SegmentOptions,
  type SegmentPlan,
} from './segments.js';
import { rank, type SessionDoc } from './search.js';

export {
  planCompaction,
  resolveOptions,
  DEFAULTS,
  type SegmentOptions,
  type SegmentPlan,
  type ChapterPlan,
  type CompactionPlan,
} from './segments.js';
export { rank, tokenize, type SessionDoc, type RankedDoc } from './search.js';

const MAX_SUMMARIZE_INPUT_CHARS = 48_000;
const SEGMENT_MAX_TOKENS = 700;
const CHAPTER_MAX_TOKENS = 900;

/**
 * Above this context fill the tail window collapses to a single turn. The
 * verbatim window is a comfort, not a guarantee. Under real pressure, keeping
 * three turns intact is what pushes a session over the edge.
 */
const PRESSURE_RATIO = 0.85;

const SEGMENT_SYSTEM_PROMPT =
  'You compress ONE completed sub-session of an AI agent (a user request and everything the agent ' +
  'did to answer it) into a durable record the agent can rely on months later, without the transcript. ' +
  'Write exactly these lines, each on one line, no preamble and no markdown headers:\n' +
  'Asked: what the user actually wanted.\n' +
  'Did: the concrete actions taken: files created/edited, commands run, decisions made.\n' +
  'Outcome: what resulted, INCLUDING failures and what was abandoned.\n' +
  'Facts: exact paths, identifiers, versions, numbers and names worth keeping. Omit the line if there are none.\n' +
  'Open: anything unresolved or promised for later. Write "none" if nothing is open.\n' +
  'Be dense and factual. Never invent detail that is not in the digest.';

const CHAPTER_SYSTEM_PROMPT =
  'You merge several sub-session records of an AI agent into ONE coarser record covering the same period. ' +
  'Keep the same line structure (Asked / Did / Outcome / Facts / Open), but describe the PERIOD rather than ' +
  'a single request: what the work was about, what got done, what the standing results are. ' +
  'Preserve exact identifiers (paths, names, versions) that later work may still need, and preserve every ' +
  'still-open thread. Drop step-by-step detail that has been superseded. Never invent anything.';

export interface SegmentsCompactorOptions extends Partial<SegmentOptions> {
  /** Custom summarizer, for tests and offline hosts. */
  readonly summary?: (text: string, kind: 'segment' | 'chapter') => Promise<string> | string;
}

/**
 * Sub-session compaction.
 *
 * Every completed turn (or a run of small consecutive turns) becomes a
 * SEGMENT, one dense outcome record that replaces the turn's raw events in
 * context. Once the index of records passes `maxSegments`, the oldest fold into
 * a CHAPTER, so the index itself is bounded rather than merely slower-growing.
 * The result is a context whose size is governed by the policy, not by how long
 * the session has been running: summaries (bounded) + the verbatim tail
 * (bounded) + the live turn.
 *
 * Nothing is lost: the event log keeps every original event. `session_recall`
 * searches the records; `recall({ turnId })` pulls a whole sub-session back
 * verbatim when the model needs the detail.
 *
 * Unlike `summarize-old-turns`, compaction here is driven by TURN BOUNDARIES
 * rather than by a token threshold. That costs one summarization call per
 * sub-session, and buys three things: the context never approaches the window
 * in the first place; each emitted record is byte-stable and lands after the
 * previous ones, so the projected prefix grows append-only and a cached prefix
 * stays valid (a threshold compactor instead rewrites a large prefix in one
 * late bulk step); and every past sub-session is individually addressable.
 * A chapter fold DOES rewrite the head of the prefix, but that happens once per
 * `foldSegments` sub-sessions, not once per turn.
 */
export function createSegmentsCompactor(opts: SegmentsCompactorOptions = {}): CompactorDef {
  const base = resolveOptions(opts);

  const effectiveOptions = (budget: TokenBudget | undefined): SegmentOptions => {
    if (!budget || budget.contextWindow <= 0) return base;
    if (budget.estimatedTokens <= PRESSURE_RATIO * budget.contextWindow) return base;
    return { ...base, keepRecentTurns: 1 };
  };

  return defineCompactor({
    name: 'segments',
    shouldCompact(log: EventLogReader, budget: TokenBudget) {
      return planCompaction(log.slice(), effectiveOptions(budget)) !== null;
    },
    async compact(events: ReadonlyArray<MoxxyEvent>, ctx?: CompactContext) {
      if (events.length === 0) {
        throw new Error('segments: compact() called with no events');
      }
      const plan = planCompaction(events, effectiveOptions(ctx?.budget));
      if (!plan) return noOp(events);

      const summary =
        plan.kind === 'segment'
          ? await summarizeSegment(plan, ctx, opts.summary)
          : await summarizeChapter(plan, ctx, opts.summary);

      // Final abort gate: a turn cancelled while the summary was in flight must
      // not have its history rewritten underneath it.
      if (ctx?.signal?.aborted) throw abortError('segments: compaction aborted');

      const first = events[0]!;
      const last = events[events.length - 1]!;
      return {
        type: 'compaction' as const,
        sessionId: first.sessionId,
        turnId: last.turnId,
        source: 'compactor' as const,
        compactor: 'segments',
        replacedRange: [plan.from, plan.to] as const,
        summary,
        tokensSaved: Math.max(0, Math.ceil((plan.originalChars - summary.length) / 4)),
      };
    },
  });
}

async function summarizeSegment(
  plan: SegmentPlan,
  ctx: CompactContext | undefined,
  custom: SegmentsCompactorOptions['summary'],
): Promise<string> {
  const digest = buildDigest(plan.events);
  const header = segmentHeader(plan);
  const body = custom
    ? await custom(digest, 'segment')
    : ((await summarizeWithProvider(digest, {
        system: SEGMENT_SYSTEM_PROMPT,
        prompt: (d) => `Sub-session transcript to record:\n\n${d}`,
        maxInputChars: MAX_SUMMARIZE_INPUT_CHARS,
        maxTokens: SEGMENT_MAX_TOKENS,
        ...providerOpts(ctx),
      })) ?? fallbackDigest(digest));
  // Budget the body against what it replaces so a verbose summarizer can never
  // make the context BIGGER, which would leave the plan permanently unmet and
  // re-summarize the same sub-session on every iteration.
  return `${header}\n${clampSummary(body, budgetFor(plan.originalChars, 0.6, header.length))}`;
}

async function summarizeChapter(
  plan: ChapterPlan,
  ctx: CompactContext | undefined,
  custom: SegmentsCompactorOptions['summary'],
): Promise<string> {
  const digest = plan.summaries.join('\n\n');
  const header = chapterHeader(plan, plan.summaries.length);
  const body = custom
    ? await custom(digest, 'chapter')
    : ((await summarizeWithProvider(digest, {
        system: CHAPTER_SYSTEM_PROMPT,
        prompt: (d) => `Sub-session records to merge, oldest first:\n\n${d}`,
        maxInputChars: MAX_SUMMARIZE_INPUT_CHARS,
        maxTokens: CHAPTER_MAX_TOKENS,
        ...providerOpts(ctx),
      })) ?? fallbackDigest(digest));
  return `${header}\n${clampSummary(body, budgetFor(plan.originalChars, 0.5, header.length))}`;
}

function providerOpts(ctx: CompactContext | undefined): {
  provider?: CompactContext['provider'];
  model?: string;
  signal?: AbortSignal;
} {
  return {
    ...(ctx?.provider ? { provider: ctx.provider } : {}),
    ...(ctx?.model ? { model: ctx.model } : {}),
    ...(ctx?.signal ? { signal: ctx.signal } : {}),
  };
}

/** Char budget for a summary body: a fixed fraction of what it replaces, so
 *  every compaction step is guaranteed to shrink the context. */
function budgetFor(originalChars: number, ratio: number, headerChars: number): number {
  return Math.max(200, Math.floor(originalChars * ratio) - headerChars - 1);
}

function clampSummary(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 24).trimEnd()}\n[… record truncated …]`;
}

let warnedFallback = false;

function fallbackDigest(text: string): string {
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      '[compactor-segments] no provider available for summarization; recording a labeled digest truncation instead',
    );
  }
  return `[no summarizer available: truncated digest of this sub-session, not a summary]\n${text}`;
}

/** The "nothing to compact" event: an empty window that can never alias a live
 *  seq, discarded by the dispatcher's tokensSaved<=0 guard. */
function noOp(events: ReadonlyArray<MoxxyEvent>) {
  const first = events[0]!;
  const last = events[events.length - 1]!;
  return {
    type: 'compaction' as const,
    sessionId: first.sessionId,
    turnId: last.turnId,
    source: 'compactor' as const,
    compactor: 'segments',
    replacedRange: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] as const,
    summary: '',
    tokensSaved: 0,
  };
}

/**
 * The searchable index of past sub-sessions, derived from the log. Reads the
 * compaction events directly (rather than parsing their headers) so the seq
 * range and the covered turns come from structured data; only the kind and
 * ordinal are read off the header this compactor wrote.
 */
export function buildSessionDocs(events: ReadonlyArray<MoxxyEvent>): SessionDoc[] {
  const live = activeCompactionRanges(events);
  return live.map((range, index) => {
    const covered = events.filter((e) => e.seq >= range.from && e.seq <= range.to);
    const turnIds = [...new Set(covered.map((e) => e.turnId))];
    const prompts = covered
      .filter((e): e is Extract<MoxxyEvent, { type: 'user_prompt' }> => e.type === 'user_prompt')
      .map((e) => e.text)
      .join('\n');
    const head = /^\[(segment|chapter) (\d+)/.exec(range.summary);
    return {
      kind: head?.[1] === 'chapter' ? ('chapter' as const) : ('segment' as const),
      ordinal: head ? Number(head[2]) : index + 1,
      turnIds,
      from: range.from,
      to: range.to,
      summary: range.summary,
      searchText: `${range.summary}\n${prompts}`,
    };
  });
}

export const sessionRecallTool = defineTool({
  name: 'session_recall',
  icon: 'search',
  description:
    'Search the record of THIS session\'s earlier sub-sessions. Older parts of the conversation are ' +
    'kept as one dense record per sub-session (a user request and everything you did for it) rather ' +
    'than verbatim, so use this whenever the user refers to something from earlier that you cannot ' +
    'see in the visible context ("what did we decide about X", "the file you changed yesterday", ' +
    '"go back to the thing before this"). Returns the matching records; call `recall({ turnId })` ' +
    'afterwards to pull one sub-session back verbatim when you need the exact detail.',
  inputSchema: z.object({
    query: z.string().min(1).describe('What you are looking for, in the user\'s own words if possible.'),
    limit: z.number().int().min(1).max(10).optional().default(4),
  }),
  permission: { action: 'allow' },
  isolation: {
    // Reads ctx.log, which an out-of-process isolator would not carry.
    required: 'inproc',
    capabilities: { net: { mode: 'none' }, timeMs: 5_000 },
  },
  handler: ({ query, limit }, ctx) => {
    const docs = buildSessionDocs(ctx.log.slice());
    if (docs.length === 0) {
      return 'No earlier sub-sessions have been recorded yet; the whole conversation so far is still visible in your context.';
    }
    const matches = rank(docs, query, limit);
    if (matches.length === 0) {
      return `No recorded sub-session matches "${query}". ${docs.length} record(s) exist, covering seq 0-${docs[docs.length - 1]!.to}.`;
    }
    return {
      matches: matches.map(({ doc, score }) => ({
        kind: doc.kind,
        ordinal: doc.ordinal,
        turnIds: doc.turnIds,
        seqRange: [doc.from, doc.to],
        record: doc.summary,
        score: Math.round(score * 1000) / 1000,
      })),
      hint: 'Call recall({ turnId: "<one of turnIds>" }) to bring that sub-session back verbatim, or recall({ seq: N }) for a single message.',
    };
  },
});

export const segmentsCompactorPlugin = definePlugin({
  name: '@moxxy/compactor-segments',
  version: '0.0.0',
  compactors: [createSegmentsCompactor()],
  tools: [sessionRecallTool],
});

export default segmentsCompactorPlugin;
