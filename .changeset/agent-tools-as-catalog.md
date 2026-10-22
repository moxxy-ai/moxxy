---
"@moxxy/agent-connection-kit": minor
"@moxxy/plugin-provider-codex-agent": patch
"@moxxy/plugin-provider-claude-code": patch
---

Agent connections can lend Moxxy's tools as a catalog of three small tools (`find_tools`, `describe_tools`, `call_tool`) instead of every tool one by one (`moxxyToolsHandler` / `idleToolsHandler` option `{ catalog: true }`). The catalog names the tool groups (an MCP server, or tools sharing a prefix such as `browser`), sorted so it reads the same however the tools were registered and the agent's prompt cache keeps matching; the agent looks a tool up and reads its input only when it wants it, and `call_tool` runs the real tool in the turn, so the chat shows that tool and never the catalog steps.

ChatGPT — Codex agent: Moxxy's tools now reach Codex as that catalog. Lent one by one, their full descriptions went with every request Codex made, tens of thousands of tokens once the person's MCP servers were set up. Codex's own tools, skills and MCP servers are unchanged.

Claude Agent: Moxxy's tools now reach Claude as that catalog too. Claude listed every one of them by name in each request, hundreds once the person's MCP servers were set up. Claude's own tools, skills and MCP servers are unchanged.
