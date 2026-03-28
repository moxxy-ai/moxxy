# Runs

A run represents a single task execution by an agent. The agent receives a task description, interacts with an LLM provider, invokes primitives as needed, and produces a result.

## Endpoints

### Start Run

```
POST /v1/agents/{name}/runs
```

**Required scope**: `runs:write`

**Request body**:

```json
{
  "task": "Refactor the authentication module for better testability"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | string | Yes | The task description for the agent |

**Response** (200 OK) -- started immediately:

```json
{
  "run_id": "019cac13-...",
  "agent_id": "019cac12-...",
  "status": "running"
}
```

**Response** (200 OK) -- queued:

```json
{
  "agent_id": "019cac12-...",
  "status": "queued",
  "queue_position": 3
}
```

**Response** (503 Service Unavailable) -- queue full:

```json
{
  "error": "queue_full"
}
```

**Preconditions**:
- Agent must exist
- If agent is idle, the run starts immediately
- If agent is running, the run is queued

**Events emitted**: `run.started`, `run.queued`

### Stop Run

```
POST /v1/agents/{name}/stop
```

**Required scope**: `runs:write`

Signals the running agent to stop. Uses a `CancellationToken` that is checked at each iteration of the provider-tool loop.

**Response** (200 OK):

```json
{
  "agent_id": "019cac12-...",
  "status": "stopped"
}
```

## Run Execution Flow

When a run is started, the gateway spawns a `RunExecutor` as an async task:

```
1. Set agent status to "running"
2. Emit run.started event
3. Build initial messages (system prompt + task)
4. Enter provider-tool loop:
   a. Send messages to LLM provider
      - Emit model.request
   b. Receive response
      - Emit model.response
      - Emit message.delta (for streaming responses)
   c. If response contains tool_calls:
      - For each tool call:
        - Emit primitive.invoked
        - Check primitive allowlist
        - Execute primitive
        - Emit primitive.completed or primitive.failed
      - Append tool results to messages
      - Go to step (a)
   d. If no tool_calls:
      - Emit message.final
      - Exit loop
5. Set agent status to "idle"
6. Emit run.completed
```

If an error occurs at any point:
- Agent status is set to `error`
- `run.failed` event is emitted with error details

## Run Queue

When a run request arrives and the agent is already running, the task is queued instead of being rejected.

- The queue is **per-agent**, **bounded at 50 entries**, and held **in-memory**.
- When the current run completes, the next queued run starts automatically.
- Queuing works for all run sources: API calls, webhooks, and heartbeats.
- If the queue is full (50 entries), the server returns **503 Service Unavailable** with `{"error": "queue_full"}`.

**Events**:

| Event | When |
|-------|------|
| `run.queued` | A run request was added to the queue |
| `run.dequeued` | A queued run was picked up and is about to start |

## Cancellation

Runs can be cancelled in two ways:

1. **Explicit stop**: `POST /v1/agents/{name}/stop` sets the cancellation token
2. **Timeout**: A 5-minute default timeout triggers automatic cancellation

The cancellation token is checked:
- Before each LLM provider call
- Before each primitive invocation
- Between iterations of the provider-tool loop

## Conversation Persistence

Each message exchange during a run is persisted to the `conversation_log` table:

```sql
CREATE TABLE conversation_log (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    role TEXT NOT NULL,          -- "user", "assistant", "tool"
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

This enables conversation recovery if a run is interrupted.

## CLI Usage

```bash
# Start a run (interactive)
moxxy agent run

# Start with flags
moxxy agent run --id <agent-id> --task "Write unit tests for the user module"

# Stop a running agent
moxxy agent stop --id <agent-id>

# Watch run events
moxxy events tail --agent <agent-id> --run <run-id>
```
