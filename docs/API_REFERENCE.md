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
| `heartbeats:read` | List heartbeat rules |
| `heartbeats:write` | Create, update, delete heartbeats |
| `skills:write` | Install and approve skills |

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
GET    /v1/agents/{id}              Get agent details
POST   /v1/agents/{id}/runs         Start a run
POST   /v1/agents/{id}/stop         Stop a running agent
POST   /v1/agents/{id}/subagents    Spawn a sub-agent
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
curl -X POST http://localhost:3000/v1/agents/{id}/runs \
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
POST   /v1/agents/{id}/webhooks                          Create webhook
GET    /v1/agents/{id}/webhooks                          List agent webhooks
DELETE /v1/agents/{id}/webhooks/{wh_id}                  Delete webhook
POST   /v1/agents/{id}/webhooks/{wh_id}/test             Test webhook delivery
GET    /v1/agents/{id}/webhooks/{wh_id}/deliveries       List deliveries
```

Webhooks support HMAC signing and delivery tracking.

---

### Heartbeats

```
POST   /v1/agents/{id}/heartbeats          Create heartbeat rule (cron syntax)
GET    /v1/agents/{id}/heartbeats          List heartbeat rules
PATCH  /v1/agents/{id}/heartbeats/{id}     Update heartbeat
DELETE /v1/agents/{id}/heartbeats/{id}     Delete heartbeat
```

---

### Vault

```
GET    /v1/vault/secrets         List secret references
POST   /v1/vault/secrets         Create secret reference
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
POST   /v1/channels/{id}/pair            Generate pairing code
POST   /v1/channels/{id}/bind            Bind agent to channel
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

### Event Types (28)

| Category | Events |
|---|---|
| Run lifecycle | `run.started`, `run.completed`, `run.failed` |
| Messages | `message.delta`, `message.final` |
| Model | `model.request`, `model.response` |
| Skills | `skill.invoked`, `skill.completed`, `skill.failed` |
| Primitives | `primitive.invoked`, `primitive.completed`, `primitive.failed` |
| Memory | `memory.read`, `memory.write` |
| Vault | `vault.requested`, `vault.granted`, `vault.denied` |
| Heartbeat | `heartbeat.triggered`, `heartbeat.completed`, `heartbeat.failed` |
| Sub-agents | `subagent.spawned`, `subagent.completed` |
| Channels | `channel.message_received`, `channel.message_sent` |
| Security | `security.violation`, `sandbox.denied` |
| Webhooks | `webhook.delivered`, `webhook.failed` |

All events pass through a `RedactionEngine` that automatically strips secret values from payloads before streaming or persistence.

---

## Primitives (34)

These are the tools available to agents at runtime. Skills declare which primitives they require via `allowed_primitives` in their YAML frontmatter.

| Primitive | Description |
|---|---|
| `fs.read` | Read file contents (workspace-scoped) |
| `fs.write` | Write file contents (workspace-scoped) |
| `fs.list` | List directory entries (workspace-scoped) |
| `shell.exec` | Execute allowed commands with 30s timeout, 1MB output cap |
| `http.request` | HTTP request to allowed domains, 30s timeout, 5MB cap |
| `browse.fetch` | Fetch web page with CSS selector extraction |
| `browse.extract` | Extract data from HTML (no network) |
| `git.init` | Initialize a git repository |
| `git.clone` | Clone a repository (vault-aware for private repos) |
| `git.status` | Porcelain status with file lists |
| `git.commit` | Stage and commit (vault-aware) |
| `git.push` | Push to remote (vault-aware) |
| `git.checkout` | Switch or create branches |
| `git.pr_create` | Create a GitHub PR via API |
| `git.fork` | Fork a GitHub repository via API |
| `git.worktree_add` | Create a git worktree |
| `git.worktree_list` | List worktrees |
| `git.worktree_remove` | Remove a worktree |
| `memory.append` | Write timestamped memory entry with tags |
| `memory.search` | Search memory by content |
| `memory.summarize` | Generate memory summary |
| `webhook.create` | Register a webhook for the agent |
| `webhook.list` | List agent's webhooks |
| `notify.webhook` | Send POST to a webhook URL |
| `notify.cli` | Emit notification event to CLI |
| `skill.import` | Import and quarantine a skill |
| `skill.validate` | Validate skill frontmatter |
| `channel.notify` | Send message via channel bridge |
| `heartbeat.create` | Create a heartbeat rule |
| `heartbeat.list` | List heartbeat rules |
| `heartbeat.disable` | Disable a heartbeat |
| `heartbeat.delete` | Delete a heartbeat |
| `heartbeat.update` | Update a heartbeat |
| `vault.set` | Store a secret |
| `vault.get` | Retrieve a secret (requires grant) |
| `vault.delete` | Delete a secret |
| `vault.list` | List secret references |
| `ask.user` | Block and wait for user input (oneshot + timeout) |
| `agent.spawn` | Spawn a sub-agent (lineage enforcement) |
| `agent.status` | Check sub-agent status (ownership check) |
| `agent.list` | List sub-agents |
| `agent.stop` | Stop a sub-agent |
| `agent.dismiss` | Clean up a stopped sub-agent |

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
