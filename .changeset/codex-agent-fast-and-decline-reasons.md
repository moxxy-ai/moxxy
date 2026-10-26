---
"@moxxy/sdk": minor
"@moxxy/cli": patch
"@moxxy/plugin-provider-codex-agent": patch
---

ChatGPT — Codex agent: Moxxy's fast mode now runs the conversation's Codex on its fast tier (Codex's `/fast`, the `priority` service tier) and hands it back to the person's own setting when turned off; `agentStep` requests carry `fast`. When the person declines one of Codex's tools, their reason reaches Codex in its running turn (`turn/steer`), or in its next message when the turn can no longer take input, since Codex's approval answer has no room for it.
