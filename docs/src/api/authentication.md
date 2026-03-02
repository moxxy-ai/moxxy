# Authentication

All API endpoints require a Bearer token in the `Authorization` header, except for the health check and the bootstrap token creation.

## Token Format

Tokens are 68-character strings with the format `mox_<64-hex-chars>`:

```
Authorization: Bearer mox_a1b2c3d4e5f6a7b8c9d0...
```

The `mox_` prefix makes tokens easy to identify in logs and configuration.

## Endpoints

### Create Token

```
POST /v1/auth/tokens
```

**Required scope**: `tokens:admin` (except during bootstrap -- the first token can be created without authentication).

**Request body**:

```json
{
  "scopes": ["agents:read", "agents:write", "runs:write"],
  "ttl_seconds": 86400,
  "description": "CI pipeline token"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scopes` | `string[]` | Yes | Permission scopes for the token |
| `ttl_seconds` | `integer` | No | Time-to-live in seconds (null = no expiration) |
| `description` | `string` | No | Human-readable description |

**Response** (201 Created):

```json
{
  "id": "019cac12-abcd-7000-8000-123456789abc",
  "token": "mox_a1b2c3d4e5f6...",
  "scopes": ["agents:read", "agents:write", "runs:write"],
  "created_at": "2026-03-02T12:00:00Z",
  "expires_at": "2026-03-03T12:00:00Z",
  "status": "active"
}
```

The `token` field contains the plaintext token and is only returned on creation. Store it securely -- it cannot be retrieved again.

### List Tokens

```
GET /v1/auth/tokens
```

**Required scope**: `tokens:admin`

Returns all tokens (without plaintext values):

```json
[
  {
    "id": "019cac12-...",
    "scopes": ["agents:read", "agents:write"],
    "created_at": "2026-03-02T12:00:00Z",
    "expires_at": null,
    "status": "active"
  }
]
```

### Revoke Token

```
DELETE /v1/auth/tokens/{id}
```

**Required scope**: `tokens:admin`

Sets the token status to `revoked`. Revoked tokens are immediately rejected by the auth middleware.

**Response** (200 OK):

```json
{
  "id": "019cac12-...",
  "status": "revoked"
}
```

## Token Scopes

| Scope | Description | Required for |
|-------|-------------|-------------|
| `agents:read` | Read agent state and metadata | `GET /v1/agents`, `GET /v1/agents/{id}` |
| `agents:write` | Create agents, spawn sub-agents | `POST /v1/agents`, `POST /v1/agents/{id}/subagents` |
| `runs:write` | Start and stop agent runs | `POST /v1/agents/{id}/runs`, `POST /v1/agents/{id}/stop` |
| `vault:read` | List secret references and grants | `GET /v1/vault/secrets`, `GET /v1/vault/grants` |
| `vault:write` | Create/delete secrets and grants | `POST /v1/vault/secrets`, `POST /v1/vault/grants` |
| `tokens:admin` | Manage API tokens | `POST /v1/auth/tokens`, `DELETE /v1/auth/tokens/{id}` |
| `events:read` | Subscribe to SSE, query audit logs | `GET /v1/events/stream`, `GET /v1/audit-logs` |
| `channels:read` | List channels and bindings | `GET /v1/channels`, `GET /v1/channels/{id}/bindings` |
| `channels:write` | Create/delete channels, pair chats | `POST /v1/channels`, `POST /v1/channels/{id}/pair` |

## Security Details

- **Hashing**: Tokens are SHA-256 hashed at rest. The gateway stores only the hash in `api_tokens.token_hash`.
- **Verification**: On each request, the gateway hashes the provided token and looks up the hash in the database.
- **Expiration**: If `expires_at` is in the past, the token is rejected with `TokenError::Expired`.
- **Revocation**: If `status` is `revoked`, the token is rejected with `TokenError::Revoked`.
- **Scope check**: After verifying the token, each route handler checks that the required scope is present.

## CLI Usage

```bash
# Create a token (interactive wizard)
moxxy auth token create

# Create with specific scopes
moxxy auth token create --scopes agents:read,agents:write,runs:write --ttl 3600

# List tokens
moxxy auth token list

# JSON output for scripting
moxxy auth token list --json

# Revoke a token
moxxy auth token revoke <token-id>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MOXXY_TOKEN` | Default token for CLI commands |
| `MOXXY_API_URL` | Gateway base URL (default: `http://localhost:3000`) |
