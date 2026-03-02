# Sandboxing

Moxxy provides OS-level process sandboxing for shell command execution. This adds a layer of defense beyond path policies, restricting what the spawned process can access at the kernel level.

## Sandbox Profiles

Three profiles are available:

| Profile | Network | File Read | File Write | Use Case |
|---------|---------|-----------|------------|----------|
| **Strict** | Blocked | Workspace (read-only) + system libs | Blocked | Maximum isolation for untrusted commands |
| **Standard** | Allowed | Workspace + system libs | Workspace only | Balance of functionality and safety |
| **None** | Allowed | Unrestricted | Unrestricted | Trusted environments (default) |

## Configuration

The sandbox profile is set per agent via `policy_profile`:

```json
{
  "provider_id": "anthropic",
  "model_id": "claude-sonnet-4-20250514",
  "workspace_root": "/home/user/project",
  "policy_profile": "standard"
}
```

Valid values: `"strict"`, `"standard"`, `"none"`, or `null` (same as `"none"`).

## macOS Implementation (sandbox-exec)

On macOS, Moxxy uses the `sandbox-exec` command with Scheme-based profiles.

### Strict Profile

```scheme
(version 1)
(deny default)
(allow process-exec)
(allow file-read* (subpath "/path/to/workspace"))
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/Library"))
(allow sysctl-read)
```

Capabilities:
- Process execution: allowed (needed to run the command itself)
- File reads: workspace + system paths only
- File writes: denied
- Network: denied
- Sysctl: read-only (needed by some tools)

### Standard Profile

```scheme
(version 1)
(deny default)
(allow process-exec)
(allow file-read* (subpath "/path/to/workspace"))
(allow file-write* (subpath "/path/to/workspace"))
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/Library"))
(allow network-outbound)
(allow sysctl-read)
```

Additional capabilities vs strict:
- File writes: allowed within workspace
- Network outbound: allowed

### Command Wrapping

The original command is wrapped:

```
Original: ls -la src/
Sandboxed: sandbox-exec -p "(version 1)(deny default)..." ls -la src/
```

## Linux Implementation (bubblewrap)

On Linux, Moxxy uses `bwrap` (bubblewrap) for namespace-based isolation.

### Strict Profile

```bash
bwrap \
  --unshare-pid \          # Isolated PID namespace
  --unshare-uts \          # Isolated hostname
  --unshare-net \          # No network access
  --die-with-parent \      # Kill if parent dies
  --ro-bind /path/ws /path/ws \  # Read-only workspace
  --ro-bind /usr /usr \    # System binaries
  --ro-bind /lib /lib \    # System libraries
  --ro-bind /lib64 /lib64 \
  --symlink usr/bin /bin \ # Symlink for /bin
  --proc /proc \           # Minimal /proc
  --dev /dev \             # Minimal /dev
  ls -la src/
```

Features:
- PID isolation: process sees only itself
- UTS isolation: separate hostname
- Network isolation: no network access
- Filesystem: read-only bind mounts

### Standard Profile

```bash
bwrap \
  --unshare-pid \          # Isolated PID namespace
  --unshare-uts \          # Isolated hostname
  --die-with-parent \      # Kill if parent dies
  --bind /path/ws /path/ws \  # Read/write workspace
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --ro-bind /lib64 /lib64 \
  --symlink usr/bin /bin \
  --proc /proc \
  --dev /dev \
  ls -la src/
```

Differences from strict:
- Network: not isolated (no `--unshare-net`)
- Workspace: read/write bind (`--bind` vs `--ro-bind`)

## Integration with ShellExecPrimitive

The `shell.exec` primitive checks the agent's sandbox configuration before running any command:

```
1. Receive command + args
2. Look up agent's SandboxConfig
3. If profile is None: run command directly
4. If Strict/Standard: call SandboxedCommand::build()
5. SandboxedCommand returns (wrapper_cmd, wrapper_args)
6. Execute the wrapped command
7. Return stdout/stderr/exit_code
```

## Platform Support

| Platform | Strict | Standard | None |
|----------|--------|----------|------|
| macOS | `sandbox-exec` | `sandbox-exec` | Direct execution |
| Linux | `bwrap` | `bwrap` | Direct execution |
| Other | Falls back to None | Falls back to None | Direct execution |

On unsupported platforms, `SandboxedCommand::build()` returns `None`, and the command runs without a sandbox.

## Prerequisites

- **macOS**: `sandbox-exec` is included with the OS (part of the Seatbelt sandbox framework)
- **Linux**: `bwrap` (bubblewrap) must be installed. On Debian/Ubuntu: `apt install bubblewrap`

## Security Considerations

Sandboxing provides defense-in-depth:

1. **Path policies** (application level): Check paths before I/O calls
2. **Sandbox profiles** (OS level): Kernel enforces filesystem and network restrictions
3. **Command allowlists** (application level): Only approved commands can be run

Even if a bug in path policy checking allowed an escape, the OS-level sandbox would still block access to files outside the mounted paths.
