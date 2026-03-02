# Security Model

Moxxy applies defense in depth: every layer -- from API tokens to filesystem policies to process sandboxing -- independently enforces its own constraints. Compromise of one layer does not grant access to another.

## Token-Based Authentication

All API requests (except the health check and bootstrap token creation) require a Bearer token in the `Authorization` header.

### Token Format

Tokens follow the pattern `mox_<64-hex-chars>`:

```
mox_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
```

The `mox_` prefix makes tokens identifiable in logs and configuration files. The random portion is 32 bytes of cryptographically random data, hex-encoded.

### Token Storage

Tokens are never stored in plaintext. On creation:

1. 32 random bytes are generated
2. The plaintext token (`mox_` + hex) is returned once to the caller
3. A SHA-256 hash of the plaintext is computed and stored in `api_tokens.token_hash`

On each request, the gateway hashes the provided token and looks up the hash.

### Token Scopes

Each token carries a set of scopes that determine what operations it can perform:

| Scope | Grants |
|-------|--------|
| `agents:read` | List agents, get agent status |
| `agents:write` | Create agents, spawn sub-agents |
| `runs:write` | Start and stop agent runs |
| `vault:read` | List secret references and grants |
| `vault:write` | Create secrets, manage grants |
| `tokens:admin` | Create and revoke tokens |
| `events:read` | Subscribe to SSE stream, query audit logs |
| `channels:read` | List channels and bindings |
| `channels:write` | Create channels, pair chats, manage bindings |

A token must have the required scope for each endpoint. The `tokens:admin` scope is required for creating new tokens after the bootstrap phase.

### Token Lifecycle

- **Bootstrap**: The first token creation requires no authentication
- **TTL**: Tokens can have an optional `ttl_seconds` that sets an expiration timestamp
- **Revocation**: Any token with `tokens:admin` scope can revoke any other token immediately
- **Status**: Tokens are either `active` or `revoked`

Expired and revoked tokens are rejected at the auth middleware layer before reaching any route handler.

## Path Policies

The `PathPolicy` enforces filesystem boundaries for agent operations.

### Workspace Root

Every agent has a `workspace_root` directory. All file read/write operations must resolve to paths within this directory (after canonicalization). This prevents:

- **Parent traversal**: `../../etc/passwd` is rejected
- **Symlink escape**: Symlinks pointing outside the workspace are detected via `canonicalize()`
- **Absolute path access**: Paths outside the workspace tree are rejected

### Core Mount

An optional `core_mount` directory provides read-only access to additional files (like built-in skill definitions). Writing to the core mount is explicitly blocked with a `WriteToReadOnly` error.

### Enforcement Points

Path policies are enforced at the primitive level:

- `fs.read` calls `ensure_readable()`
- `fs.write` calls `ensure_writable()`
- `fs.list` calls `ensure_readable()`

The policy checks happen before any I/O operation, not after.

## Primitive Allowlists

Even though all 27 primitives are registered in the `PrimitiveRegistry` for every agent, invocation is gated by an allowlist:

```rust
registry.invoke("fs.write", params, &allowed_primitives).await
```

If a primitive is not in the agent's `allowed` list, the registry returns `PrimitiveError::AccessDenied` without invoking the primitive.

Skills declare their required primitives in YAML frontmatter:

```yaml
allowed_primitives:
  - fs.read
  - fs.list
  - memory.append
```

The runtime enforces this allowlist at every invocation. An agent cannot use a primitive that its active skill does not declare.

## Vault Grants

Secret access follows a grant-based model:

1. An administrator creates a secret reference (`vault_secret_refs`)
2. The secret material is stored in the backend (OS keychain or in-memory for tests)
3. An explicit grant is created linking an agent to a secret reference
4. When the agent requests the secret, the vault checks for a non-revoked grant
5. If no grant exists, `VaultError::AccessDenied` is returned

Grants can be revoked at any time. Revoked grants cannot be reused -- a new grant must be created.

## Sandbox Profiles

Shell command execution can be wrapped in OS-level sandboxes:

| Profile | macOS | Linux | Network | File Write |
|---------|-------|-------|---------|------------|
| **Strict** | `sandbox-exec` deny-default | `bwrap --unshare-net` | Blocked | Read-only workspace |
| **Standard** | `sandbox-exec` allow-network | `bwrap` (no --unshare-net) | Allowed | Read/write workspace |
| **None** | No sandbox | No sandbox | Allowed | Allowed |

The sandbox profile is configured per-agent via `policy_profile`. The `ShellExecPrimitive` consults the profile before running any command.

## Rate Limiting

The gateway applies token-bucket rate limiting via `tower-governor`:

- Requests are bucketed by Bearer token, falling back to `x-forwarded-for` IP, then `anonymous`
- Configurable via environment variables: `MOXXY_RATE_LIMIT_PER_SEC`, `MOXXY_RATE_LIMIT_BURST`
- The `/v1/health` endpoint is exempt from rate limiting
- Rate-limited responses return HTTP 429 with a `Retry-After` header

## Event Redaction

All events pass through the `RedactionEngine` before storage and streaming. Any field value matching a known secret string is replaced with `[REDACTED]`, and the JSON path is recorded. This prevents secrets from leaking through the audit log or SSE stream even if a primitive accidentally includes them in its output.
