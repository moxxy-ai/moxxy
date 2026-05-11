---
name: compactor-author
description: Implement a Compactor for context-window management.
---

# Compactor author — implement a `Compactor`

A compactor shrinks the projected message history when it grows too large. The contract is in `@moxxy/sdk`:

```ts
interface CompactorDef {
  name: string;
  shouldCompact(log: EventLogReader, budget: TokenBudget): boolean;
  compact(events: ReadonlyArray<MoxxyEvent>, ctx: CompactContext): Promise<CompactionEvent>;
}
```

`@moxxy/compactor-summarize` is the reference: summarize-old-turns.

## Triggering

The runtime calls `shouldCompact` at every `onTurnStart` and after large `tool_result` events. A typical rule: `budget.estimatedTokens > 0.75 * budget.contextWindow`.

## Selecting what to compact

You receive the full event log. Pick a *contiguous range*. Reasonable defaults:

- **Don't compact the system prompt** (if you emit one — currently it's passed via `LoopContext.systemPrompt`, not the log).
- **Don't compact the most recent N turns** (default 3) — the model needs continuity.
- **Don't compact events referenced by an unresolved tool call.** Use `isToolCallResolved(callId, log)` from `@moxxy/core`.

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

The runtime appends this event. `selectMessages` honors it during projection: the original events stay in the log forever (so replay is deterministic), but the projected message history shows the summary in their place.

## Generating the summary

Either:

- **Local heuristic** — concatenate `describeEvent(e)` outputs and truncate. Cheap, deterministic, no token cost.
- **LLM summary** — call a cheap model (Haiku is ideal) via a provider passed in your compactor's config. Higher quality, costs tokens.

`@moxxy/compactor-summarize` does the local heuristic; you can swap it via the `summary` option:

```ts
createSummarizeCompactor({
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

Activate via `session.compactors.setActive('my-compactor')`. If yours is the first registered, it becomes the default.
