---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

A Claude or Codex conversation that went to another connection and came back shows again the turn the agent takes up by itself when work it left running in the background ends ("Agent continued"). Switching connections gives the conversation a new provider client, while the agent it started keeps running; the agent's own turns now reach whichever client the conversation has, through the pool that keeps the agents running (`AgentSessionPool.onAgentTurn` / `agentTurn` in `@moxxy/agent-connection-kit`).
