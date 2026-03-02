# Vault & Secrets

The vault provides secure secret storage with a grant-based access model. Secret material is stored in the OS keychain (or an in-memory backend for testing); only metadata lives in the SQLite database.

## Architecture

```
+------------------+     +------------------+
| VaultService     |     | SecretBackend    |
| - create_ref     |     | (trait)          |
| - store_secret   |     +--------+---------+
| - grant_access   |              |
| - resolve        |     +--------+---------+
| - revoke_grant   |     |                  |
+------------------+     v                  v
         |        +----------------+ +------------------+
         |        | InMemoryBackend| | KeyringBackend   |
         |        | (HashMap)      | | (OS Keychain)    |
         v        +----------------+ +------------------+
+------------------+
| Database         |
| - vault_secret_  |
|   refs           |
| - vault_grants   |
+------------------+
```

## SecretBackend Trait

```rust
pub trait SecretBackend: Send + Sync {
    fn store(&self, key: &str, value: &str) -> Result<(), VaultError>;
    fn retrieve(&self, key: &str) -> Result<String, VaultError>;
    fn delete(&self, key: &str) -> Result<(), VaultError>;
}
```

### InMemoryBackend

Stores secrets in a `HashMap<String, String>`. Used in tests and development.

### KeyringBackend

Uses the `keyring` crate to store secrets in:
- **macOS**: Keychain Access (via Security framework)
- **Linux**: Secret Service API (GNOME Keyring, KDE Wallet)

Secrets are stored with the service name `moxxy` and the backend key as the account name.

## VaultService

The `VaultService` combines the backend with database operations:

```rust
let backend = InMemoryBackend::new();
let service = VaultService::new(backend, conn);

// Create a reference (metadata in DB)
let secret_ref = service.create_secret_ref(
    "github-token",      // key_name (logical name)
    "moxxy-gh-token",    // backend_key (storage key)
    Some("production"),  // policy_label
)?;

// Store the actual secret (in backend)
service.store_secret("moxxy-gh-token", "ghp_abc123...")?;

// Grant access to an agent
service.grant_access("agent-1", &secret_ref.id)?;

// Resolve: agent requests the secret
let value = service.resolve("agent-1", &secret_ref.id)?;
// Returns "ghp_abc123..."
```

## Access Control

The resolve flow:

1. Look up the `vault_secret_refs` row by ID
2. Query `vault_grants` for a matching `(agent_id, secret_ref_id)` where `revoked_at IS NULL`
3. If no active grant exists: return `VaultError::AccessDenied`
4. If granted: call `backend.retrieve(backend_key)` and return the value

### Grant Lifecycle

```
create_grant(agent_id, secret_ref_id)
    |
    v
Grant active (revoked_at = NULL)
    |                            |
    | resolve() succeeds         | revoke_grant(grant_id)
    v                            v
Secret value returned        Grant revoked (revoked_at set)
                                 |
                                 | resolve() fails
                                 v
                            VaultError::AccessDenied
```

Grants are idempotent: calling `grant_access` for an already-granted combination returns the existing grant.

## Database Tables

### vault_secret_refs

```sql
CREATE TABLE vault_secret_refs (
    id TEXT PRIMARY KEY NOT NULL,
    key_name TEXT NOT NULL UNIQUE,  -- Logical name (e.g., "github-token")
    backend_key TEXT NOT NULL,      -- Storage key in backend
    policy_label TEXT,              -- Optional policy tag
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

### vault_grants

```sql
CREATE TABLE vault_grants (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    secret_ref_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,                -- NULL = active, set = revoked
    UNIQUE(agent_id, secret_ref_id),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (secret_ref_id) REFERENCES vault_secret_refs(id) ON DELETE CASCADE
);
```

## Events

| Event | Description |
|-------|-------------|
| `vault.requested` | Agent requested access to a secret |
| `vault.granted` | Access check passed, secret returned |
| `vault.denied` | No active grant, access denied |

## Event Redaction

The `RedactionEngine` automatically scrubs secret values from event payloads. If a primitive accidentally includes a secret in its output, the value is replaced with `[REDACTED]` before the event is stored or streamed.

## Common Secrets

| Key Name | Used By | Description |
|----------|---------|-------------|
| `github-token` | `git.clone`, `git.push`, `git.pr_create`, `git.fork` | GitHub personal access token |
| `git-user-name` | `git.commit` | Git commit author name |
| `git-user-email` | `git.commit` | Git commit author email |
| Provider API keys | Provider at runtime | LLM API authentication |

## CLI Usage

```bash
# Add a secret (stores in OS keychain)
moxxy vault add --key github-token --backend moxxy-github-token

# Grant an agent access
moxxy vault grant --agent <agent-id> --secret <secret-ref-id>
```
