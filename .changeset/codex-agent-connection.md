---
"@moxxy/sdk": minor
"@moxxy/cli": minor
"@moxxy/agent-connection-kit": minor
"@moxxy/plugin-provider-codex-agent": minor
---

ChatGPT — Codex agent connection: the new `codex-agent` provider (`@moxxy/plugin-provider-codex-agent`) hands each turn to Codex itself through `codex app-server`, on the ChatGPT sign-in of the person's installed Codex CLI. Codex keeps its own instructions, config, tools, skills and MCP servers; Moxxy shows what it does and its approvals, turns its plan-mode questions into Moxxy questions and its plan into the plan card, runs goal mode through Codex's own thread goal (ending when Codex says it is met), and lends it Moxxy's tools over a local MCP server. Auto-approve gives only the current conversation's Codex full access; `~/.codex/config.toml` is never edited. The SDK adds a `plan` agent event and `onAgentPlan`, through which plan mode shows an agent's own plan in its card. `@moxxy/agent-connection-kit` gains `Inbox`, `untilStopped` and `transcript`. The `openai-codex` provider is now labelled "ChatGPT — Moxxy".
