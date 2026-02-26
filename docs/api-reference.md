# moxxy API Reference

All endpoints are served at `http://{api_host}:{api_port}` (default: `http://127.0.0.1:17890`).

Authenticated endpoints require the `X-Moxxy-Internal-Token` header. All responses return JSON with a `"success"` boolean field.

Source: `src/interfaces/web/router.rs`

---

## Agents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents |
| POST | `/api/agents` | Create a new agent |
| DELETE | `/api/agents/{agent}` | Delete an agent |
| POST | `/api/agents/{agent}/restart` | Restart an agent |

**POST /api/agents** body:
```json
{ "name": "agent_name" }
```

Handler: `src/interfaces/web/handlers/agents.rs`

---

## Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents/{agent}/chat` | Send a message and get a response |
| POST | `/api/agents/{agent}/chat/stream` | Send a message with SSE streaming response |

**POST /api/agents/{agent}/chat** body:
```json
{ "message": "Your prompt here" }
```

**Response:**
```json
{ "success": true, "response": "Agent's reply" }
```

Handler: `src/interfaces/web/handlers/chat.rs`

---

## Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{agent}/memory/short` | Get short-term memory entries |
| GET | `/api/agents/{agent}/session/messages` | Get session conversation messages |
| GET | `/api/memory/swarm` | Get shared swarm memory across all agents |

**GET /api/agents/{agent}/memory/short** response:
```json
{
  "success": true,
  "entries": [
    { "role": "user", "content": "...", "origin": "WEB", "timestamp": "..." }
  ]
}
```

Handler: `src/interfaces/web/handlers/memory.rs`

---

## Skills

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{agent}/skills` | List all registered skills |
| POST | `/api/agents/{agent}/create_skill` | LLM-generate a new skill |
| POST | `/api/agents/{agent}/install_skill` | Install skill from manifest/run.sh/skill.md |
| POST | `/api/agents/{agent}/upgrade_skill` | Hot-swap skill code (semver check) |
| POST | `/api/agents/{agent}/install_openclaw_skill` | Install skill from URL |
| DELETE | `/api/agents/{agent}/skills/{skill_name}` | Remove a skill |
| PATCH | `/api/agents/{agent}/skills/{skill_name}` | Modify a skill file |

**POST /api/agents/{agent}/install_skill** body:
```json
{
  "manifest": "name = \"my_skill\"\n...",
  "run_sh": "#!/bin/sh\n...",
  "skill_md": "# My Skill\n..."
}
```

**PATCH /api/agents/{agent}/skills/{skill_name}** body:
```json
{
  "file_name": "run.sh",
  "content": "#!/bin/sh\n..."
}
```

Handler: `src/interfaces/web/handlers/skills.rs`

---

## Vault (Secrets)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{agent}/vault` | List all secret keys |
| POST | `/api/agents/{agent}/vault` | Set a secret |
| GET | `/api/agents/{agent}/vault/{key}` | Get a secret value |
| DELETE | `/api/agents/{agent}/vault/{key}` | Delete a secret |

**POST /api/agents/{agent}/vault** body:
```json
{ "key": "API_KEY", "value": "sk-..." }
```

Handler: `src/interfaces/web/handlers/vault.rs`

---

## Channels

### General

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{agent}/channels` | List all channel configurations |

### Telegram

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents/{agent}/channels/telegram/token` | Set Telegram bot token |
| POST | `/api/agents/{agent}/channels/telegram/pair` | Pair with Telegram chat |
| POST | `/api/agents/{agent}/channels/telegram/revoke` | Revoke Telegram pairing |
| POST | `/api/agents/{agent}/channels/telegram/send` | Send a Telegram message |
| POST | `/api/agents/{agent}/channels/telegram/stt` | Configure speech-to-text |
| DELETE | `/api/agents/{agent}/channels/telegram` | Disconnect Telegram |

**POST /api/agents/{agent}/channels/telegram/send** body (form-urlencoded):
```
message=Your+message+here
```

### Discord

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents/{agent}/channels/discord/token` | Set Discord bot token |
| POST | `/api/agents/{agent}/channels/discord/send` | Send a Discord message |
| DELETE | `/api/agents/{agent}/channels/discord` | Disconnect Discord |

### WhatsApp

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents/{agent}/channels/whatsapp/config` | Set WhatsApp configuration |
| POST | `/api/agents/{agent}/channels/whatsapp/send` | Send a WhatsApp message |
| DELETE | `/api/agents/{agent}/channels/whatsapp` | Disconnect WhatsApp |

Handler: `src/interfaces/web/handlers/channels/`

---

## Schedules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{agent}/schedules` | List all scheduled jobs |
| POST | `/api/agents/{agent}/schedules` | Create a scheduled job |
| DELETE | `/api/agents/{agent}/schedules` | Delete all scheduled jobs |
| DELETE | `/api/agents/{agent}/schedules/{schedule_name}` | Delete a specific scheduled job |

**POST /api/agents/{agent}/schedules** body:
```json
{
  "name": "daily_report",
  "cron": "0 0 9 * * *",
  "prompt": "Generate a daily status report"
}
```

Handler: `src/interfaces/web/handlers/schedules.rs`

---

## Webhooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{agent}/webhooks` | List all webhooks |
| POST | `/api/agents/{agent}/webhooks` | Create a webhook |
| DELETE | `/api/agents/{agent}/webhooks/{webhook_name}` | Delete a webhook |
| PATCH | `/api/agents/{agent}/webhooks/{webhook_name}` | Update a webhook |
| POST | `/api/webhooks/{agent}/{event_source}` | Incoming webhook receiver |

Handler: `src/interfaces/web/handlers/webhooks.rs`

---

## MCP Servers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{agent}/mcp` | List MCP server registrations |
| POST | `/api/agents/{agent}/mcp` | Add an MCP server |
| DELETE | `/api/agents/{agent}/mcp/{server_name}` | Remove an MCP server |

Handler: `src/interfaces/web/handlers/mcp.rs`

---

## Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{agent}/llm` | Get agent's LLM configuration |
| POST | `/api/agents/{agent}/llm` | Set agent's LLM provider/model |
| GET | `/api/config/global` | Get global configuration |
| POST | `/api/config/global` | Update global configuration |
| GET | `/api/providers` | List available LLM providers |
| GET | `/api/providers/custom` | List custom providers |
| POST | `/api/providers/custom` | Add a custom LLM provider |
| DELETE | `/api/providers/custom/{provider_id}` | Delete a custom provider |
| POST | `/api/gateway/restart` | Restart the gateway daemon |

Handler: `src/interfaces/web/handlers/config.rs`

---

## Host Execution (Proxy)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/host/execute_bash` | Execute a bash/shell command on the host |
| POST | `/api/host/execute_python` | Execute Python code on the host |
| POST | `/api/host/execute_applescript` | Execute AppleScript on the host (macOS only) |
| POST | `/api/host/execute_powershell` | Execute PowerShell on the host (Windows only) |

**POST /api/host/execute_bash** body:
```json
{ "command": "ls -la", "cwd": "/optional/working/directory" }
```

**Response:**
```json
{ "success": true, "stdout": "...", "stderr": "...", "exit_code": 0 }
```

Handler: `src/interfaces/web/handlers/proxy.rs`

---

## Delegation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents/{agent}/delegate` | Delegate a task to an agent |

**POST /api/agents/{agent}/delegate** body (plain text):
```
The prompt to send to the agent
```

**Response:**
```json
{ "response": "Agent's reply to the delegated task" }
```

Handler: `src/interfaces/web/handlers/webhooks.rs`

---

## Mobile

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/{agent}/pair_mobile` | Get mobile pairing QR code |

Handler: `src/interfaces/web/handlers/mobile.rs`

---

## Logs (SSE)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/logs` | Server-Sent Events stream of all system logs |

This endpoint returns an SSE stream. Connect with `EventSource` or `curl`:
```bash
curl -N http://127.0.0.1:17890/api/logs
```

Handler: `src/interfaces/web/mod.rs` (`sse_logs_endpoint`)
