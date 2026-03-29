# moxxy-runtime

Agentic execution engine -- the core loop that drives LLM-powered agents.

## Overview

Implements the async agentic loop that orchestrates agent-LLM interactions, manages tool execution, handles multi-agent coordination, and provides a registry of 80+ primitives. This is the heart of Moxxy.

## Key Components

### Primitive Trait & Registry

```rust
pub trait Primitive: Send + Sync {
    fn name(&self) -> &str;
    async fn invoke(&self, params: Value) -> Result<Value, PrimitiveError>;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> Value;
}
```

`PrimitiveRegistry` manages primitives with allowlist-based access control and generates LLM-compatible tool schemas.

### Provider Trait

```rust
pub trait Provider: Send + Sync {
    async fn complete(messages, config, tools) -> Result<ProviderResponse, PrimitiveError>;
    async fn complete_stream(...) -> Result<Stream<StreamEvent>, PrimitiveError>;
}
```

Implementations: `AnthropicProvider`, `OpenAIProvider`, `ClaudeCliProvider`, `EchoProvider`.

### RunExecutor (Agentic Loop)

1. Build conversation: system prompt + history + task
2. Loop until completion:
   - Call `provider.complete_stream()` with retry logic
   - If tool calls: invoke primitives, push results into conversation
   - If events pending: wait on EventBus, dispatch to listeners
   - If reply primitive called or no more actions: break
3. Auto-persist short-term memory, emit RunCompleted event

Includes stuck detection (repeated empty responses / identical tool calls) and cancellation support.

### Agent Kinds

| Kind | Description |
|---|---|
| `StandardAgentKind` | Persistent user-created agents with full capabilities |
| `EphemeralAgentKind` | Temporary spawned agents (not persisted) |
| `HiveWorkerAgentKind` | Worker agents in a hive swarm |

Each kind implements `AgentKindDefinition` -- controls path resolution, primitive registration, and cleanup.

### Primitives (~80+)

| Category | Primitives |
|---|---|
| Filesystem | read, write, list, remove, cd (workspace-scoped via PathPolicy) |
| Git | init, clone, status, commit, push, checkout, pr_create, fork, worktree_add/list/remove |
| Shell | exec (command allowlist, 300s timeout) |
| HTTP | request (domain allowlist, 30s timeout) |
| Browse | fetch (HTTP+CSS selector), extract (HTML parsing) |
| Memory LTM | store, recall (DB-backed with 384-dim embeddings) |
| Memory STM | read, write (YAML-based, auto-persisted) |
| Skills | create, validate, list, find, get, execute, remove |
| Vault | set, get, delete, list |
| Webhooks | register, listen, update, rotate, delete, list |
| Heartbeat | create, list, disable, delete, update |
| Channels | notify (via ChannelBridge) |
| Notifications | cli_notify |
| Ask/Reply | user.ask (blocks via oneshot), agent.respond, reply (terminates loop) |
| Agent mgmt | spawn, status, list, stop, dismiss, self_get/update, persona_read/write |
| Allowlists | list, add, remove, deny, undeny |
| Hive | recruit, task_create, assign, aggregate, resolve_proposal, disband, signal, board_read, task_list/claim/complete/fail, propose, vote, review |
| MCP | connect, disconnect, list (+ dynamic McpTool per server tool) |
| Config | get, set |

### Event Listeners

- `AgentEventListener` -- tracks spawned child agents, injects status notifications
- `HiveEventListener` -- coordinates hive swarm tasks and proposals

## Dependencies

- `moxxy-types` -- domain types and traits
- `moxxy-storage` -- persistence layer
- `moxxy-core` -- services (EventBus, PathPolicy, SkillLoader, etc.)
- `moxxy-vault` -- secret resolution for primitives
- `moxxy-mcp` -- MCP server management
