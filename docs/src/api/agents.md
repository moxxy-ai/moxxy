# Agents

Agents are the primary unit of work in Moxxy. Each agent is bound to a provider, a model, and a workspace directory.

## Agent Lifecycle

```
     create
       |
       v
    +------+     start_run     +---------+
    | Idle | ----------------> | Running |
    +------+                   +---------+
       ^                          |
       |    run completes         |    stop / error
       |    or run fails          |
       +--------------------------+
                                  |
                               +-------+
                               | Error |
                               +-------+
                                  |
                                  v
                              +---------+
                              | Stopped |
                              +---------+
```

Agent status values:

| Status | Description |
|--------|-------------|
| `idle` | Agent is created and ready to accept tasks |
| `running` | Agent is executing a run |
| `stopped` | Agent was explicitly stopped |
| `error` | Agent encountered a fatal error |

## Endpoints

### Create Agent

```
POST /v1/agents
```

**Required scope**: `agents:write`

**Request body**:

```json
{
  "provider_id": "anthropic",
  "model_id": "claude-sonnet-4-20250514",
  "workspace_root": "/home/user/my-project",
  "policy_profile": "standard",
  "temperature": 0.7,
  "max_subagent_depth": 2,
  "max_subagents_total": 8
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider_id` | string | Yes | -- | Installed provider ID |
| `model_id` | string | Yes | -- | Model identifier from provider |
| `workspace_root` | string | Yes | -- | Agent's working directory |
| `policy_profile` | string | No | null | Sandbox profile: `strict`, `standard`, or `none` |
| `temperature` | number | No | 0.7 | LLM temperature parameter |
| `max_subagent_depth` | integer | No | 2 | Maximum sub-agent nesting depth |
| `max_subagents_total` | integer | No | 8 | Maximum total sub-agents spawned |

**Response** (201 Created):

```json
{
  "id": "019cac12-abcd-7000-8000-123456789abc",
  "provider_id": "anthropic",
  "model_id": "claude-sonnet-4-20250514",
  "status": "idle",
  "workspace_root": "/home/user/my-project",
  "created_at": "2026-03-02T12:00:00Z"
}
```

### Get Agent

```
GET /v1/agents/{name}
```

**Required scope**: `agents:read`

Returns full agent details including status, configuration, and sub-agent metadata (depth, spawned_total).

### Update Agent

```
PATCH /v1/agents/{name}
```

**Required scope**: `agents:write`

Updates agent configuration fields.

### Delete Agent

```
DELETE /v1/agents/{name}
```

**Required scope**: `agents:write`

Deletes the agent.

### List Agents

```
GET /v1/agents
```

**Required scope**: `agents:read`

Returns all agents.

### Sub-Agent Spawning

Sub-agents are spawned at runtime via the `agent.spawn` primitive (not through a REST endpoint). The `AgentLineage` service enforces:

- **Depth limit**: child depth < parent's `max_subagent_depth`
- **Total limit**: parent's `spawned_total` < parent's `max_subagents_total`

If either limit is exceeded, the spawn fails with a `SpawnError`.

**Events emitted**: `subagent.spawned`

## Database Schema

```sql
CREATE TABLE agents (
    id TEXT PRIMARY KEY NOT NULL,
    parent_agent_id TEXT,           -- NULL for root agents
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    workspace_root TEXT NOT NULL,
    core_mount TEXT,                -- Optional read-only mount
    policy_profile TEXT,            -- Sandbox profile name
    temperature REAL DEFAULT 0.7,
    max_subagent_depth INTEGER DEFAULT 2,
    max_subagents_total INTEGER DEFAULT 8,
    status TEXT NOT NULL DEFAULT 'idle',
    depth INTEGER NOT NULL DEFAULT 0,
    spawned_total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id),
    FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
);
```

## CLI Usage

```bash
# Create agent (interactive wizard)
moxxy agent create

# Create with flags
moxxy agent create --provider anthropic --model claude-sonnet-4-20250514 --workspace ~/project

# Check status
moxxy agent status --id <agent-id>

# JSON output
moxxy agent status --id <agent-id> --json
```
