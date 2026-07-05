---
'@moxxy/sdk': minor
'@moxxy/cli': minor
'@moxxy/desktop': patch
---

Goal mode refactor: deliver the outcome, then get out of the way. Goal runs are now guardrail-free — no iteration cap, no token budget, and a stuck-loop trip steers the model with a nudge instead of killing the run (the only terminals are goal_complete, goal_abandon, an idle stall, user abort, or a genuinely fatal error). Goal mode is also one-shot (`ModeDef.transient`): it arms per objective, hands the session back to the previous mode when the goal concludes, is never persisted as the boot/category default, and channels no longer flip session-wide yolo/auto-approve (the run auto-approves via its own scoped resolver). Also fixes the shared ReAct loop's checkpoint injection budget to be per idle-episode, so long autonomous runs no longer die on their Nth spread-out idle round. SDK additions: `emitRequestsAndNudgeOnStuck`, `stuck.action: 'nudge'` on `runReactLoop`, `StuckLoopDetector.reset()`, `ModeDef.transient`, `ModeContext.previousModeName`.
