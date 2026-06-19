---
title: '@moxxy/plugin-mcp'
description: Wire Model Context Protocol servers into a moxxy session as `mcp__server__tool`.
---

`@moxxy/plugin-mcp` lets a moxxy session host any number of MCP servers
(stdio, SSE, streamable-HTTP). Each server's tools surface as
`mcp__<server>__<tool>` in the agent's tool list.

## Install

```sh
pnpm add @moxxy/plugin-mcp @modelcontextprotocol/sdk
```

## Build

```ts
import { createMcpPlugin } from '@moxxy/plugin-mcp';

const plugin = await createMcpPlugin({
  servers: [
    { name: 'filesystem', kind: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
  ],
});
session.pluginHost.registerStatic(plugin);
```

In a normal moxxy install you don't construct this yourself — the CLI's
setup reads `~/.moxxy/mcp.json` and builds it for you. See the
[MCP servers guide](../guides/mcp-servers.md).

## Admin

`buildMcpAdminPlugin(...)` contributes the agent-facing admin tools:

| Tool | Purpose |
|---|---|
| `mcp_list_servers` | List registered servers + connection details. |
| `mcp_add_server` | Add + test a server. Writes `~/.moxxy/mcp.json`. |
| `mcp_test_server` | Re-probe a server; refresh cached tool descriptors. |
| `mcp_remove_server` | Drop a server from the catalog. |

The CLI exposes the read-only / disable / remove operations as
`moxxy mcp list|enable|disable|remove|path`.

## Server kinds

| Kind | Shape |
|---|---|
| `stdio` (default) | `{ command, args?, env? }` — spawns a process. |
| `sse` | `{ kind: 'sse', url }` — Server-Sent Events. |
| `streamable-http` | `{ kind: 'streamable-http', url }` — streaming HTTP. |

## Tool wrapping

`wrapMcpServerTools` adapts each MCP tool descriptor to a `ToolDef`.
Names are prefixed via `defaultToolNamePrefix(server, tool)` →
`mcp__server__tool`. Override with `toolNamePrefix` if you need
something else.

Every wrapped call is bounded by a 5-minute timeout
(`MCP_CALL_TIMEOUT_MS`) — the upstream MCP SDK's `callTool` doesn't
accept an `AbortSignal`, so without the timeout a hung server would
freeze the agent's loop.

## Storage

```
~/.moxxy/mcp.json
```

Catalog file. Holds server entries + a `cachedTools` array per server so
help screens and `/tools` listings reflect the real surface without
re-probing every server on startup.
