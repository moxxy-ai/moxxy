# moxxy-mcp

Model Context Protocol (MCP) client implementation for connecting agents to external tool servers.

## Overview

Implements the MCP 2025-03-26 specification over JSON-RPC 2.0, enabling agents to discover and invoke tools from external MCP servers. Supports three transport mechanisms and manages multiple concurrent server connections.

## Components

| Export | Description |
|---|---|
| `McpManager` | High-level manager for multiple server connections, tool routing, and config persistence |
| `McpClient` | Single-server client handling initialization handshake and tool calls |
| `McpTransport` | Trait for pluggable transport implementations |
| `StdioTransport` | Connects via spawned child process stdin/stdout |
| `SseTransport` | Connects via Server-Sent Events with HTTP POST for requests |
| `StreamableHttpTransport` | Modern HTTP transport with session tracking (MCP 2025-03-26) |

## Tool Naming

Tools are namespaced as `mcp.{server_id}.{tool_name}` to prevent collisions across servers.

## Connection Flow

1. Load config from `mcp.yaml` in agent directory
2. Create `McpManager` and optionally set vault resolver for `${vault:KEY}` references
3. `connect_all()` -- establish connections and run MCP handshake per server
4. `call_tool("mcp.server_id.tool_name", args)` -- route and execute
5. `shutdown_all()` -- graceful teardown

## Transport Details

- **Stdio** -- spawns child process, line-delimited JSON-RPC over stdin/stdout, 30s request timeout, graceful shutdown with 5s kill timeout
- **SSE** -- long-lived SSE connection for receiving, HTTP POST for sending, endpoint discovery via `endpoint` event
- **Streamable HTTP** -- independent POST per request, supports both JSON and SSE responses, session tracking via `Mcp-Session-Id`

All transports support `${vault:KEY}` syntax in environment variables and HTTP headers for secret resolution.

## Dependencies

- `tokio` -- async runtime and process spawning
- `reqwest` / `reqwest-eventsource` -- HTTP and SSE clients
- `moxxy-types` -- MCP config types and tool definitions
