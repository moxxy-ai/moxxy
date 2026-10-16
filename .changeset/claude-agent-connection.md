---
"@moxxy/sdk": minor
"@moxxy/cli": minor
"@moxxy/agent-connection-kit": minor
---

Claude Agent connection: the `claude-code` provider now hands each turn to Claude Code itself through the Claude Agent SDK (installed into `~/.moxxy` the first time the connection is used), on the Claude Pro/Max sign-in. Claude keeps its own prompt, tools, skills and settings; Moxxy shows what it does, asks before each of its tools with the permission rules applied, shows its questions, runs plan and goal mode through Claude's own, and lends it Moxxy's tools over a local MCP server. The text mode and its `<moxxy_tool_calls>` protocol are gone. The SDK adds `req.sessionId` to `agentStep`, a `goal` event, and `onAgentGoal`, through which goal mode ends when the agent says its goal is met. `@moxxy/agent-connection-kit` is now published, since the connection installs from npm.
