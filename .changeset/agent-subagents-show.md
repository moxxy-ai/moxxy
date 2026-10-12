---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Helpers an agent starts itself now show as sub-agents, the same row as Moxxy's own: Claude's `Agent` tool (with the helper's tool calls and answer), Codex's subagents (their tool calls, answer and tokens from their own thread) and OpenCode's `task` (its answer; OpenCode does not report the helper's tool calls, so the row does not count them). A helper still working when its turn ends says "in the background" on its row, and what it does later shows in a row of its own where it happened. Before, Claude's helper's tool calls showed as the main agent's, and a Codex subagent finishing its turn ended the Moxxy turn before Codex answered. The SDK adds the `subagent_started`, `subagent_tool_call` and `subagent_completed` agent step events and `SUBAGENTS_PLUGIN_ID`.
