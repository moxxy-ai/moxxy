# Data Flow

This page traces how requests and agent runs flow through Moxxy's architecture.

## API Request Flow

Every API request follows the same path through the gateway:

```
Client (curl / CLI / TUI)
    |
    | HTTP request
    v
+-------------------+
|   Axum Router     |  Route matching
+-------------------+
    |
    v
+-------------------+
|   Rate Limiter    |  tower-governor: token bucket per key
+-------------------+  (429 if exceeded)
    |
    v
+-------------------+
|   CORS Layer      |  Allow-Origin: *
+-------------------+
    |
    v
+-------------------+
|   Auth Extractor  |  Hash Bearer token -> lookup in DB
+-------------------+  (401 if invalid/expired/revoked)
    |                  Check required scope
    v                  (403 if insufficient)
+-------------------+
|   Route Handler   |  Business logic
+-------------------+
    |
    v
+-------------------+
|   Database (DAO)  |  Read/write via SQLite
+-------------------+
    |
    v
+-------------------+
|   JSON Response   |  Serialized back to client
+-------------------+
```

### Auth Bypass

Two endpoints skip the auth extractor:
- `GET /v1/health` -- Always returns 200, exempt from rate limiting too
- `POST /v1/auth/tokens` -- When no tokens exist in the database (bootstrap mode)

## Agent Run Flow

When a run is started via `POST /v1/agents/{name}/runs`:

```
1. Gateway receives request
   |
   v
2. Auth check: token must have "runs:write" scope
   |
   v
3. Agent lookup: verify agent exists, status is "idle"
   |
   v
4. Status update: agent.status = "running"
   |
   v
5. RunExecutor spawns as async task
   |
   v
6. Event: run.started
   |
   +----------------------------------+
   |  Provider-Tool Loop              |
   |                                  |
   |  a. Build messages (system +     |
   |     conversation history)        |
   |                                  |
   |  b. Send to LLM provider         |
   |     Event: model.request         |
   |                                  |
   |  c. Receive response             |
   |     Event: model.response        |
   |     Event: message.delta (stream)|
   |                                  |
   |  d. If tool_calls present:       |
   |     For each tool_call:          |
   |       Event: primitive.invoked   |
   |       Check allowlist            |
   |       Execute primitive          |
   |       Event: primitive.completed |
   |         or primitive.failed      |
   |     Append results to messages   |
   |     Go to step (b)              |
   |                                  |
   |  e. If no tool_calls:            |
   |     Event: message.final         |
   |     Loop ends                    |
   +----------------------------------+
   |
   v
7. Status update: agent.status = "idle"
   |
   v
8. Event: run.completed (or run.failed)
```

### Run Cancellation

A run can be cancelled via `POST /v1/agents/{name}/stop`:

- A `CancellationToken` is checked at each iteration of the provider-tool loop
- If cancelled, the run exits with `run.failed` event
- A 5-minute timeout also triggers cancellation automatically

### Sub-agent Spawning

During a run, an agent can spawn sub-agents:

```
Parent Agent (depth=0)
    |
    | agent.spawn primitive
    v
AgentLineage check:
    - depth < max_subagent_depth (default 2)
    - spawned_total < max_subagents_total (default 8)
    |
    v
Child Agent (depth=1, parent_agent_id set)
    |
    | Event: subagent.spawned
    v
Child runs independently with its own RunExecutor
    |
    | Event: subagent.completed
    v
Result returned to parent's conversation
```

## Event Data Flow

Events flow through three parallel paths:

```
                    EventBus (broadcast)
                    /       |         \
                   /        |          \
    SSE Subscribers   Audit Persistence   Heartbeat Loop
    (GET /events/     (background task)   (30s interval)
     stream)          |
                      v
                 RedactionEngine
                      |
                      v
                 event_audit table
```

1. **SSE Subscribers**: Clients connected to the event stream receive events in real time, filtered by agent_id or run_id
2. **Audit Persistence**: A background task writes every event to the database after applying secret redaction
3. **Heartbeat Loop**: A background task checks every 30 seconds for due heartbeat rules and dispatches actions (which may emit more events)

## Vault Resolution Flow

When a primitive needs a secret (e.g., git operations needing a GitHub token):

```
Primitive invocation
    |
    v
PrimitiveContext.resolve_secret(agent_id, key_name)
    |
    v
VaultService.resolve(agent_id, secret_ref_id)
    |
    +-- Look up secret_ref by key_name
    |
    +-- Check vault_grants for (agent_id, secret_ref_id)
    |       where revoked_at IS NULL
    |
    +-- If no grant: VaultError::AccessDenied
    |       Event: vault.denied
    |
    +-- If granted: fetch material from backend
    |       Event: vault.granted
    |
    v
Secret value returned to primitive
```

## Database Access Pattern

All database access goes through `Arc<Mutex<Database>>`:

```rust
// In a route handler
let db = state.db.lock().unwrap();
let agents = db.agents().list_all()?;
```

The `Mutex` serializes all database operations, which is appropriate for SQLite's single-writer model. WAL (Write-Ahead Logging) mode is enabled for concurrent reads during writes.

Each DAO borrows the underlying `Connection` for the duration of its method call. DAOs are lightweight structs with a single `&Connection` field -- they are created on demand and not cached.
