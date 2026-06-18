---
"@moxxy/sdk": patch
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Performance pass (audit-driven, golden-tested for byte-identity)

Algorithmic-complexity fixes; every algorithm-shape change is guarded by a test
asserting the new path is byte-identical to the old, so behaviour is unchanged.

- **Event log / projection (`@moxxy/sdk`, `@moxxy/core`, `@moxxy/runner`):**
  index `EventLog.ofType`/`byTurn` (O(n) filter → O(matches), property-tested
  equal to the old filter); `applyLazyTools` single-partition + index-backed
  loaded-tool scan; `projectMessages` binary-cursor compaction-range lookup;
  `computeElisionState` fused passes + no redundant sort; `surfaceInputParamsSchema`
  O(keys) size guard instead of `JSON.stringify` per frame.
- **Chat-model block fold (`@moxxy/chat-model`, `@moxxy/client-core`, TUI,
  desktop):** the O(n²)/turn re-fold is now incremental — only the unsettled tail
  re-folds, keyed on a high-water mark — with a golden test feeding events one at
  a time and asserting deep-equality with a full re-fold after every event. Bounds
  the live in-memory log / `seenIds` / `usage.perCall`; memoizes the workflow
  canvas topology so a node drag no longer recomputes it per pointer-move.
- **Quadratic / unbounded hotspots:** `UsagePanel` peak via reduce (was a
  `Math.max(...series)` spread that RangeError'd on long sessions), `grep` file
  size cap + binary skip, `StreamingPreview` incremental last-line (fixed an
  infinite loop on leading-newline content), terminal sentinel-regex compiled
  once + tail scan, webhooks parse-body-once, scheduler batched schedule
  reconcile, `runProcess` concat-once, and a one-time session-log `ensureReady`.
