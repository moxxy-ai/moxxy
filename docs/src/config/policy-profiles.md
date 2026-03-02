# Policy Profiles

Policy profiles configure the security posture for agent operations. They control sandbox behavior, primitive access, and resource limits.

## Overview

Each agent can have an optional `policy_profile` that determines how its operations are constrained:

```json
{
  "provider_id": "anthropic",
  "model_id": "claude-sonnet-4-20250514",
  "workspace_root": "/home/user/project",
  "policy_profile": "standard"
}
```

## Available Profiles

### Strict

The most restrictive profile. Best for running untrusted skills or commands.

| Aspect | Behavior |
|--------|----------|
| **Shell commands** | Sandboxed: no network, read-only workspace |
| **Filesystem** | Read-only (workspace + system libs) |
| **Network** | Blocked at OS level |
| **Primitives** | All registered primitives (allowlist still applies per skill) |

Use case: Running untrusted code review skills, analyzing potentially malicious files.

### Standard

A balanced profile for general-purpose agent work.

| Aspect | Behavior |
|--------|----------|
| **Shell commands** | Sandboxed: network allowed, workspace read/write |
| **Filesystem** | Read/write within workspace |
| **Network** | Allowed |
| **Primitives** | All registered primitives (allowlist still applies per skill) |

Use case: Most development tasks, code generation, testing.

### None (default)

No additional restrictions beyond the base security model.

| Aspect | Behavior |
|--------|----------|
| **Shell commands** | No sandbox wrapper |
| **Filesystem** | Read/write within workspace (PathPolicy still enforced) |
| **Network** | Allowed |
| **Primitives** | All registered primitives (allowlist still applies per skill) |

Use case: Trusted environments, local development with full access.

## How Profiles Affect Execution

### Shell Commands

When `shell.exec` is invoked:

```
Profile: strict
  -> SandboxedCommand::build(SandboxProfile::Strict, ...)
  -> macOS: sandbox-exec -p "(deny default)(allow file-read*)..." cmd
  -> Linux: bwrap --unshare-net --ro-bind ... cmd

Profile: standard
  -> SandboxedCommand::build(SandboxProfile::Standard, ...)
  -> macOS: sandbox-exec -p "(deny default)(allow file-write*)(allow network-outbound)..." cmd
  -> Linux: bwrap --bind ... cmd

Profile: none
  -> SandboxedCommand::build(SandboxProfile::None, ...)
  -> Returns None -> command runs directly
```

### Filesystem Operations

All profiles enforce `PathPolicy` at the application level. The sandbox adds OS-level enforcement:

| Profile | PathPolicy | OS Sandbox |
|---------|-----------|------------|
| Strict | workspace read/write | workspace read-only |
| Standard | workspace read/write | workspace read/write |
| None | workspace read/write | (no sandbox) |

In the strict profile, even if `PathPolicy` allows a write (because the path is within `workspace_root`), the OS sandbox blocks the write. This is intentional defense-in-depth for `shell.exec` commands.

Note: The filesystem primitives (`fs.read`, `fs.write`) are not wrapped in the sandbox -- they use Rust's standard library I/O and are controlled only by `PathPolicy`. The sandbox applies specifically to shell command execution.

## Security Layers

The relationship between profiles and other security mechanisms:

```
Layer 1: Token Scopes
    - Who can call what API endpoints

Layer 2: Primitive Allowlists
    - What primitives a skill can invoke
    - Independent of policy profile

Layer 3: Path Policies
    - What files an agent can read/write
    - Always enforced regardless of profile

Layer 4: Sandbox Profiles
    - OS-level process isolation for shell commands
    - Depends on policy_profile setting

Layer 5: Rate Limiting
    - Per-token/IP request rate limits
    - Independent of policy profile
```

Each layer operates independently. A strict sandbox profile does not loosen primitive allowlists, and a permissive profile does not bypass path policies.

## Choosing a Profile

| Scenario | Recommended Profile |
|----------|-------------------|
| Running untrusted third-party skills | `strict` |
| Standard development work | `standard` |
| Trusted environment, maximum flexibility | `none` |
| CI/CD pipelines with known commands | `standard` |
| Security-sensitive workloads | `strict` |

## Agent Creation Examples

```bash
# Strict profile
moxxy agent create --provider anthropic --model claude-sonnet-4-20250514 \
  --workspace ~/untrusted-project --policy strict

# Standard profile (via API)
curl -X POST http://localhost:3000/v1/agents \
  -H "Authorization: Bearer $MOXXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider_id": "anthropic",
    "model_id": "claude-sonnet-4-20250514",
    "workspace_root": "/home/user/project",
    "policy_profile": "standard"
  }'
```
