---
name: add-mcp-server
description: Register a new Model Context Protocol (MCP) server with moxxy and author a usage skill for its tools.
triggers:
  - add mcp
  - new mcp
  - mcp server
  - hook up mcp
  - register mcp
  - install mcp
allowed-tools:
  - env_share
  - mcp_test_server
  - mcp_add_server
  - mcp_list_servers
  - synthesize_skill
---

When the user wants to add an MCP server, walk them through these steps:

1. **Gather the connection details**
   - Ask what KIND the server is:
     - `stdio` — a local executable (npm/uv package, custom script). Need `command`, optional `args`, `env`, `cwd`.
     - `http` or `sse` — a remote HTTP server. Need `url`, optional `headers` (for auth).
   - Ask what NAME to use. Must be slug-like (lowercase letters, digits, hyphens). The name prefixes every tool the server exposes — pick something short and recognizable (e.g. `canva`, `github`, `fs`).

   - For a missing credential call `env_share` with its name and purpose. Put the returned `${vault:NAME}` reference in the env or header field.

2. **Test the connection BEFORE persisting**
   - Call `mcp_test_server` with the gathered details.
   - On success, the result lists the tools the server exposes. Show them to the user.
   - On failure, report the error verbatim and ask the user how they want to proceed (different URL, different command, give up).

3. **Persist the server**
   - Once the user confirms, call `mcp_add_server` with the same arguments. This connects to the server, registers its tools into the live session (no restart needed), and writes to `~/.moxxy/mcp.json` so the entry survives across sessions.
   - The response includes a `tools` array — those names are now in the session's tool catalog with an `mcp__<server>__` prefix.

4. **Author a usage skill (optional but recommended)**
   - Offer to create a skill that documents how to use the new MCP's tools. This makes future invocations cleaner — the user can say "search canva for X" instead of remembering tool names.
   - If they accept, call `synthesize_skill` with an `intent` describing the common workflow. The skill body should mention the prefixed tool names (e.g. `mcp__canva__search_designs`) and a typical multi-step recipe.

5. **Confirm + summarize**
   - List what was done: connection tested, server attached + saved, skill created (if applicable).
   - The new tools are usable RIGHT NOW in this turn — you can demonstrate one if the user asks.

## Notes

- `mcp_list_servers` shows what's currently registered.
- `mcp_remove_server` removes a registration.
- The user might already have an entry in `~/.moxxy/mcp.json` — call `mcp_list_servers` first to check before suggesting a name.
