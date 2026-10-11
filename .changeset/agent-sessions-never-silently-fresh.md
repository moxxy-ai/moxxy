---
"@moxxy/cli": patch
---

Agent connections never silently start over: when Codex or OpenCode fails to load a conversation's earlier session, Moxxy tries once more and then shows the error without starting another session, so the history is kept for the next message; only a session the agent no longer has is replaced, and the agent is told to say so (OpenCode, which reports both alike, is checked against its session list). Codex: while auto-approve is off the person answers approvals, not Codex's own reviewer, and Moxxy asks for summaries of Codex's thinking unless the person's config sets them.
