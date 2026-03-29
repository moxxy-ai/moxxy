# moxxy-types

Shared type definitions, enums, error types, and traits for the Moxxy workspace.

## Overview

This is the foundational crate that all other Moxxy crates depend on. It defines the domain vocabulary -- agent configuration, event types, auth scopes, channel types, MCP config, and error enums -- without any business logic or I/O.

## Key Exports

### Structs
- `AgentConfig` -- YAML-persisted agent configuration
- `AgentRuntime` -- in-memory representation of a registered agent
- `EventEnvelope` -- event with metadata (ID, timestamp, agent/run IDs, sequence, type, payload)
- `McpConfig` / `McpServerConfig` / `McpToolDefinition` -- MCP protocol configuration

### Enums
- `AgentStatus` -- Idle, Running, Stopped, Error
- `AgentType` -- Agent, Ephemeral, HiveWorker, Custom
- `HiveRole` -- Queen, Worker, Scout
- `AuthMode` -- Token, Loopback
- `TokenScope` -- AgentsRead, AgentsWrite, RunsWrite, VaultRead, VaultWrite, TokensAdmin, EventsRead, ChannelsRead, ChannelsWrite, Wildcard
- `EventType` -- 60 variants (run lifecycle, primitives, vault, heartbeat, hive, MCP, channels, etc.)
- `ChannelType` -- Telegram, Discord
- `MessageContent` -- Text, ToolInvocation, ToolResult, RunCompleted, SubagentSpawned, etc.
- `McpTransportType` -- Stdio, Sse, StreamableHttp

### Traits
- `RunStarter` -- async trait for triggering agent runs (`start_run`, `stop_agent`, `spawn_child`, `reset_session`, etc.)

### Error Types
`SpawnError`, `TokenError`, `ChannelError`, `PathPolicyError`, `StorageError`, `HeartbeatError`, `VaultError`, `SkillDocError`, `TemplateDocError`, `ProviderDocError`, `WebhookDocError`

## Dependencies

Minimal -- only serialization (`serde`, `serde_json`, `serde_yaml`), error handling (`thiserror`), async traits (`async-trait`), timestamps (`chrono`), and IDs (`uuid`).
