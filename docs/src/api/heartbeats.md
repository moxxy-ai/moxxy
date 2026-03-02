# Heartbeats

Heartbeats are scheduled rules that trigger periodic actions for an agent. They support both fixed-interval and cron-based scheduling.

## Concepts

A heartbeat rule defines:
- **Interval**: How often the action fires (in minutes)
- **Cron expression**: Optional cron schedule (overrides interval when set)
- **Action type**: What to do when the heartbeat fires
- **Timezone**: For cron expressions (default: UTC)

## Action Types

| Action Type | Description |
|-------------|-------------|
| `notify_cli` | Emit a `heartbeat.completed` event with a message (picked up by CLI SSE subscribers) |
| `notify_webhook` | Emit a `heartbeat.completed` event for webhook delivery |
| `execute_skill` | Start an agent run with `action_payload` as the task |
| `memory_compact` | Trigger memory compaction for the agent |

## Endpoints

### Create Heartbeat

```
POST /v1/agents/{id}/heartbeats
```

**Required scope**: `agents:write`

**Request body**:

```json
{
  "interval_minutes": 30,
  "action_type": "notify_cli",
  "action_payload": "Time for a status check"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `interval_minutes` | integer | Yes | Interval in minutes (minimum 1) |
| `action_type` | string | Yes | One of: `notify_cli`, `notify_webhook`, `execute_skill`, `memory_compact` |
| `action_payload` | string | No | Action-specific payload (task text for `execute_skill`) |

**Response** (201 Created):

```json
{
  "id": "019cac16-...",
  "agent_id": "019cac12-...",
  "interval_minutes": 30,
  "action_type": "notify_cli",
  "action_payload": "Time for a status check",
  "enabled": true,
  "next_run_at": "2026-03-02T12:30:00Z",
  "created_at": "2026-03-02T12:00:00Z"
}
```

### List Heartbeats

```
GET /v1/agents/{id}/heartbeats
```

**Required scope**: `agents:read`

Returns all heartbeat rules for the agent.

### Disable Heartbeat

```
DELETE /v1/agents/{id}/heartbeats/{heartbeat_id}
```

**Required scope**: `agents:write`

Disables the heartbeat rule (sets `enabled = false`).

## Scheduling

### Interval-Based

The simplest mode. After each trigger, `next_run_at` is advanced by `interval_minutes`:

```
next_run_at = max(current_time, previous_next_run_at) + interval_minutes
```

This prevents pile-up if the scheduler falls behind.

### Cron-Based

When a `cron_expr` is set, it takes priority over the interval. The `HeartbeatScheduler` computes the next run time from the cron expression with timezone awareness:

```rust
HeartbeatScheduler::compute_next_cron_run("0 */6 * * *", "America/New_York", now)
```

If the cron computation fails, it falls back to interval-based scheduling.

## Background Execution

The gateway spawns a heartbeat loop that runs every 30 seconds:

1. Query `heartbeats` table for rules where `next_run_at <= now` and `enabled = true`
2. For each due rule:
   - Emit `heartbeat.triggered` event
   - Dispatch based on `action_type`
   - Emit `heartbeat.completed` or `heartbeat.failed`
   - Advance `next_run_at` to the next scheduled time

## Events

| Event | When |
|-------|------|
| `heartbeat.triggered` | Heartbeat rule fires |
| `heartbeat.completed` | Action succeeded |
| `heartbeat.failed` | Action failed |

## Database Schema

```sql
CREATE TABLE heartbeats (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL CHECK (interval_minutes >= 1),
    action_type TEXT NOT NULL,
    action_payload TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT NOT NULL,
    cron_expr TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
```

## CLI Usage

```bash
# Set a heartbeat (interactive wizard)
moxxy heartbeat set --agent <agent-id>

# Set with flags
moxxy heartbeat set --agent <agent-id> --interval 60 --action_type notify_cli

# List heartbeats
moxxy heartbeat list --agent <agent-id>
```
