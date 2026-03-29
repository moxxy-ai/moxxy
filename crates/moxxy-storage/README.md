# moxxy-storage

SQLite-based data access layer for the Moxxy agent system.

## Overview

Provides typed Data Access Objects (DAOs) and row types for all persistent data. Each DAO holds a borrowed `&Connection` and exposes CRUD operations with `StorageError` results.

## Tables

| Table | DAO | Description |
|---|---|---|
| `agents` | `AgentDao` | Agent metadata, hierarchy, status |
| `api_tokens` | `TokenDao` | Auth tokens with scopes and TTL |
| `memory_index` | `MemoryDao` | Semantic memory entries with tags |
| `memory_vec` / `memory_vec0` | `MemoryDao` | 384-dim vector embeddings (sqlite-vec) |
| `vault_secret_refs` | `VaultRefDao` | Secret key metadata |
| `vault_grants` | `VaultGrantDao` | Agent-to-secret access grants |
| `channels` | `ChannelDao` | Telegram/Discord integrations |
| `channel_bindings` | `ChannelBindingDao` | Channel-to-agent mappings |
| `channel_pairing_codes` | `ChannelPairingDao` | Pairing setup codes |
| `conversation_log` | `ConversationDao` | Message history per run |
| `event_audit` | `EventAuditDao` | SSE event log |
| `webhook_deliveries` | `WebhookDeliveryDao` | Webhook delivery tracking |
| `agent_allowlists` | `AllowlistDao` | IP/domain allowlists |

## Database Wrapper

```rust
let db = Database::new(conn);
db.agents().find_by_id("agent-1")?;
db.tokens().list_all()?;
db.memory().search_similar(agent_id, &embedding, 10)?;
```

`Database` acts as a factory, providing short-lived DAO instances bound to its connection.

## Row Types

All row types are defined in `src/rows.rs` -- plain structs with `Debug + Clone`, using `String` for IDs and timestamps, `Option` for nullable fields.

## Fixtures

Test helpers in `src/fixtures.rs` (behind `#[cfg(test)]`) generate random rows with sensible defaults for every table.

## Key Patterns

- **Lifetime-bound DAOs** -- `struct XyzDao<'a> { conn: &'a Connection }` prevents dangling refs
- **Vector search** -- `MemoryDao::search_similar()` uses sqlite-vec KNN with agent-scoped filtering
- **Soft deletes** -- grants use `revoked_at`, memory uses `status: archived`
- **UUIDv7 IDs** -- chronologically sortable, generated at insert time

## Dependencies

- `rusqlite` -- SQLite driver
- `sqlite-vec` -- vector search extension
- `moxxy-types` -- `StorageError` enum
