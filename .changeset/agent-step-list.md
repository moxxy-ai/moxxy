---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

An agent's list of steps now shows as one list per turn, updated in place as it works: done, in progress, waiting. Claude's task tools (`TaskCreate`, `TaskUpdate`, `TaskList`, or `TodoWrite` on older Claude Code), Codex's plan updates and OpenCode's `todowrite` (or an ACP plan) all feed it. Codex's checklist tool, off by default since Codex 0.152, is turned on for the conversations Moxxy starts unless the person's Codex config sets it either way. In the desktop it is a card in the conversation and, while the turn runs, a bar above the message field saying which step the agent is on; in the terminal it is a list of lines marked ✓, ● and ○. Before, every change to the list showed as a separate tool line with raw text. The SDK exports the `step-list` display and `stepsFromTodos`, `stepListOutput`, `stepListProgress`.
