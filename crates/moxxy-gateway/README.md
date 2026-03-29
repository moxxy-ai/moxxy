# moxxy-gateway

REST API server and control plane for the Moxxy agent framework.

## Overview

An Axum-based HTTP server that exposes the full Moxxy API. Manages agent lifecycle, authentication, event streaming, webhooks, vault, channels, MCP servers, and heartbeat scheduling. This is the main binary crate (`moxxy-gateway`).

## API Surface

| Group | Endpoints |
|---|---|
| Health | `GET /v1/health` |
| Auth | `POST/GET/DELETE /v1/auth/tokens` |
| Agents | `POST/GET/PATCH/DELETE /v1/agents/{name}`, runs, stop, reset, history, ask-responses |
| Memory | `GET /v1/agents/{id}/memory/search`, `POST .../compact` |
| Skills | `GET/POST/DELETE /v1/agents/{id}/skills` |
| Templates | `POST/GET/PUT/DELETE /v1/templates/{slug}`, assign to agent |
| MCP | `GET/POST/DELETE /v1/agents/{name}/mcp/{server_id}`, test |
| Vault | `POST/GET/DELETE /v1/vault/secrets`, grants |
| Webhooks | `GET/DELETE /v1/agents/{name}/webhooks`, deliveries, `POST /v1/hooks/{token}` |
| Heartbeat | `POST/GET/DELETE /v1/agents/{id}/heartbeats` |
| Channels | `POST/GET/DELETE /v1/channels/{id}`, pair, bindings |
| Providers | `POST/GET /v1/providers`, models |
| Events | `GET /v1/events/stream` (SSE) |
| Audit | `GET /v1/audit-logs` |

## Middleware

- **Auth** -- loopback mode (localhost bypass) or bearer token with SHA-256 hash validation and scope checks
- **Rate limiting** -- per-key (token or IP), configurable via `MOXXY_RATE_LIMIT_*` env vars
- **CORS** -- configurable origins via `MOXXY_CORS_ORIGINS`
- **Body limit** -- 1 MB max

## Background Tasks

- **Event persistence** -- subscribes to EventBus, redacts secrets, writes to `event_audit`
- **Health check** -- every 60s, detects stuck agents (no events for 5 min)
- **Heartbeat loop** -- every 30s, dispatches due heartbeat actions (execute_skill, notify_cli/channel/webhook, memory_compact)
- **Drain loop** -- processes queued agent runs when agents become idle

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `MOXXY_HOME` | `~/.moxxy` | Config directory |
| `MOXXY_DB_PATH` | `~/.moxxy/moxxy.db` | SQLite database |
| `MOXXY_HOST` | `127.0.0.1` | Bind address |
| `MOXXY_PORT` | `3000` | Bind port |
| `MOXXY_VAULT_KEY` | auto-generated | 256-bit hex key for AES-256-GCM |
| `MOXXY_LOOPBACK` | `true` | Allow unauthenticated localhost access |
| `MOXXY_CORS_ORIGINS` | localhost:3000,17900,17901 | Comma-separated allowed origins |
| `MOXXY_TRUSTED_PROXIES` | — | IPs trusted for x-forwarded-for |

## Dependencies

Depends on all other workspace crates: `moxxy-types`, `moxxy-storage`, `moxxy-core`, `moxxy-vault`, `moxxy-runtime`, `moxxy-channel`, `moxxy-plugin`, `moxxy-mcp`.
