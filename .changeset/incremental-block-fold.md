---
'@moxxy/chat-model': patch
'@moxxy/client-core': patch
'@moxxy/plugin-cli': patch
'@moxxy/desktop': patch
---

perf(chat-model): incrementalize the per-turn block fold (kill the O(n²)/turn re-fold)

Both the desktop Transcript and the TUI ChatView re-folded the ENTIRE growing
event array via `pairToolEvents` on every committed event — k full O(n) walks
per turn, degrading to O(n²) over a session. The fold body is now lifted into a
reusable `stepFold(state, event)` (the verbatim old loop body) shared by the
batch `pairToolEvents` and a new `IncrementalFold` that keeps the folded block
tree alive across renders and re-folds only the unsettled tail past a
`(version, prefixLength)` high-water mark. `syncTo` extends the prefix on a pure
append and rebuilds only when it shifts (scroll-up prepend, /clear). A golden
test feeds many recorded sequences (skill scopes, live tools, subagents, orphan
results, reasoning, file diffs) one event at a time and asserts the incremental
tree is byte-identical to `pairToolEvents(fullPrefix)` after EVERY event, plus a
counter assertion that a k-event turn does O(k) — not O(k²) — step work.

Also: the TUI settled-prefix scan resumes from its high-water mark instead of
re-walking from index 0; `WorkflowCanvas` memoizes `topoOrder` on a geometry-free
topology signature so a node drag no longer recomputes the O(V+E) fold per
mousemove; and `usage.perCall` is head-capped at 200 entries (lossless for the
meter — totals still fold every call).
