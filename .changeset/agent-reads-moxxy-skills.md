---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Claude, Codex and OpenCode can now use the person's Moxxy skills. Moxxy lends them one more tool, `load_skill`, whose description lists the person's skills (project, user and synthesized) and the skill of a Moxxy feature whose tools the agent is lent (Moxxy Browser, Computer Use); the agent reads a skill's instructions by name. Claude and Codex see the tool upfront instead of behind their tool search (Codex sees all of Moxxy's tools upfront). A skill the agent has itself under the same name is left to the agent, and a skill saved during the conversation reaches the agent at its next message. Reading a skill no longer asks the person for permission, also in API conversations. When an agent says again that its limit is used up without saying when it resets, the reset it gave before still shows. The SDK adds `AgentStepRequest.skills` and `withKnownReset`.
