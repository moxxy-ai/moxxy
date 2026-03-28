# Events & SSE

Moxxy provides real-time event streaming via Server-Sent Events (SSE) and historical event queries via the audit log API.

## SSE Stream

### Endpoint

```
GET /v1/events/stream
```

**Required scope**: `events:read`

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent_id` | string | Filter events by agent ID |
| `run_id` | string | Filter events by run ID |

Both parameters are optional. Without filters, all events are streamed.

### Connection

```bash
curl -N http://localhost:3000/v1/events/stream?agent_id=019cac12 \
  -H "Authorization: Bearer $MOXXY_TOKEN"
```

Each event is delivered as an SSE `data:` line:

```
data: {"event_id":"019cac13-...","ts":1709337600000,"agent_id":"019cac12-...","run_id":"019cac13-...","event_type":"run.started","payload":{},"sensitive":false}

data: {"event_id":"019cac13-...","ts":1709337600100,"agent_id":"019cac12-...","run_id":"019cac13-...","event_type":"primitive.invoked","payload":{"name":"fs.read","params":{"path":"src/main.rs"}},"sensitive":false}
```

### EventEnvelope Schema

Every event follows this structure:

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | string | UUID v7 (time-ordered) |
| `ts` | integer | Unix timestamp in milliseconds |
| `agent_id` | string | Owning agent ID |
| `run_id` | string? | Associated run ID (null for non-run events) |
| `parent_run_id` | string? | Parent run ID for sub-agent events |
| `sequence` | integer | Monotonic sequence within a run |
| `event_type` | string | Dot-notation event type |
| `payload` | object | Event-specific data |
| `redactions` | string[] | JSON paths where secrets were scrubbed |
| `sensitive` | boolean | True if any redactions were applied |

## All Event Types

### Run Lifecycle

| Event | Payload | Description |
|-------|---------|-------------|
| `run.started` | `{}` | Agent run has begun |
| `run.completed` | `{}` | Run finished successfully |
| `run.failed` | `{"error": "..."}` | Run encountered a fatal error |
| `run.queued` | `{"position": N}` | Run added to the execution queue |
| `run.dequeued` | `{}` | Run removed from the queue and starting |

### Messages

| Event | Payload | Description |
|-------|---------|-------------|
| `message.delta` | `{"content": "..."}` | Streaming token chunk from LLM |
| `message.final` | `{"content": "..."}` | Complete final LLM response |

### Model

| Event | Payload | Description |
|-------|---------|-------------|
| `model.request` | `{"messages_count": N}` | Request sent to LLM provider |
| `model.response` | `{"content_length": N, "tool_calls_count": N}` | Response received from LLM |

### Skills

| Event | Payload | Description |
|-------|---------|-------------|
| `skill.invoked` | `{"skill_id": "...", "name": "..."}` | Skill execution started |
| `skill.completed` | `{"skill_id": "..."}` | Skill execution finished |
| `skill.failed` | `{"skill_id": "...", "error": "..."}` | Skill execution failed |

### Primitives

| Event | Payload | Description |
|-------|---------|-------------|
| `primitive.invoked` | `{"name": "fs.read", "params": {...}}` | Primitive called |
| `primitive.completed` | `{"name": "fs.read", "result": {...}}` | Primitive succeeded |
| `primitive.failed` | `{"name": "fs.read", "error": "..."}` | Primitive errored |

### Memory

| Event | Payload | Description |
|-------|---------|-------------|
| `memory.read` | `{"query": "...", "results_count": N}` | Memory search executed |
| `memory.write` | `{"path": "...", "tags": [...]}` | Memory entry written |
| `memory.compact_started` | `{"message": "..."}` | Compaction pipeline started |
| `memory.compact_completed` | `{"entries_compacted": N}` | Compaction finished |

### Vault

| Event | Payload | Description |
|-------|---------|-------------|
| `vault.requested` | `{"key_name": "...", "agent_id": "..."}` | Secret access requested |
| `vault.granted` | `{"key_name": "..."}` | Secret access granted |
| `vault.denied` | `{"key_name": "...", "reason": "..."}` | Secret access denied |

### Heartbeat

| Event | Payload | Description |
|-------|---------|-------------|
| `heartbeat.triggered` | `{"heartbeat_id": "...", "action_type": "..."}` | Heartbeat rule fired |
| `heartbeat.completed` | `{"heartbeat_id": "...", "message": "..."}` | Action completed |
| `heartbeat.failed` | `{"heartbeat_id": "...", "error": "..."}` | Action failed |

### Sub-agents

| Event | Payload | Description |
|-------|---------|-------------|
| `subagent.spawned` | `{"parent_id": "...", "child_id": "..."}` | Sub-agent created |
| `subagent.completed` | `{"child_id": "...", "result": "..."}` | Sub-agent finished |
| `subagent.failed` | `{"child_id": "...", "error": "..."}` | Sub-agent failed |
| `subagent.ask_question` | `{"child_id": "...", "question": "..."}` | Sub-agent asked a question to parent |

### Security

| Event | Payload | Description |
|-------|---------|-------------|
| `security.violation` | `{"type": "...", "path": "..."}` | Security policy violated |
| `sandbox.denied` | `{"command": "...", "profile": "..."}` | Sandbox blocked an operation |

### Channels

| Event | Payload | Description |
|-------|---------|-------------|
| `channel.message_received` | `{"channel_id": "...", "content": "..."}` | Inbound message |
| `channel.message_sent` | `{"channel_id": "...", "content": "..."}` | Outbound message |
| `channel.error` | `{"channel_id": "...", "error": "..."}` | Transport error |

### User

| Event | Payload | Description |
|-------|---------|-------------|
| `user.ask_question` | `{"question": "...", "run_id": "..."}` | Agent asked the user a question |
| `user.ask_answered` | `{"answer": "...", "run_id": "..."}` | User answered an agent's question |

### Agent

| Event | Payload | Description |
|-------|---------|-------------|
| `agent.alive` | `{"agent_id": "..."}` | Agent heartbeat alive signal |
| `agent.stuck` | `{"agent_id": "...", "reason": "..."}` | Agent detected as stuck |
| `agent.nudged` | `{"agent_id": "..."}` | Agent was nudged to resume |

### Webhooks

| Event | Payload | Description |
|-------|---------|-------------|
| `webhook.received` | `{"webhook_id": "...", "payload": {...}}` | Inbound webhook received |
| `webhook.action_completed` | `{"webhook_id": "...", "result": "..."}` | Webhook action completed successfully |
| `webhook.action_failed` | `{"webhook_id": "...", "error": "..."}` | Webhook action failed |

### Hive

| Event | Payload | Description |
|-------|---------|-------------|
| `hive.created` | `{"hive_id": "...", "name": "..."}` | Hive was created |
| `hive.disbanded` | `{"hive_id": "..."}` | Hive was disbanded |
| `hive.member_joined` | `{"hive_id": "...", "agent_id": "..."}` | Agent joined a hive |
| `hive.signal_posted` | `{"hive_id": "...", "signal": "..."}` | Signal posted to hive |
| `hive.task_created` | `{"hive_id": "...", "task_id": "..."}` | Task created in hive |
| `hive.task_claimed` | `{"hive_id": "...", "task_id": "...", "agent_id": "..."}` | Task claimed by a hive member |
| `hive.task_completed` | `{"hive_id": "...", "task_id": "..."}` | Hive task completed |
| `hive.task_failed` | `{"hive_id": "...", "task_id": "...", "error": "..."}` | Hive task failed |
| `hive.proposal_created` | `{"hive_id": "...", "proposal_id": "..."}` | Proposal created in hive |
| `hive.proposal_resolved` | `{"hive_id": "...", "proposal_id": "...", "outcome": "..."}` | Hive proposal resolved |
| `hive.vote_cast` | `{"hive_id": "...", "proposal_id": "...", "agent_id": "..."}` | Vote cast on a hive proposal |

### Task

| Event | Payload | Description |
|-------|---------|-------------|
| `task.analyzed` | `{"task_id": "...", "result": {...}}` | Task analysis completed |

### MCP

| Event | Payload | Description |
|-------|---------|-------------|
| `mcp.connected` | `{"server": "...", "protocol_version": "..."}` | MCP server connection established |
| `mcp.disconnected` | `{"server": "...", "reason": "..."}` | MCP server disconnected |
| `mcp.connection_failed` | `{"server": "...", "error": "..."}` | MCP server connection failed |
| `mcp.tool_invoked` | `{"server": "...", "tool": "...", "params": {...}}` | MCP tool invocation started |
| `mcp.tool_completed` | `{"server": "...", "tool": "...", "result": {...}}` | MCP tool invocation completed |
| `mcp.tool_failed` | `{"server": "...", "tool": "...", "error": "..."}` | MCP tool invocation failed |

## Audit Log API

Query historical events from the database:

```
GET /v1/audit-logs
```

**Required scope**: `events:read`

**Query parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agent_id` | string | -- | Filter by agent |
| `event_type` | string | -- | Filter by event type |
| `limit` | integer | 50 | Page size |
| `offset` | integer | 0 | Pagination offset |

**Response**:

```json
[
  {
    "event_id": "019cac13-...",
    "ts": 1709337600000,
    "agent_id": "019cac12-...",
    "event_type": "run.started",
    "payload_json": "{}",
    "sensitive": false,
    "created_at": "2026-03-02T12:00:00Z"
  }
]
```

## CLI Usage

```bash
# Stream all events
moxxy events tail

# Filter by agent
moxxy events tail --agent <agent-id>

# Filter by run
moxxy events tail --agent <agent-id> --run <run-id>

# JSON output
moxxy events tail --agent <agent-id> --json
```
