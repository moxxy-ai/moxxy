# Primitives Overview

Primitives are the tools that agents use to interact with the outside world. They provide capabilities like reading files, running shell commands, making HTTP requests, managing memory, and performing git operations.

## The Primitive Trait

Every primitive implements the `Primitive` trait:

```rust
#[async_trait]
pub trait Primitive: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    async fn invoke(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError>;
}
```

Each primitive has a unique dot-notation name (e.g., `fs.read`, `git.commit`) and accepts/returns JSON values. The `description()` method returns a human-readable summary used in tool schemas sent to the LLM. The `parameters_schema()` method returns a JSON Schema describing the expected input parameters. The `Send + Sync` bounds allow primitives to be called from any async task.

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
| `fs.remove` | Remove a file or directory | [Filesystem](fs.md) |
| `fs.cd` | Change working directory | [Filesystem](fs.md) |
| `browse.fetch` | Fetch web page | [Browse](browse.md) |
| `browse.extract` | Extract from HTML | [Browse](browse.md) |
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
| `memory.store` | Write memory entry | [Memory](memory.md) |
| `memory.recall` | Search memory | [Memory](memory.md) |
| `memory.stm_read` | Read short-term memory | [Memory](memory.md) |
| `memory.stm_write` | Write short-term memory | [Memory](memory.md) |
| `shell.exec` | Execute shell commands | [Shell](shell.md) |
| `http.request` | Make HTTP requests | [HTTP](http.md) |
| `webhook.register` | Register webhook | -- |
| `webhook.list` | List webhooks | -- |
| `webhook.delete` | Delete a webhook | -- |
| `webhook.update` | Update a webhook | -- |
| `webhook.rotate` | Rotate webhook secret | -- |
| `webhook.listen` | Listen for webhook events | -- |
| `notify.cli` | Emit CLI notification | -- |
| `notify.channel` | Send channel message | -- |
| `skill.create` | Create a skill | -- |
| `skill.validate` | Validate skill YAML | -- |
| `skill.list` | List available skills | -- |
| `skill.find` | Find a skill by query | -- |
| `skill.get` | Get skill details | -- |
| `skill.execute` | Execute a skill | -- |
| `skill.remove` | Remove a skill | -- |
| `heartbeat.create` | Create a heartbeat | -- |
| `heartbeat.list` | List heartbeats | -- |
| `heartbeat.disable` | Disable a heartbeat | -- |
| `heartbeat.delete` | Delete a heartbeat | -- |
| `heartbeat.update` | Update a heartbeat | -- |
| `vault.set` | Store a secret | -- |
| `vault.get` | Retrieve a secret | -- |
| `vault.delete` | Delete a secret | -- |
| `vault.list` | List secret keys | -- |
| `user.ask` | Ask the user a question | -- |
| `agent.respond` | Respond to an agent question | -- |
| `agent.spawn` | Spawn a child agent | -- |
| `agent.status` | Check agent status | -- |
| `agent.list` | List running agents | -- |
| `agent.stop` | Stop a running agent | -- |
| `agent.dismiss` | Dismiss a stopped agent | -- |
| `agent.self.get` | Get own agent config | -- |
| `agent.self.update` | Update own agent config | -- |
| `agent.self.persona_read` | Read own persona | -- |
| `agent.self.persona_write` | Write own persona | -- |
| `allowlist.list` | List allowlist entries | -- |
| `allowlist.add` | Add to allowlist | -- |
| `allowlist.remove` | Remove from allowlist | -- |
| `allowlist.deny` | Add to denylist | -- |
| `allowlist.undeny` | Remove from denylist | -- |
| `config.get` | Get a config value | -- |
| `config.set` | Set a config value | -- |
| `mcp.list` | List MCP connections | -- |
| `mcp.connect` | Connect to MCP server | -- |
| `mcp.disconnect` | Disconnect from MCP server | -- |
| `hive.create` | Create a hive | -- |
| `hive.recruit` | Recruit agent into hive | -- |
| `hive.task_create` | Create a hive task | -- |
| `hive.assign` | Assign task to agent | -- |
| `hive.aggregate` | Aggregate hive results | -- |
| `hive.resolve_proposal` | Resolve a hive proposal | -- |
| `hive.disband` | Disband a hive | -- |
| `hive.signal` | Send signal to hive | -- |
| `hive.board_read` | Read hive board | -- |
| `hive.task_list` | List hive tasks | -- |
| `hive.task_claim` | Claim a hive task | -- |
| `hive.task_complete` | Complete a hive task | -- |
| `hive.task_fail` | Fail a hive task | -- |
| `hive.task_review` | Review a hive task | -- |
| `hive.propose` | Create a hive proposal | -- |
| `hive.vote` | Vote on a hive proposal | -- |

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
