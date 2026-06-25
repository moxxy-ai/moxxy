---
name: add-a-compactor
description: Build a Compactor (context-window compaction strategy) — use when changing how old turns get summarized/elided.
---

# Add a compactor

Full workflow: **`.claude/agents/compactor-author.md`**. Reference:
`packages/compactor-summarize` (the default).

Checklist:
- `defineCompactor({ name, compact })`; register via a plugin
  (`definePlugin({ compactors: [...] })`) — registry-swappable, first
  registered auto-activates.
- **Never mutate the event log.** Compaction appends a `compaction` event with
  `replacedRange`; selectors honor it as a pure fold.
- **Track the high-water mark**: resume after the prior
  `CompactionEvent.replacedRange[1]` — re-scanning from index 0 layers nested
  summaries.
- **Summarize with the session's own provider/model** (handed in through
  `CompactContext`); if no provider is reachable, fall back to an HONEST,
  labeled digest with a one-time warning — never fabricate. `tokensSaved`
  must come from real char deltas, not invented multipliers (A42b).
- Compaction interacts with elision + cache strategy: shifting the prefix
  invalidates the prompt cache, so compact at turn boundaries and keep
  outputs deterministic where possible.

Test pattern: feed a scripted log, assert the compaction event's range +
that a second compact() doesn't re-summarize the summary
(`compactor-summarize/src/*.test.ts`).
