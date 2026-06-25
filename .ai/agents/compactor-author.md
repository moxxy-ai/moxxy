---
name: compactor-author
description: Implement a Compactor for context-window management.
---

# Compactor author — implement a `Compactor`

A compactor shrinks the projected message history when it grows too large. The SDK contract:

```ts
interface CompactorDef {
  readonly name: string;
  shouldCompact(log: EventLogReader, budget: TokenBudget): boolean;
  compact(events: ReadonlyArray<MoxxyEvent>, ctx: CompactContext): Promise<CompactionEvent>;
}
```

`@moxxy/compactor-summarize` is the reference: summarize-old-turns.

## Triggering

The runtime calls `shouldCompact` at every `onTurnStart` and after large `tool_result` events. Typical rule:

```ts
shouldCompact(log, budget) {
  return budget.estimatedTokens > 0.75 * budget.contextWindow;
}
```

## **Always honor the high-water mark**

Track prior compactions when picking the range to summarize. Without this guard you re-compact the already-summarized prefix on every call, layering nested summaries (the bug shipped in v0 and was caught by the audit):

```ts
async compact(events) {
  const prior = events
    .filter((e): e is MoxxyEvent & { type: 'compaction' } => e.type === 'compaction')
    .reduce((max, e) => Math.max(max, e.replacedRange[1] ?? -1), -1);
  const startIdx = prior + 1;
  const tail = events.slice(startIdx);
  // ... pick from `tail`, not from index 0
}
```

## Selecting what to compact

You receive the full event log. Pick a *contiguous range*. Reasonable defaults:

- **Don't compact the system prompt** — it's not in the log; it's passed via `LoopContext.systemPrompt`.
- **Don't compact the most recent N turns** (default 3) — the model needs continuity.
- **Don't compact events referenced by an unresolved tool call.** Walk the log for `tool_call_requested` events whose `callId` has no subsequent `tool_result` / `tool_call_denied`.

## Emit a `CompactionEvent`

```ts
return {
  type: 'compaction',
  sessionId: events[0].sessionId,
  turnId: lastTurnId,
  source: 'compactor',
  compactor: 'my-compactor',
  replacedRange: [fromSeq, toSeq],
  summary: '<summary text>',
  tokensSaved: <estimated>,
};
```

The runtime appends this event. `selectMessages` in core honors it during projection: the original events stay in the log forever (so replay is deterministic), but the projected message history shows the summary in their place.

## Generating the summary

Either:

- **Local heuristic** — concatenate event descriptions and truncate. Cheap, deterministic, no token cost. This is what `@moxxy/compactor-summarize` does by default.
- **LLM summary** — call a cheap model (Haiku, gpt-4o-mini) via a provider passed in your compactor's config. Higher quality, costs tokens.

The shipped compactor exposes a `summary` option for swapping:

```ts
createSummarizeCompactor({
  thresholdRatio: 0.75,
  keepRecentTurns: 3,
  summary: async (text) => {
    const out = await callHaiku(`Summarize: ${text}`);
    return out;
  },
});
```

## Ship as a plugin

```ts
export default definePlugin({
  name: '@moxxy/compactor-<name>',
  compactors: [createMyCompactor()],
});
```

Activate via `session.compactors.setActive('my-compactor')`. If yours is the first registered, it becomes the default (CompactorRegistry auto-activates on first register).

## Tests

The `@moxxy/compactor-summarize` test file shows the pattern: construct a fake event array with `seq`, `turnId`, `type`; call `compact(events)`; assert the returned `CompactionEvent.replacedRange` is what you expect.

Always include a "doesn't re-compact prior summary" regression test:

```ts
it('respects high-water mark: does not re-compact a prefix covered by an earlier compaction', async () => {
  const events = [
    compaction(0, [0, 2], 't2'),   // prior compaction covers seqs 0..2
    ev(3, 't3', 'turn3'),
    // ...
  ];
  const result = await compactor.compact(events);
  expect(result.replacedRange[0]).toBe(3);  // resume after prior, not from 0
});
```

## Don't

- **Don't start from index 0 every time.** Always read prior `CompactionEvent.replacedRange[1]` and resume after.
- **Don't mutate or delete events.** Append-only is sacred. Compaction adds a `compaction` event; projection honors it.
- **Don't compact across the cap.** Leave the most-recent N turns (default 3) untouched — the model needs them verbatim.
- **Don't emit a compaction with `replacedRange: [0, 0]` when there's nothing to do.** The shipped compactor returns this shape but with `tokensSaved: 0` — fine. But a CompactionEvent with a real range that summarizes nothing is misleading.
