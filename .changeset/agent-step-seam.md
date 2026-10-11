---
'@moxxy/sdk': minor
'@moxxy/cli': patch
---

Groundwork for agent connections, where a vendor's own coding agent does the turn. A provider can now implement `agentStep`: the shared loop hands it each round and records what the agent did (its text, its tool calls marked `executedBy: 'provider'`, its session id for resuming, its approval policy as the conversation's auto-approve) as ordinary events, so every mode and surface shows it. The agent reaches Moxxy through `host.runTool`, `host.approve` and `host.ask`. Moxxy's end-of-turn reminders stay out of such turns unless a checkpoint sets `agentConnections`. Providers without `agentStep` behave exactly as before.
