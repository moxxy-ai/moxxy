# Filesystem Primitives

The filesystem primitives provide agents with scoped access to files within their workspace directory. All operations are enforced by `PathPolicy` -- agents cannot read or write outside their workspace boundary.

## fs.read

Read the contents of a file.

**Parameters**:

```json
{
  "path": "src/main.rs"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Relative or absolute path within workspace |

**Result**:

```json
{
  "content": "fn main() {\n    println!(\"Hello\");\n}\n",
  "path": "/home/user/project/src/main.rs",
  "size": 42
}
```

**Security**: The path is resolved against the workspace root and canonicalized. Reads outside the workspace (including via `..` traversal or symlink escape) are rejected with `PrimitiveError::AccessDenied`.

If `core_mount` is configured, files in the core mount are also readable (read-only access).

## fs.write

Write content to a file. Creates parent directories if they do not exist.

**Parameters**:

```json
{
  "path": "output/results.json",
  "content": "{\"status\": \"ok\"}"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Target file path within workspace |
| `content` | string | Yes | File content to write |

**Result**:

```json
{
  "path": "/home/user/project/output/results.json",
  "bytes_written": 18
}
```

**Security**: Only writable within the workspace root. Writing to `core_mount` returns `PathPolicyError::WriteToReadOnly`. Parent traversal and symlink escape attempts are blocked.

## fs.list

List the contents of a directory.

**Parameters**:

```json
{
  "path": "src"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Directory path within workspace |

**Result**:

```json
{
  "path": "/home/user/project/src",
  "entries": [
    {"name": "main.rs", "type": "file", "size": 42},
    {"name": "lib.rs", "type": "file", "size": 128},
    {"name": "tests", "type": "directory"}
  ]
}
```

**Security**: Same PathPolicy enforcement as `fs.read`. Only directories within the workspace (and optional core mount) can be listed.

## PathPolicy Enforcement

The `PathPolicy` struct enforces workspace boundaries:

```rust
pub struct PathPolicy {
    workspace_root: PathBuf,    // Read/write allowed
    core_mount: Option<PathBuf>, // Read-only
}
```

For every operation:

1. The requested path is resolved to an absolute path
2. `canonicalize()` resolves symlinks and `..` components
3. The canonical path must be a descendant of `workspace_root` (for writes) or `workspace_root`/`core_mount` (for reads)
4. If the check fails, `PathPolicyError::OutsideWorkspace` is returned

This prevents:
- **Directory traversal**: `../../etc/passwd` resolves outside workspace
- **Symlink escape**: A symlink pointing to `/etc/` resolves outside workspace after canonicalization
- **Absolute path injection**: `/tmp/evil.sh` is outside workspace

## Example Skill Declaration

A skill that needs filesystem access:

```yaml
allowed_primitives:
  - fs.read
  - fs.list
  - fs.write
```

A read-only skill would omit `fs.write`:

```yaml
allowed_primitives:
  - fs.read
  - fs.list
```
