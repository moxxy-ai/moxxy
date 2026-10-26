---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

When Claude's background helper finishes between the person's messages, Moxxy now opens a turn for Claude at once, marked "Agent continued", with the helper's work and Claude's report. Before, that report waited for the person's next message and mixed into its answer. Moxxy's rules now apply to a helper's commands between turns as well (before, only Claude's own approvals did). The phone app folds helpers the same way as the desktop, including "in the background", and shows these turn notes. The runner no longer treats a turn started later from within a client's finished turn as that client's. The SDK adds the `'agent'` trigger origin, `LLMProvider.onAgentTurn`, `AgentTurnStart` and `AgentStepRequest.continuesAgentTurn`.
