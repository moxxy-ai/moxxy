# moxxy-vault

Secrets management and access control for Moxxy agents.

## Overview

This crate manages secret storage with pluggable backends, metadata tracking in SQLite, and role-based access control through a grant system. Agents can only access secrets they have been explicitly granted.

## Components

| Export | Description |
|---|---|
| `SecretBackend` | Trait for pluggable secret storage (`set`, `get`, `delete`) |
| `InMemoryBackend` | HashMap-based backend for testing |
| `SqliteBackend` | Persistent backend with AES-256-GCM encryption |
| `VaultService` | Orchestration layer combining backend + metadata + grants |
| `VaultPolicy` | Grant validation logic |

## How It Works

- **Secret refs** are metadata records (key name, backend key, policy label) stored in SQLite
- **Secret material** is stored in the configured backend (encrypted at rest with `SqliteBackend`)
- **Grants** control which agents can access which secrets (soft-deleted via `revoked_at` for audit trail)
- **Resolution** checks for an active grant before returning secret material

Key behaviors:
- Granting access is idempotent (re-granting returns existing grant)
- Sub-agents inherit their parent's active grants via `copy_from_agent()`
- `SqliteBackend` uses random nonces + AES-256-GCM authenticated encryption

## Dependencies

- `moxxy-storage` -- DAOs for `vault_secret_refs` and `vault_grants` tables
- `moxxy-types` -- shared error types
- `aes-gcm` -- authenticated encryption for `SqliteBackend`
- `rusqlite` -- SQLite bindings
