# Shell Primitive

The `shell.exec` primitive runs shell commands within the agent's workspace, with command allowlists, timeouts, output caps, and optional OS-level sandboxing.

## shell.exec

Execute a shell command.

**Parameters**:

```json
{
  "command": "ls",
  "args": ["-la", "src/"],
  "timeout_seconds": 30
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `command` | string | Yes | -- | Command to execute |
| `args` | string[] | No | `[]` | Command arguments |
| `timeout_seconds` | integer | No | 30 | Maximum execution time |

**Result**:

```json
{
  "exit_code": 0,
  "stdout": "total 24\ndrwxr-xr-x  5 user  staff  160 Mar  2 12:00 .\n...",
  "stderr": ""
}
```

## Command Allowlist

By default, only a restricted set of commands is allowed:

- `ls`, `cat`, `grep`, `find`, `echo`, `wc`
- `head`, `tail`, `sort`, `uniq`, `diff`
- `which`, `pwd`, `date`, `env`

Commands not in the allowlist are rejected with `PrimitiveError::AccessDenied`. The allowlist can be configured per agent through policy profiles.

## Timeout and Output Limits

| Limit | Default | Description |
|-------|---------|-------------|
| Timeout | 30 seconds | Command is killed if it exceeds this |
| Output cap | 1 MB | stdout/stderr truncated beyond this |

If the timeout is exceeded, `PrimitiveError::Timeout` is returned. If output exceeds the cap, it is truncated (not an error).

## Sandbox Integration

When the agent has a `policy_profile` configured, shell commands are wrapped in an OS-level sandbox:

### macOS (sandbox-exec)

**Strict profile** (deny by default):
```
(version 1)
(deny default)
(allow process-exec)
(allow file-read* (subpath "/path/to/workspace"))
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/Library"))
(allow sysctl-read)
```

- Network access: blocked
- File writes: blocked (read-only workspace)

**Standard profile**:
```
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

- Network access: allowed
- File writes: allowed within workspace

### Linux (bubblewrap)

**Strict profile**:
```bash
bwrap \
  --unshare-pid --unshare-uts --unshare-net \
  --die-with-parent \
  --ro-bind /path/to/workspace /path/to/workspace \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --symlink usr/bin /bin \
  --proc /proc --dev /dev \
  <command> <args>
```

- Network: isolated (`--unshare-net`)
- Filesystem: read-only workspace mount

**Standard profile**:
```bash
bwrap \
  --unshare-pid --unshare-uts \
  --die-with-parent \
  --bind /path/to/workspace /path/to/workspace \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --symlink usr/bin /bin \
  --proc /proc --dev /dev \
  <command> <args>
```

- Network: not isolated (allows outbound)
- Filesystem: read/write workspace mount (`--bind` instead of `--ro-bind`)

### No sandbox

When `SandboxProfile::None` is configured, commands run without any sandbox wrapper. This is the default and suitable for trusted environments.

## Example Skill Declaration

```yaml
allowed_primitives:
  - shell.exec
  - fs.read
safety_notes: "Shell restricted to safe read-only commands."
```
