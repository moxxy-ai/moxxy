import {
  defineCompactor,
  definePlugin,
  type CompactContext,
  type CompactorDef,
  type EventLogReader,
  type MoxxyEvent,
  type TokenBudget,
} from '@moxxy/sdk';

export interface SummarizeOptions {
  readonly thresholdRatio?: number;
  readonly keepRecentTurns?: number;
  /** Custom summarizer. When omitted, the compactor asks the SESSION'S OWN
   *  provider/model (handed in via `CompactContext`) to write the summary,
   *  and only falls back to an honest, clearly-labeled digest truncation when
   *  no provider is reachable. */
  readonly summary?: (text: string) => Promise<string> | string;
}

/** Hard ceiling on the digest text sent to the provider for summarization. */
const MAX_SUMMARIZE_INPUT_CHARS = 48_000;
/** Output budget for the provider-written summary. */
const SUMMARY_MAX_TOKENS = 1024;
/** Size of the labeled head+tail digest kept when no provider is available. */
const FALLBACK_DIGEST_CHARS = 6_000;

const SUMMARY_SYSTEM_PROMPT =
  'You compress conversation history for an AI agent so it can keep working with less context. ' +
  'You are given a line-per-event digest of earlier turns. Write a dense, factual brief the agent can rely on: ' +
  'the task and its current state, key decisions and their reasons, important file paths / identifiers / values, ' +
  'tool outcomes (including failures), and any unresolved questions or TODOs. ' +
  'Do not editorialize, do not invent details, output ONLY the summary text.';

export function createSummarizeCompactor(opts: SummarizeOptions = {}): CompactorDef {
  const thresholdRatio = opts.thresholdRatio ?? 0.75;
  const keepRecent = opts.keepRecentTurns ?? 3;

  return defineCompactor({
    name: 'summarize-old-turns',
    shouldCompact(log: EventLogReader, budget: TokenBudget) {
      return budget.estimatedTokens > thresholdRatio * budget.contextWindow;
    },
    async compact(events: ReadonlyArray<MoxxyEvent>, ctx?: CompactContext) {
      // The dispatcher only invokes `compact` when `shouldCompact` returned
      // true — and that checks `budget.estimatedTokens > 0`, which requires
      // events. So an empty log here is genuinely unexpected; throw rather
      // than fabricate a CompactionEvent with branded-id casts.
      if (events.length === 0) {
        throw new Error('summarize-old-turns: compact() called with no events');
      }

      // High-water mark: skip anything already covered by a previous
      // CompactionEvent's replacedRange. Without this, every call
      // re-compacts the same prefix on top of itself, wasting tokens and
      // producing nested summaries. `replacedRange` is in event-`seq` space
      // (see CompactionEvent), so resume from the first event whose seq is
      // past the previous high-water mark — NOT from `priorSeq + 1` as an
      // array index, which silently skips events once seq ≠ arrayIndex.
      const priorSeq = events
        .filter((e): e is MoxxyEvent & { type: 'compaction' } => e.type === 'compaction')
        .reduce((max, e) => Math.max(max, e.replacedRange[1]), -1);
      const startIdx = events.findIndex((e) => e.seq > priorSeq);

      const firstEvent = events[0]!;
      const lastEvent = events[events.length - 1]!;
      const tail = startIdx < 0 ? [] : events.slice(startIdx);
      const turnIds = unique(tail.map((e) => e.turnId));
      if (turnIds.length <= keepRecent) {
        return {
          type: 'compaction',
          sessionId: firstEvent.sessionId,
          turnId: lastEvent.turnId,
          source: 'compactor',
          compactor: 'summarize-old-turns',
          replacedRange: [0, 0],
          summary: '',
          tokensSaved: 0,
        };
      }
      const compactThrough = turnIds[turnIds.length - keepRecent - 1] ?? turnIds[0];
      const from = startIdx;
      let to = from;
      for (let i = from; i < events.length; i++) {
        if (events[i]!.turnId === compactThrough) to = i;
      }
      const slice = events.slice(from, to + 1);
      const sliceFirst = slice[0]!;
      const sliceLast = slice[slice.length - 1]!;
      const text = slice
        .map((e) => describeEvent(e))
        .filter(Boolean)
        .join('\n');
      const summary = opts.summary
        ? await opts.summary(text)
        : ((await providerSummary(text, ctx)) ?? fallbackDigest(text));
      // Honest accounting: tokens saved = what the replaced events would have
      // cost the context minus what the summary costs (chars/4, matching
      // `estimateContextTokens`'s heuristic) — NOT the old fabricated
      // `slice.length * 30`. A summary longer than the original reports 0 and
      // the dispatcher discards the compaction.
      const originalChars = slice.reduce((n, e) => n + contextChars(e), 0);
      const tokensSaved = Math.max(0, Math.ceil((originalChars - summary.length) / 4));
      return {
        type: 'compaction',
        sessionId: sliceFirst.sessionId,
        turnId: sliceLast.turnId,
        source: 'compactor',
        compactor: 'summarize-old-turns',
        replacedRange: [sliceFirst.seq, sliceLast.seq],
        summary,
        tokensSaved,
      };
    },
  });
}

/**
 * Ask the session's own provider to write the summary. Returns null when no
 * provider/model is available or the call fails — callers fall back to the
 * labeled digest truncation.
 */
async function providerSummary(text: string, ctx?: CompactContext): Promise<string | null> {
  if (!ctx?.provider) return null;
  const provider = ctx.provider;
  const model = ctx.model ?? provider.models[0]?.id;
  if (!model) return null;
  const input =
    text.length > MAX_SUMMARIZE_INPUT_CHARS
      ? `${text.slice(0, MAX_SUMMARIZE_INPUT_CHARS / 2)}\n[... digest truncated ...]\n${text.slice(-MAX_SUMMARIZE_INPUT_CHARS / 2)}`
      : text;
  try {
    let out = '';
    for await (const event of provider.stream({
      model,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Digest of the turns to compress:\n\n${input}` }],
        },
      ],
      maxTokens: SUMMARY_MAX_TOKENS,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })) {
      if (event.type === 'text_delta') out += event.delta;
      if (event.type === 'error') return null;
    }
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function describeEvent(e: MoxxyEvent): string | null {
  switch (e.type) {
    case 'user_prompt':
      return `[user] ${e.text.slice(0, 200)}`;
    case 'assistant_message':
      return `[assistant] ${e.content.slice(0, 200)}`;
    case 'tool_call_requested':
      return `[tool_use] ${e.name}(${JSON.stringify(e.input).slice(0, 80)})`;
    case 'tool_result':
      return `[tool_result ${e.ok ? 'ok' : 'err'}] ${
        typeof e.output === 'string' ? e.output.slice(0, 120) : ''
      }${e.error?.message?.slice(0, 120) ?? ''}`;
    default:
      return null;
  }
}

/** Characters this event contributes to the projected context — what the
 *  summary actually replaces. Mirrors the SDK estimate's per-event costing. */
function contextChars(e: MoxxyEvent): number {
  switch (e.type) {
    case 'user_prompt':
      return e.text.length;
    case 'assistant_message':
      return e.content.length;
    case 'tool_call_requested':
      return e.name.length + safeJsonLen(e.input);
    case 'tool_result':
      if (e.error) return (e.error.message?.length ?? 0) + 12;
      if (typeof e.output === 'string') return e.output.length;
      return safeJsonLen(e.output);
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

function unique<T>(arr: ReadonlyArray<T>): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

let warnedFallback = false;

/**
 * No provider available: keep a head+tail window of the digest and SAY SO in
 * the retained text, instead of silently presenting the first five lines as a
 * "summary". Logged once per process so the degradation is observable.
 */
function fallbackDigest(text: string): string {
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      '[compactor-summarize] no provider available for summarization — compacting with a labeled digest truncation instead',
    );
  }
  const note =
    '[no summarizer available — this is a truncated digest of the compacted turns, not a summary]';
  if (text.length <= FALLBACK_DIGEST_CHARS) return `${note}\n${text}`;
  const half = FALLBACK_DIGEST_CHARS / 2;
  const head = text.slice(0, half);
  const tailText = text.slice(-half);
  return `${note}\n${head}\n[... ${text.length - FALLBACK_DIGEST_CHARS} digest chars omitted ...]\n${tailText}`;
}

export const summarizeCompactorPlugin = definePlugin({
  name: '@moxxy/compactor-summarize',
  version: '0.0.0',
  compactors: [createSummarizeCompactor()],
});

export default summarizeCompactorPlugin;
