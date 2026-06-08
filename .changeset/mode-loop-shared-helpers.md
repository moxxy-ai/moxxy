---
"@moxxy/sdk": minor
---

Hoist the duplicated tool-batch loop scaffolding out of `mode-default` and `mode-goal`
into shared SDK helpers, so the load-bearing stuck-loop orphan-result fix lives in one
place instead of being hand-mirrored across modes. `@moxxy/sdk` now exports
`executeToolUses` (run a tool batch, synthesizing failed results + an abort on
mid-batch cancel) and `emitRequestsAndDetectStuck` (emit `tool_call_requested`s, run the
stuck detector, and on a trip synthesize a paired `tool_result` for every emitted call
before the fatal error), parameterized by a `StuckLoopReport` for each mode's wording and
goal mode's extra `goal_stuck` event. Pure refactor — no behavior change.
