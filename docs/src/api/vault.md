# Vault

The vault manages secrets (API keys, tokens, credentials) with a grant-based access model. Secrets are stored in the OS keychain; only metadata lives in the database.

## Concepts

- **Secret Reference**: A database record mapping a logical `key_name` to a `backend_key` in the secret backend
- **Secret Material**: The actual secret value, stored in the backend (OS keychain or in-memory for tests)
- **Grant**: An explicit link between an agent and a secret reference. Without a grant, an agent cannot access the secret

## Endpoints

### Create Secret Reference

```
POST /v1/vault/secrets
```

**Required scope**: `vault:write`

**Request body**:

```json
{
  "key_name": "github-token",
  "backend_key": "moxxy-github-token",
  "policy_label": "production"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key_name` | string | Yes | Logical name used by agents (unique) |
| `backend_key` | string | Yes | Key in the secret backend |
| `policy_label` | string | No | Optional label for access policies |

**Response** (201 Created):

```json
{
  "id": "019cac14-...",
  "key_name": "github-token",
  "backend_key": "moxxy-github-token",
  "policy_label": "production",
  "created_at": "2026-03-02T12:00:00Z"
}
```

### List Secret References

```
GET /v1/vault/secrets
```

**Required scope**: `vault:read`

### Grant Agent Access

```
POST /v1/vault/grants
```

**Required scope**: `vault:write`

**Request body**:

```json
{
  "agent_id": "019cac12-...",
  "secret_ref_id": "019cac14-..."
}
```

Grants are idempotent -- granting access that already exists returns the existing grant.

**Response** (201 Created):

```json
{
  "id": "019cac15-...",
  "agent_id": "019cac12-...",
  "secret_ref_id": "019cac14-...",
  "created_at": "2026-03-02T12:00:00Z",
  "revoked_at": null
}
```

### List Grants

```
GET /v1/vault/grants
```

**Required scope**: `vault:read`

### Revoke Grant

```
DELETE /v1/vault/grants/{id}
```

**Required scope**: `vault:write`

Sets `revoked_at` on the grant. Once revoked, the agent can no longer access the secret. A new grant must be created to restore access.

## Resolution Flow

When a primitive (like `git.clone`) needs a secret:

1. The primitive calls `VaultService::resolve(agent_id, secret_ref_id)`
2. The service looks up the secret reference in `vault_secret_refs`
3. It checks `vault_grants` for an active (non-revoked) grant linking the agent to the secret
4. If no grant exists: returns `VaultError::AccessDenied` and emits `vault.denied`
5. If granted: fetches the secret material from the backend and emits `vault.granted`
6. The secret value is returned to the primitive

## Secret Backend

The `SecretBackend` trait provides two implementations:

| Backend | Use Case | Storage |
|---------|----------|---------|
| `InMemoryBackend` | Tests | `HashMap<String, String>` |
| `KeyringBackend` | Production | macOS Keychain / Linux secret-service |

The backend is chosen at gateway startup. The in-memory backend is used in test configurations.

## Events

| Event | When |
|-------|------|
| `vault.requested` | Agent requests secret access |
| `vault.granted` | Access check passes |
| `vault.denied` | No valid grant exists |

## CLI Usage

```bash
# Add a secret (interactive wizard)
moxxy vault add

# Add with flags
moxxy vault add --key github-token --backend moxxy-github-token

# Grant agent access
moxxy vault grant --agent <agent-id> --secret <secret-ref-id>
```
