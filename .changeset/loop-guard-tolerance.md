---
'@moxxy/sdk': minor
'@moxxy/core': minor
'@moxxy/config': minor
'@moxxy/cli': patch
---

Make the stuck-loop guard more tolerant + configurable. The detector was tripping turns too eagerly — its exact-repeat threshold was 3 (the same tool+input 3× in a window of 8), which legitimately-repeated work (re-reading a file, re-running `git status` across steps) could hit. Raised the defaults to exact=8 / near=10 / window=12, since `maxIterations` (500 in default mode) is the real runaway backstop and the guard only needs to catch a *tight* same-call loop.

It's now tunable via `context.loopGuard` in config: `enabled` (set `false` to disable the guard entirely and rely on `maxIterations`), `windowSize`, `repeatThreshold`, `nearWindowSize`, `nearThreshold`. Threaded through the session → ModeContext → every loop strategy (default, goal, collaborative + subagents), and live-reloadable.
