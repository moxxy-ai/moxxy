# Crate Overview

Moxxy is organized as a Rust workspace with 10 crates, each with a clear responsibility boundary. Crate dependencies flow strictly downward -- no circular dependencies exist.

## Dependency Graph

```
                   moxxy-gateway
                   /      |      \
                  /       |       \
         moxxy-core  moxxy-vault  moxxy-runtime
              |    \      |       /    |     \
              |     \     |      /     |      \
         moxxy-storage   moxxy-channel |    moxxy-mcp
              |                        |
              |                   moxxy-plugin
              |
         moxxy-test-utils
              |
         moxxy-types
```

## Crate Details

### moxxy-types

**Shared types, enums, and error definitions.**

This is the leaf crate with no workspace dependencies. It defines the core vocabulary used across all other crates:

- `EventType` -- 60 event type variants with dot-notation serialization (e.g., `run.started`)
- `EventEnvelope` -- The standard event wrapper with UUID v7 IDs and millisecond timestamps
- `TokenScope` -- 9 permission scopes (`agents:read`, `agents:write`, `runs:write`, etc.)
- `TokenStatus` -- Active / Revoked states
- `AgentStatus` -- Idle / Running / Stopped / Error lifecycle states
- `SkillStatus` -- Quarantined / Approved / Rejected
- `HeartbeatActionType` -- NotifyCli / NotifyWebhook / ExecuteSkill
- `ChannelType` -- Telegram / Discord
- Error types: `TokenError`, `SpawnError`, `PathPolicyError`, `StorageError`, `VaultError`, `HeartbeatError`, `SkillDocError`, `ChannelError`

All types derive `Serialize`/`Deserialize` for JSON transport.

### moxxy-test-utils

**Test infrastructure shared across the workspace.**

Provides `TestDb` -- an in-memory SQLite database with all migrations applied. Used by every crate's test suite to get a clean database instance per test.

Dependencies: `rusqlite`, `moxxy-types`

### moxxy-storage

**SQLite data access layer.**

Wraps rusqlite with a `Database` struct that provides typed DAO (Data Access Object) accessors. Contains:

- **12 DAOs**: `TokenDao`, `AgentDao`, `MemoryDao`, `VaultRefDao`, `VaultGrantDao`, `EventAuditDao`, `ChannelDao`, `ChannelBindingDao`, `ChannelPairingDao`, `WebhookDeliveryDao`, `ConversationDao`, `AllowlistDao`
- **17 row types** in `rows.rs`: One struct per table, mirroring the SQL schema exactly
- **Fixtures** (`fixtures.rs`): Test data factories used in storage-layer tests

The `Database` struct is the single entry point:

```rust
let db = Database::new(conn);
let agents = db.agents().list_all()?;
let token = db.tokens().find_by_hash(&hash)?;
```

Dependencies: `rusqlite`, `moxxy-types`

### moxxy-core

**Domain logic and business rules.**

Contains the core services that operate on storage through DAOs:

| Module | Exports | Purpose |
|--------|---------|---------|
| `auth` | `ApiTokenService`, `IssuedToken` | Token issuance, SHA-256 hashing, verification, scope checking |
| `agents` | `AgentLineage` | Sub-agent depth/total limit enforcement |
| `events` | `EventBus`, `RedactionEngine` | Broadcast-based event distribution, secret scrubbing |
| `heartbeat` | `HeartbeatRule`, `HeartbeatScheduler` | Interval/cron scheduling, next-run computation |
| `memory` | `MemoryJournal`, `MemoryCompactor`, `EmbeddingService` | Memory append/search, compaction pipeline, vector embedding |
| `security` | `PathPolicy` | Workspace boundary enforcement, symlink escape detection |
| `skills` | `SkillDoc` | YAML frontmatter parsing, validation |

Dependencies: `moxxy-types`, `moxxy-storage`, `moxxy-test-utils` (dev), `sha2`, `tokio`, `chrono`

### moxxy-vault

**Secret management with pluggable backends.**

Provides a `SecretBackend` trait with two implementations:

- `InMemoryBackend` -- For testing; stores secrets in a `HashMap`
- `KeyringBackend` -- Production backend using the OS keychain (macOS Keychain, Linux secret-service)

The `VaultService` ties the backend to the database:

```rust
let service = VaultService::new(backend, conn);
service.create_secret_ref("my-api-key", "backend-key", Some("production"))?;
service.store_secret("backend-key", "sk-abc123")?;
service.grant_access("agent-1", &secret_ref.id)?;
let value = service.resolve("agent-1", &secret_ref.id)?;
```

Access is denied unless an explicit, non-revoked grant exists for the requesting agent.

Dependencies: `moxxy-types`, `moxxy-storage`, `keyring`

### moxxy-gateway

**Axum HTTP server with 50+ route handlers.**

The main entry point for the REST API and SSE event stream. Key components:

- `create_router()` -- Builds the full Axum router with CORS, rate limiting, tracing, and body limits
- `AppState` -- Holds `Arc<Mutex<Database>>`, `EventBus`, `RunService`, vault backend, and channel bridge
- `auth_extractor` -- Middleware that validates Bearer tokens against the database
- `rate_limit` -- `tower-governor` based rate limiting with per-token and per-IP bucketing
- `run_service` -- Orchestrates run lifecycle: start, stop, event emission
- Route modules: `auth`, `agents`, `providers`, `heartbeats`, `skills`, `vault`, `events`, `channels`, `webhooks`, `health`, `audit`

The gateway also spawns four background tasks:
- **Event persistence** -- Subscribes to EventBus and writes every event to `event_audit` after applying RedactionEngine
- **Heartbeat loop** -- Polls for due heartbeat rules every 30 seconds and dispatches actions
- **Health check loop** -- Periodically verifies system component health
- **Run queue drain loop** -- Processes queued runs and dispatches them for execution

Dependencies: `moxxy-types`, `moxxy-storage`, `moxxy-core`, `moxxy-vault`, `moxxy-runtime`, `moxxy-channel`, `axum`, `tower-http`, `tower-governor`

### moxxy-runtime

**Agent execution engine with 85 primitives.**

Contains the `Provider` trait (LLM abstraction), `Primitive` trait (tool abstraction), and `PrimitiveRegistry` (dispatch with allowlist enforcement).

**Provider implementations:**
- `AnthropicProvider` -- Anthropic Claude API endpoint
- `OpenAIProvider` -- Any OpenAI-compatible API endpoint

**Primitive categories:**

| Category | Primitives |
|----------|-----------|
| Filesystem | `fs.read`, `fs.write`, `fs.list`, `fs.remove`, `fs.cd` |
| Shell | `shell.exec` |
| HTTP | `http.request` |
| Memory | `memory.store`, `memory.recall`, `memory.stm_read`, `memory.stm_write` |
| Git | `git.init`, `git.clone`, `git.status`, `git.checkout`, `git.commit`, `git.push`, `git.fork`, `git.pr_create`, `git.worktree_add`, `git.worktree_list`, `git.worktree_remove` |
| Browse | `browse.fetch`, `browse.extract` |
| Skills | `skill.create`, `skill.validate`, `skill.list`, `skill.find`, `skill.get`, `skill.execute`, `skill.remove` |
| Webhooks | `webhook.register`, `webhook.list`, `webhook.delete`, `webhook.update`, `webhook.rotate`, `webhook.listen` |
| Notifications | `notify.cli`, `notify.channel` |
| Heartbeat | `heartbeat.create`, `heartbeat.list`, `heartbeat.disable`, `heartbeat.delete`, `heartbeat.update` |
| Vault | `vault.set`, `vault.get`, `vault.delete`, `vault.list` |
| Ask | `user.ask`, `agent.respond` |
| Agent | `agent.spawn`, `agent.status`, `agent.list`, `agent.stop`, `agent.dismiss` |
| Agent.self | `agent.self.get`, `agent.self.update`, `agent.self.persona_read`, `agent.self.persona_write` |
| Allowlist | `allowlist.list`, `allowlist.add`, `allowlist.remove`, `allowlist.deny`, `allowlist.undeny` |
| Config | `config.get`, `config.set` |
| MCP | `mcp.list`, `mcp.connect`, `mcp.disconnect` |
| Hive | `hive.create`, `hive.recruit`, `hive.task_create`, `hive.assign`, `hive.aggregate`, `hive.resolve_proposal`, `hive.disband`, `hive.signal`, `hive.board_read`, `hive.task_list`, `hive.task_claim`, `hive.task_complete`, `hive.task_fail`, `hive.task_review`, `hive.propose`, `hive.vote` |

**Other components:**
- `SandboxProfile` -- Strict / Standard / None sandboxing for shell commands
- `SandboxedCommand` -- Builds platform-specific sandbox wrappers (macOS `sandbox-exec`, Linux `bwrap`)
- `AgentProcess` -- Manages the agent's execution lifecycle
- `RunExecutor` -- Drives the provider-tool loop for a single run
- `PrimitiveContext` -- Holds per-invocation context (agent ID, workspace, vault, etc.)

Dependencies: `moxxy-types`, `moxxy-core`, `moxxy-storage`, `moxxy-vault`, `tokio`, `async-trait`

### moxxy-channel

**Messaging channel bridges for Telegram and Discord.**

Provides an abstraction layer over external messaging platforms:

- `ChannelTransport` trait -- Send/receive messages
- `TelegramTransport` -- Telegram Bot API integration
- `DiscordTransport` -- Discord bot integration
- `ChannelBridge` -- Routes messages between channels and agents
- `PairingService` -- 6-digit pairing code workflow for binding chats to agents

Dependencies: `moxxy-types`, `moxxy-storage`

### moxxy-plugin

**WASI plugin hosting with signature verification.**

Hosts provider plugins as WebAssembly modules using Wasmtime:

- `PluginManifest` -- YAML manifest defining provider ID, WASM path, fuel/memory limits, allowed domains
- `WasmHost` -- Configures Wasmtime engine with fuel and memory limits
- `WasmInstance` -- Runs a WASM module with WASI capabilities
- `WasmProvider` -- Implements the `Provider` trait by delegating to a WASM guest
- `SignatureVerifier` -- Ed25519 signature verification for plugin integrity
- `PluginRegistry` -- Manages loaded plugins

Dependencies: `wasmtime`, `wasmtime-wasi`, `ed25519-dalek`, `serde_yaml`

### moxxy-mcp

**Model Context Protocol integration.**

Provides MCP client support for connecting to external tool servers:

- `McpManager` -- Manages multiple MCP server connections
- `McpClient` -- Individual server connection (stdio, SSE, streamable_http transports)
- Dynamic tool discovery and invocation via `mcp.<server_id>.<tool_name>` primitives

Dependencies: `moxxy-types`, `tokio`, `serde_json`
