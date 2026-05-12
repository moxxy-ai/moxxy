import {
  defineCompactor,
  definePlugin,
  type CompactorDef,
  type EventLogReader,
  type MoxxyEvent,
  type TokenBudget,
} from '@moxxy/sdk';

export interface SummarizeOptions {
  readonly thresholdRatio?: number;
  readonly keepRecentTurns?: number;
  readonly summary?: (text: string) => Promise<string> | string;
}

export function createSummarizeCompactor(opts: SummarizeOptions = {}): CompactorDef {
  const thresholdRatio = opts.thresholdRatio ?? 0.75;
  const keepRecent = opts.keepRecentTurns ?? 3;
  const summarize = opts.summary ?? defaultSummary;

  return defineCompactor({
    name: 'summarize-old-turns',
    shouldCompact(log: EventLogReader, budget: TokenBudget) {
      return budget.estimatedTokens > thresholdRatio * budget.contextWindow;
    },
    async compact(events: ReadonlyArray<MoxxyEvent>) {
      // High-water mark: skip anything already covered by a previous
      // CompactionEvent's replacedRange. Without this, every call
      // re-compacts the same prefix from index 0 on top of itself,
      // wasting tokens and producing nested summaries.
      const prior = events
        .filter((e): e is MoxxyEvent & { type: 'compaction' } => e.type === 'compaction')
        .reduce((max, e) => Math.max(max, e.replacedRange[1] ?? -1), -1);
      const startIdx = prior + 1;

      const tail = events.slice(startIdx);
      const turnIds = unique(tail.map((e) => e.turnId));
      if (turnIds.length <= keepRecent) {
        return {
          type: 'compaction',
          sessionId: events[0]?.sessionId ?? ('' as never),
          turnId: events[events.length - 1]?.turnId ?? ('' as never),
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
      const text = slice
        .map((e) => describeEvent(e))
        .filter(Boolean)
        .join('\n');
      const summary = await summarize(text);
      return {
        type: 'compaction',
        sessionId: slice[0]?.sessionId ?? ('' as never),
        turnId: slice[slice.length - 1]?.turnId ?? ('' as never),
        source: 'compactor',
        compactor: 'summarize-old-turns',
        replacedRange: [from, to],
        summary,
        tokensSaved: Math.max(0, slice.length * 30),
      };
    },
  });
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

function defaultSummary(text: string): string {
  const lines = text.split('\n');
  return lines.length <= 5 ? text : `${lines.slice(0, 5).join('\n')}\n... (${lines.length - 5} more lines)`;
}

export const summarizeCompactorPlugin = definePlugin({
  name: '@moxxy/compactor-summarize',
  version: '0.0.0',
  compactors: [createSummarizeCompactor()],
});

export default summarizeCompactorPlugin;
