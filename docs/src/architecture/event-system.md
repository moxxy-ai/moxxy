# Event System

The event system is the observability backbone of Moxxy. Every significant action -- from a run starting to a primitive completing to a security violation -- produces an event that flows through the `EventBus` and is available via SSE streaming and audit persistence.

## EventBus

The `EventBus` is a `tokio::sync::broadcast` channel wrapper. It provides pub/sub semantics: any number of subscribers receive a copy of every emitted event.

```rust
// Create a bus with a capacity of 1024 buffered events
let bus = EventBus::new(1024);

// Subscribe (returns a broadcast::Receiver)
let mut rx = bus.subscribe();

// Emit an event (non-blocking, drops if no subscribers)
bus.emit(envelope);

// Receive
let event = rx.recv().await?;
```

Key behaviors:

- **Non-blocking emit**: If no subscribers exist, the event is silently dropped
- **Cloneable**: Cloning the bus shares the underlying channel; subscribers on any clone receive all events
- **Lagged subscribers**: If a subscriber falls behind the buffer, it receives a `Lagged(n)` error and can resume from the current position

## EventEnvelope

Every event is wrapped in an `EventEnvelope`:

```rust
pub struct EventEnvelope {
    pub event_id: String,       // UUID v7 (time-ordered)
    pub ts: i64,                // Unix timestamp in milliseconds
    pub agent_id: String,       // Owning agent
    pub run_id: Option<String>, // Associated run (if any)
    pub parent_run_id: Option<String>,  // Parent run for sub-agents
    pub sequence: u64,          // Monotonic sequence within a run
    pub event_type: EventType,  // One of 60 variants
    pub payload: Value,         // Event-specific JSON data
    pub redactions: Vec<String>,// JSON paths that were redacted
    pub sensitive: bool,        // True if redactions were applied
}
```

IDs use UUID v7 for time-ordered uniqueness. Timestamps are millisecond-precision Unix time.

## Event Types

All 60 event types use dot-notation serialization:

| Category | Event Type | Description |
|----------|-----------|-------------|
| **Run** | `run.started` | Agent run has begun |
| | `run.completed` | Run finished successfully |
| | `run.failed` | Run encountered a fatal error |
| | `run.queued` | Run added to the execution queue |
| | `run.dequeued` | Run removed from the queue and starting |
| **Message** | `message.delta` | Streaming token chunk from LLM |
| | `message.final` | Complete LLM response |
| **Model** | `model.request` | Request sent to LLM provider |
| | `model.response` | Response received from LLM provider |
| **Skill** | `skill.invoked` | Skill execution started |
| | `skill.completed` | Skill execution finished |
| | `skill.failed` | Skill execution failed |
| **Primitive** | `primitive.invoked` | Primitive called with parameters |
| | `primitive.completed` | Primitive returned successfully |
| | `primitive.failed` | Primitive returned an error |
| **Memory** | `memory.read` | Memory entry read |
| | `memory.write` | Memory entry written |
| | `memory.compact_started` | Memory compaction pipeline began |
| | `memory.compact_completed` | Memory compaction pipeline finished |
| **Vault** | `vault.requested` | Agent requested a secret |
| | `vault.granted` | Secret access was granted |
| | `vault.denied` | Secret access was denied |
| **Heartbeat** | `heartbeat.triggered` | Heartbeat rule fired |
| | `heartbeat.completed` | Heartbeat action completed |
| | `heartbeat.failed` | Heartbeat action failed |
| **Sub-agent** | `subagent.spawned` | Child agent created |
| | `subagent.completed` | Child agent finished |
| | `subagent.failed` | Child agent failed |
| | `subagent.ask_question` | Child agent asked a question to parent |
| **Security** | `security.violation` | Security policy violated |
| | `sandbox.denied` | Sandbox blocked an operation |
| **Channel** | `channel.message_received` | Inbound message from external channel |
| | `channel.message_sent` | Outbound message to external channel |
| | `channel.error` | Channel transport error |
| **User** | `user.ask_question` | Agent asked the user a question |
| | `user.ask_answered` | User answered an agent's question |
| **Agent** | `agent.alive` | Agent heartbeat alive signal |
| | `agent.stuck` | Agent detected as stuck |
| | `agent.nudged` | Agent was nudged to resume |
| **Webhook** | `webhook.received` | Inbound webhook received |
| | `webhook.action_completed` | Webhook action completed successfully |
| | `webhook.action_failed` | Webhook action failed |
| **Hive** | `hive.created` | Hive was created |
| | `hive.disbanded` | Hive was disbanded |
| | `hive.member_joined` | Agent joined a hive |
| | `hive.signal_posted` | Signal posted to hive |
| | `hive.task_created` | Task created in hive |
| | `hive.task_claimed` | Task claimed by a hive member |
| | `hive.task_completed` | Hive task completed |
| | `hive.task_failed` | Hive task failed |
| | `hive.proposal_created` | Proposal created in hive |
| | `hive.proposal_resolved` | Hive proposal resolved |
| | `hive.vote_cast` | Vote cast on a hive proposal |
| **Task** | `task.analyzed` | Task analysis completed |
| **MCP** | `mcp.connected` | MCP server connection established |
| | `mcp.disconnected` | MCP server disconnected |
| | `mcp.connection_failed` | MCP server connection failed |
| | `mcp.tool_invoked` | MCP tool invocation started |
| | `mcp.tool_completed` | MCP tool invocation completed |
| | `mcp.tool_failed` | MCP tool invocation failed |

## RedactionEngine

The `RedactionEngine` scrubs secret values from event payloads before they are stored or streamed. It walks the JSON tree recursively, replacing any string value that matches a known secret with `[REDACTED]`, and records the JSON paths where redactions occurred.

```rust
let secrets = vec!["sk-abc123".to_string()];
let payload = json!({"api_key": "sk-abc123", "result": "ok"});

let (redacted, paths) = RedactionEngine::redact(payload, &secrets);
// redacted = {"api_key": "[REDACTED]", "result": "ok"}
// paths = ["api_key"]
```

Redaction is applied:
- Before persisting events to the `event_audit` table
- Before streaming events via SSE to subscribers

The `sensitive` field on the envelope is set to `true` whenever any redactions were applied.

## Event Persistence

The gateway spawns a background task that subscribes to the `EventBus` and writes every event to the `event_audit` table:

1. Receive event from broadcast channel
2. Load known secret values (for redaction)
3. Apply `RedactionEngine` to the payload
4. Serialize the event type and redacted payload
5. Insert an `EventAuditRow` into the database

The persistence task handles subscriber lag gracefully, logging warnings without crashing.

## SSE Streaming

Clients connect to `GET /v1/events/stream` to receive a Server-Sent Events stream. Query parameters allow filtering:

| Parameter | Effect |
|-----------|--------|
| `agent_id` | Only events for this agent |
| `run_id` | Only events for this run |
| (none) | All events |

Each SSE message is a JSON-serialized `EventEnvelope`:

```
data: {"event_id":"019cac...","ts":1709337600000,"event_type":"run.started",...}

data: {"event_id":"019cac...","ts":1709337600100,"event_type":"primitive.invoked",...}
```

## Audit Log API

Historical events can be queried via the audit log endpoint:

```
GET /v1/audit-logs?agent_id=...&event_type=...&limit=50&offset=0
```

This queries the `event_audit` table with pagination support, returning stored events including any redaction metadata.
