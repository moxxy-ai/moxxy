# Primitives Overview

Primitives are the tools that agents use to interact with the outside world. They provide capabilities like reading files, running shell commands, making HTTP requests, managing memory, and performing git operations.

## The Primitive Trait

Every primitive implements the `Primitive` trait:

```rust
#[async_trait]
pub trait Primitive: Send + Sync {
    fn name(&self) -> &str;
    async fn invoke(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError>;
}
```

Each primitive has a unique dot-notation name (e.g., `fs.read`, `git.commit`) and accepts/returns JSON values. The `Send + Sync` bounds allow primitives to be called from any async task.

## PrimitiveRegistry

The `PrimitiveRegistry` manages all registered primitives and enforces allowlist access:

```rust
let mut registry = PrimitiveRegistry::new();
registry.register(Box::new(FsReadPrimitive::new(context.clone())));
registry.register(Box::new(FsWritePrimitive::new(context.clone())));

// Invoke with allowlist enforcement
let result = registry.invoke(
    "fs.read",
    json!({"path": "src/main.rs"}),
    &["fs.read".into(), "fs.list".into()],
).await?;
```

The third argument to `invoke()` is the allowlist. If the requested primitive is not in this list, `PrimitiveError::AccessDenied` is returned without executing the primitive.

## Error Types

```rust
pub enum PrimitiveError {
    AccessDenied(String),     // Primitive not in allowlist
    InvalidParams(String),    // Bad input parameters
    ExecutionFailed(String),  // Runtime error during execution
    Timeout,                  // Operation exceeded time limit
    SizeLimitExceeded,       // Output exceeded size cap
    NotFound(String),        // Primitive not registered
}
```

## All Primitives

| Primitive | Description | Section |
|-----------|-------------|---------|
| `fs.read` | Read file contents | [Filesystem](fs.md) |
| `fs.write` | Write file contents | [Filesystem](fs.md) |
| `fs.list` | List directory entries | [Filesystem](fs.md) |
| `shell.exec` | Execute shell commands | [Shell](shell.md) |
| `http.request` | Make HTTP requests | [HTTP](http.md) |
| `memory.append` | Write memory entry | [Memory](memory.md) |
| `memory.search` | Search memory | [Memory](memory.md) |
| `memory.summarize` | Summarize memory | [Memory](memory.md) |
| `git.init` | Initialize repository | [Git](git.md) |
| `git.clone` | Clone repository | [Git](git.md) |
| `git.status` | Show git status | [Git](git.md) |
| `git.checkout` | Switch/create branches | [Git](git.md) |
| `git.commit` | Stage and commit | [Git](git.md) |
| `git.push` | Push to remote | [Git](git.md) |
| `git.fork` | Fork GitHub repository | [Git](git.md) |
| `git.pr_create` | Create pull request | [Git](git.md) |
| `git.worktree_add` | Create worktree | [Git](git.md) |
| `git.worktree_list` | List worktrees | [Git](git.md) |
| `git.worktree_remove` | Remove worktree | [Git](git.md) |
| `browse.fetch` | Fetch web page | [Browse](browse.md) |
| `browse.extract` | Extract from HTML | [Browse](browse.md) |
| `skill.import` | Import a skill | -- |
| `skill.validate` | Validate skill YAML | -- |
| `webhook.create` | Register webhook | -- |
| `webhook.list` | List webhooks | -- |
| `notify.webhook` | Send webhook payload | -- |
| `notify.cli` | Emit CLI notification | -- |
| `channel.notify` | Send channel message | -- |

## Events

Every primitive invocation emits events:

| Event | When |
|-------|------|
| `primitive.invoked` | Before execution, includes name and parameters |
| `primitive.completed` | After successful execution, includes result |
| `primitive.failed` | After failed execution, includes error message |

## Security

Primitives are the enforcement boundary for several security policies:

- **Allowlist**: The `PrimitiveRegistry` rejects calls to primitives not in the skill's `allowed_primitives`
- **Path policies**: Filesystem primitives (`fs.*`) enforce `PathPolicy` workspace boundaries
- **Domain allowlists**: Network primitives (`http.*`, `browse.*`) check allowed domains
- **Command allowlists**: `shell.exec` restricts which commands can be run
- **Sandbox integration**: `shell.exec` wraps commands in OS-level sandboxes (macOS `sandbox-exec`, Linux `bwrap`)
- **Secret redaction**: Primitive outputs pass through `RedactionEngine` before being stored as events
