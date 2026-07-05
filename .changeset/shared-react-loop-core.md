---
'@moxxy/sdk': minor
'@moxxy/cli': patch
---

Extract the shared ReAct loop core into the SDK (`runReactLoop`) with a turn-end checkpoint gate, and refactor the existing modes onto it.

- New SDK exports: `runReactLoop`, `TurnCheckpoint`/`CheckpointContext`/`CheckpointResult`, loop hooks (`onIterationStart`, `onProviderSuccess`, `onToolBatchEnd`, `onMaxIterations`), and the retry test seam. A mode can now gate the moment the model claims it is done — run lints, spawn a reviewer subagent and await its verdict — and feed the result back into the same turn (persistent checkpoint-origin `user_prompt`, or a volatile nudge).
- `mode-default`, `mode-goal`, and the collaborative agent loop now share one hardened copy of the loop plumbing (bounded retry back-off, reactive compaction on overflow, elision, stuck detection, abort handling) instead of three divergent ones. Unified semantics: an un-compactable context overflow is now fatal everywhere (goal mode's rule), the collab agent gained the bounded exponential back-off it lacked, and empty truncated completions warn in every mode.
- Guardrails: per-turn injection budget, per-checkpoint timeout with fail-open, empty/oversized-feedback guards, checkpoint disarm in subagent sessions (`ModeContext.isSubagent`) as a recursion backstop.
- `TriggerOrigin` gains `kind: 'checkpoint'`; chat-model treats mid-turn checkpoint prompts as in-turn blocks (not turn boundaries) and the desktop renders them as a compact chip.
