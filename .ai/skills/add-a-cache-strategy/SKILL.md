---
name: add-a-cache-strategy
description: Build a CacheStrategy (prompt-cache breakpoint placement) — use when changing where provider cache breakpoints go.
---

# Add a cache strategy

Full workflow: **`.claude/agents/cache-strategy-author.md`**. Reference:
`packages/cache-strategy-stable-prefix` (default; `none` = opt-out).

Contract:
- `defineCacheStrategy({ name, plan })`; `plan()` returns provider-neutral
  `CacheHint`s: `{ target: 'tools' | 'system' | { messageIndex } }`. The
  provider expresses them (Anthropic → `cache_control`).
- **`plan()` MUST be deterministic for identical inputs.** A non-deterministic
  breakpoint shifts the cached prefix between calls and silently defeats the
  cache — you pay 1.25x writes for 0 reads.
- **Respect `CacheStrategyContext.volatileTailMessageCount`** (A42): modes mark
  per-iteration nudges volatile; place the rolling-tail breakpoint on the last
  STABLE message, never on volatile tail content.
- One strategy is active per session; registered like compactors
  (`definePlugin({ cacheStrategies: [...] })` + `builtins.ts`), first
  registered auto-activates.

Test: assert breakpoint stability across repeated `plan()` calls with the same
log, and that adding a volatile tail message does NOT move the tail breakpoint
(`cache-strategy-stable-prefix/src/*.test.ts` has the pattern).

Background on the token-efficiency direction (elision, recall, lazy tools):
TECH_DEBT.md + `~/.claude/plans/i-d-like-to-improve-reflective-bear.md`.
