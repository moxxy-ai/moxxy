# Moxxy API Reference

The Moxxy gateway exposes a REST API defined contract-first in [`openapi/openapi.yaml`](../openapi/openapi.yaml). All endpoints require a Bearer token unless noted otherwise.

**Base URL:** `http://localhost:3000` (configurable via `MOXXY_API_URL`)

## Authentication

All requests must include a Bearer token in the `Authorization` header:

```
Authorization: Bearer mox_...
```

The bootstrap token creation endpoint is the only exception = it requires no auth on first use.

### Token Scopes

| Scope | Grants |
|---|---|
| `agents:read` | List and get agent details |
| `agents:write` | Create agents, spawn sub-agents |
| `runs:write` | Start and stop agent runs |
| `vault:read` | List secrets and grants |
| `vault:write` | Create secrets, manage grants |
| `tokens:admin` | Create, list, and revoke tokens |
| `events:read` | Stream SSE events, query audit logs |
| `channels:read` | List channels and bindings |
| `channels:write` | Create/delete channels, pair chats |

---

## Endpoints

### Auth = Tokens

```
POST   /v1/auth/tokens          Create API token (bootstrap: no auth on first use)
GET    /v1/auth/tokens          List tokens
DELETE /v1/auth/tokens/{id}     Revoke token
```

**Create token:**

```bash
curl -X POST http://localhost:3000/v1/auth/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "scopes": ["agents:read", "agents:write", "runs:write", "events:read"],
    "ttl_seconds": 86400,
    "description": "dev token"
  }'
```

Response includes the plaintext token (shown once) and the token ID. Tokens are stored as SHA-256 hashes = the plaintext is never persisted.

---

### Agents

```
GET    /v1/agents                   List all agents
POST   /v1/agents                   Create agent
GET    /v1/agents/{name}            Get agent details
PATCH  /v1/agents/{name}            Update agent
DELETE /v1/agents/{name}            Delete agent
POST   /v1/agents/{name}/runs       Start a run
POST   /v1/agents/{name}/stop       Stop a running agent
POST   /v1/agents/{name}/reset      Reset agent session
GET    /v1/agents/{name}/history    Get conversation history
```

**Create agent:**

```bash
curl -X POST http://localhost:3000/v1/agents \
  -H "Authorization: Bearer $MOXXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider_id": "anthropic",
    "model_id": "claude-sonnet-4-20250514",
    "workspace": "~/my-project"
  }'
```

**Start a run:**

```bash
curl -X POST http://localhost:3000/v1/agents/{name}/runs \
  -H "Authorization: Bearer $MOXXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task": "Refactor the auth module"}'
```

---

### Providers

```
GET    /v1/providers                List installed providers
POST   /v1/providers                Install provider with models
GET    /v1/providers/{id}/models    List available models
```

---

### Skills

```
POST   /v1/agents/{id}/skills/install                Install skill (starts quarantined)
GET    /v1/agents/{id}/skills                        List agent skills
POST   /v1/agents/{id}/skills/approve/{skill_id}     Approve quarantined skill
```

Skills are imported in quarantine and must be explicitly approved before an agent can use them.

---

### Webhooks

```
GET    /v1/agents/{name}/webhooks                        List agent webhooks
DELETE /v1/agents/{name}/webhooks/{slug}                 Delete webhook
GET    /v1/agents/{name}/webhooks/{slug}/deliveries      List deliveries
POST   /v1/hooks/{token}                                 Receive inbound webhook (HMAC verified, no auth)
POST   /v1/admin/reload-webhooks                         Reload webhook configurations
```

Webhooks support HMAC signing and delivery tracking.

---

### Heartbeats

```
POST   /v1/agents/{id}/heartbeats              Create heartbeat rule (cron syntax)
GET    /v1/agents/{id}/heartbeats              List heartbeat rules
DELETE /v1/agents/{id}/heartbeats/{hb_id}      Delete heartbeat
```

---

### Templates

```
POST   /v1/templates                    Create template
GET    /v1/templates                    List templates
GET    /v1/templates/{slug}             Get template
PUT    /v1/templates/{slug}             Update template
DELETE /v1/templates/{slug}             Delete template
PATCH  /v1/agents/{name}/template       Set agent template
```

---

### MCP

```
GET    /v1/agents/{name}/mcp                       List MCP servers
POST   /v1/agents/{name}/mcp                       Add MCP server
DELETE /v1/agents/{name}/mcp/{server_id}            Remove MCP server
POST   /v1/agents/{name}/mcp/{server_id}/test       Test MCP server connection
```

---

### Vault

```
GET    /v1/vault/secrets         List secret references
POST   /v1/vault/secrets         Create secret reference
DELETE /v1/vault/secrets/{id}    Delete secret reference
POST   /v1/vault/grants          Grant agent access to a secret
GET    /v1/vault/grants          List grants
DELETE /v1/vault/grants/{id}     Revoke grant
```

Secrets are stored in the OS keychain (macOS Keychain, Linux secret-service). Agents need an explicit grant to access any secret.

---

### Channels

```
POST   /v1/channels                      Register a channel (Telegram, Discord)
GET    /v1/channels                      List channels
GET    /v1/channels/{id}                 Get channel details
DELETE /v1/channels/{id}                 Delete channel
POST   /v1/channels/{id}/pair            Pair channel to agent
GET    /v1/channels/{id}/bindings        List bindings
DELETE /v1/channels/{id}/bindings/{bid}  Unbind a chat
```

---

### Health & Audit

```
GET    /v1/health                Health check (no auth required)
GET    /v1/audit-logs            Paginated audit logs
```

**Audit log query parameters:**

| Param | Description |
|---|---|
| `agent_id` | Filter by agent |
| `event_type` | Filter by event type |
| `limit` | Page size (default 50) |
| `offset` | Pagination offset |

---

## Events (SSE)

```
GET    /v1/events/stream         SSE event stream
```

**Query parameters:**

| Param | Description |
|---|---|
| `agent_id` | Filter events for a specific agent |
| `run_id` | Filter events for a specific run |

### Event Types (60)

| Category | Events |
|---|---|
| Run lifecycle | `run.started`, `run.completed`, `run.failed`, `run.queued`, `run.dequeued` |
| Messages | `message.delta`, `message.final` |
| Model | `model.request`, `model.response` |
| Skills | `skill.invoked`, `skill.completed`, `skill.failed` |
| Primitives | `primitive.invoked`, `primitive.completed`, `primitive.failed` |
| Memory | `memory.read`, `memory.write`, `memory.compact_started`, `memory.compact_completed` |
| Vault | `vault.requested`, `vault.granted`, `vault.denied` |
| Heartbeat | `heartbeat.triggered`, `heartbeat.completed`, `heartbeat.failed` |
| Sub-agents | `subagent.spawned`, `subagent.completed`, `subagent.failed`, `subagent.ask_question` |
| Channels | `channel.message_received`, `channel.message_sent`, `channel.error` |
| Security | `security.violation`, `sandbox.denied` |
| User | `user.ask_question`, `user.ask_answered` |
| Agent | `agent.alive`, `agent.stuck`, `agent.nudged` |
| Webhooks | `webhook.received`, `webhook.action_completed`, `webhook.action_failed` |
| Hive | `hive.created`, `hive.disbanded`, `hive.member_joined`, `hive.signal_posted`, `hive.task_created`, `hive.task_claimed`, `hive.task_completed`, `hive.task_failed`, `hive.proposal_created`, `hive.proposal_resolved`, `hive.vote_cast` |
| Task | `task.analyzed` |
| MCP | `mcp.connected`, `mcp.disconnected`, `mcp.connection_failed`, `mcp.tool_invoked`, `mcp.tool_completed`, `mcp.tool_failed` |

All events pass through a `RedactionEngine` that automatically strips secret values from payloads before streaming or persistence.

---

## Primitives (85)

These are the tools available to agents at runtime. Skills declare which primitives they require via `allowed_primitives` in their YAML frontmatter. See the [Primitives Overview](src/primitives/overview.md) for the full table.

| Category | Primitives |
|---|---|
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

---

## Database Schema (17 tables)

| Table | Purpose |
|---|---|
| `api_tokens` | Hashed PATs with scopes and TTL |
| `providers` | Registered provider plugins |
| `provider_models` | Available models per provider |
| `agents` | Agent configuration and state |
| `heartbeats` | Scheduled heartbeat rules |
| `skills` | Installed skills with quarantine status |
| `memory_index` | Agent memory metadata and tags |
| `memory_vec` | Embedding vectors for semantic search |
| `vault_secret_refs` | Secret reference metadata |
| `vault_grants` | Agent-to-secret access grants |
| `event_audit` | Full event audit log with redaction |
| `channels` | Messaging channel configurations |
| `channel_bindings` | Agent-to-channel bindings |
| `channel_pairing_codes` | Pairing codes for channel setup |
| `webhooks` | Webhook registrations per agent |
| `webhook_deliveries` | Delivery attempts and status |
| `conversation_log` | Conversation persistence for run recovery |
