# Path Policies

Path policies enforce filesystem boundaries for agent operations. Every agent has a workspace root, and all file operations must resolve to paths within that boundary.

## PathPolicy

```rust
pub struct PathPolicy {
    workspace_root: PathBuf,    // Read/write allowed
    core_mount: Option<PathBuf>, // Read-only access
}
```

The `PathPolicy` is constructed when an agent is created, using the agent's `workspace_root` and optional `core_mount` configuration.

## Enforcement Rules

### Readable Paths

A path is readable if its canonical form is under either:
- The `workspace_root` directory
- The `core_mount` directory (if configured)

```rust
policy.ensure_readable(&path)?;
// Ok(()) if path is under workspace_root or core_mount
// Err(PathPolicyError::OutsideWorkspace) otherwise
```

### Writable Paths

A path is writable only if its canonical form is under the `workspace_root`:

```rust
policy.ensure_writable(&path)?;
// Ok(()) if path is under workspace_root
// Err(PathPolicyError::WriteToReadOnly) if under core_mount
// Err(PathPolicyError::OutsideWorkspace) if outside both
```

Writing to `core_mount` is explicitly blocked with `WriteToReadOnly`, not `OutsideWorkspace`. This distinction helps in error messages and audit logging.

## Path Canonicalization

Before any check, paths are resolved via `std::fs::canonicalize()`:

1. Resolve all `..` components
2. Follow all symbolic links to their targets
3. Convert to absolute path

This means:
- `workspace/../../etc/passwd` resolves to `/etc/passwd` -- outside workspace, rejected
- `workspace/link` where `link -> /tmp/evil` resolves to `/tmp/evil` -- outside workspace, rejected
- `workspace/subdir/../file.txt` resolves to `workspace/file.txt` -- inside workspace, allowed

## Attack Vectors Prevented

### Directory Traversal

```
Request: {"path": "../../etc/shadow"}
Canonical: /etc/shadow
Result: PathPolicyError::OutsideWorkspace("/etc/shadow")
```

### Symlink Escape

```
# Setup: ln -s /etc/passwd workspace/escape
Request: {"path": "escape"}
Canonical: /etc/passwd
Result: PathPolicyError::OutsideWorkspace("/etc/passwd")
```

### Absolute Path Injection

```
Request: {"path": "/tmp/malicious.sh"}
Canonical: /tmp/malicious.sh
Result: PathPolicyError::OutsideWorkspace("/tmp/malicious.sh")
```

### Core Mount Write Attempt

```
# core_mount = /opt/moxxy/builtins
Request: fs.write {"path": "/opt/moxxy/builtins/skill.md"}
Result: PathPolicyError::WriteToReadOnly("/opt/moxxy/builtins/skill.md")
```

## Error Types

```rust
pub enum PathPolicyError {
    OutsideWorkspace(String),  // Path resolves outside both roots
    WriteToReadOnly(String),   // Write attempt on core_mount
}
```

## Enforcement Points

Path policies are checked in the filesystem primitives:

| Primitive | Check |
|-----------|-------|
| `fs.read` | `ensure_readable(path)` |
| `fs.write` | `ensure_writable(path)` |
| `fs.list` | `ensure_readable(path)` |

The check happens before any I/O system call. If the check fails, no file operation occurs.

## Configuration

Path policies are configured at agent creation:

```json
{
  "workspace_root": "/home/user/my-project",
  "core_mount": "/opt/moxxy/builtins"
}
```

- `workspace_root` (required): The agent's working directory. All read/write operations are scoped here.
- `core_mount` (optional): Additional read-only directory. Useful for built-in skill definitions or shared libraries.

## Non-Existent Files

For write operations on files that do not yet exist, the policy checks the parent directory:

1. Get the parent directory of the target path
2. Canonicalize the parent
3. Verify the parent is under `workspace_root`

This allows creating new files within the workspace while still preventing writes to arbitrary locations.
