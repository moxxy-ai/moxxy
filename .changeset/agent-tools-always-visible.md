---
'@moxxy/cli': patch
'@moxxy/sdk': minor
---

Claude, Codex and OpenCode now always see Moxxy's tools. Each agent reads its tool list once, as its session opens, so Moxxy lists every tool of the conversation from the start and keeps the list the same across modes; a tool the current mode does not offer runs nothing, and the agent is told why ("ask_user is not available in goal mode…"), which the conversation shows like any tool result. A plugin added partway through a conversation reaches the agent too: Claude and OpenCode re-read the list, and Codex restarts its app-server and resumes the same thread. Claude's tools are listed before it starts instead of a moment later, and a Claude conversation no longer hangs on the message after a goal turn.

For connection authors, `@moxxy/sdk` adds `ModeContext.allTools` and `AgentStepRequest.allTools` (every tool of the session, in any mode).
