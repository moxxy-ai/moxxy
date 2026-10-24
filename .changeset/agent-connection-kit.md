---
'@moxxy/sdk': minor
'@moxxy/cli': patch
---

Shared parts for agent connections, in the new private `@moxxy/agent-connection-kit`: the MCP server through which a vendor agent calls Moxxy tools (local only, with a token, browsers refused), a JSON-RPC client for agents that speak it over stdio, a pool that keeps one live agent per conversation, the mapping from Moxxy modes to the agent's own plan and goal, and a check of the installed agent CLI's version and how to update it. `@moxxy/sdk` adds `toolOutputForModel`, the one reading of a tool output for a model, now shared by the projection and agent connections.
