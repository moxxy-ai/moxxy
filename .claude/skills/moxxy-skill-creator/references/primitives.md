# Moxxy Primitives Reference

All 34 primitives available to Moxxy agents, organized by namespace. Use these names in
the `allowed_primitives` array of skill frontmatter.

## Filesystem (`fs.*`)

| Primitive | Description |
|-----------|-------------|
| `fs.read` | Read a file from the agent's workspace |
| `fs.write` | Write/create a file in the agent's workspace |
| `fs.list` | List files and directories in the workspace |
| `fs.remove` | Remove a file or directory from the workspace |

Security: All operations are scoped to the agent's workspace via PathPolicy. No path traversal possible.

## Browse (`browse.*`)

| Primitive | Description |
|-----------|-------------|
| `browse.fetch` | Fetch a URL and extract content via CSS selector |
| `browse.extract` | Parse raw HTML content without making a network request |

Security: `browse.fetch` makes HTTP requests. Domain allowlist should include target sites.

## Git (`git.*`)

| Primitive | Description |
|-----------|-------------|
| `git.init` | Initialize a new git repository |
| `git.clone` | Clone a remote repository |
| `git.status` | Show working tree status |
| `git.commit` | Stage and commit changes |
| `git.push` | Push commits to remote |
| `git.checkout` | Switch or create branches |
| `git.pr_create` | Create a pull request (GitHub) |
| `git.fork` | Fork a repository |
| `git.worktree_add` | Add a git worktree |
| `git.worktree_list` | List git worktrees |
| `git.worktree_remove` | Remove a git worktree |

Security: Git operations may use vault secrets for authentication. Requires `vault.get` grant for private repos.

## Memory (`memory.*`)

| Primitive | Description |
|-----------|-------------|
| `memory.append` | Append a tagged entry to the agent's memory |
| `memory.search` | Search memory entries by tag or content |
| `memory.summarize` | Summarize memory entries |

Security: Memory is agent-scoped. No cross-agent access.

## Shell (`shell.*`)

| Primitive | Description |
|-----------|-------------|
| `shell.exec` | Execute a shell command from the allowlist |

Security: Commands are restricted to a configurable allowlist (e.g., `ls`, `cat`, `grep`, `find`, `echo`, `wc`).

## HTTP (`http.*`)

| Primitive | Description |
|-----------|-------------|
| `http.request` | Make an HTTP request (GET, POST, PUT, DELETE) |

Security: Domain allowlist must include all target hosts. Configure in agent settings.

## Webhook (`webhook.*`)

| Primitive | Description |
|-----------|-------------|
| `webhook.create` | Register a webhook endpoint |
| `webhook.list` | List registered webhooks |

Security: Webhooks are agent-scoped.

## Notify (`notify.*`)

| Primitive | Description |
|-----------|-------------|
| `notify.webhook` | Send a notification via a registered webhook |
| `notify.cli` | Send a notification to the CLI user |

Security: `notify.webhook` sends data to external URLs registered via `webhook.create`.

## Skill (`skill.*`)

| Primitive | Description |
|-----------|-------------|
| `skill.import` | Import a skill document (starts quarantined) |
| `skill.validate` | Validate a skill document without importing |

Security: All imported skills start in quarantine and require explicit approval.

## Channel (`channel.*`)

| Primitive | Description |
|-----------|-------------|
| `channel.notify` | Send a message through a channel (Telegram, Discord) |

Security: Uses ChannelBridge. Channel must be paired and active.

## Heartbeat (`heartbeat.*`)

| Primitive | Description |
|-----------|-------------|
| `heartbeat.create` | Create a recurring heartbeat (cron or interval) |
| `heartbeat.list` | List active heartbeats |
| `heartbeat.disable` | Disable a heartbeat |
| `heartbeat.delete` | Delete a heartbeat |
| `heartbeat.update` | Update heartbeat schedule or configuration |

Security: Heartbeats trigger skill execution. Supports cron expressions for scheduling.

## Vault (`vault.*`)

| Primitive | Description |
|-----------|-------------|
| `vault.set` | Store a secret in the vault |
| `vault.get` | Retrieve a secret (requires grant) |
| `vault.delete` | Delete a secret |
| `vault.list` | List secret keys (not values) |

Security: Secrets are encrypted. `vault.get` requires an explicit grant per secret per agent.

## Ask (`ask.*`)

| Primitive | Description |
|-----------|-------------|
| `user.ask` | Pause execution and ask the user a question |
| `agent.respond` | Provide a response to a pending user.ask |

Security: `user.ask` blocks the agent until the user responds or timeout (default 5 minutes).

## Agent (`agent.*`)

| Primitive | Description |
|-----------|-------------|
| `agent.spawn` | Spawn a child agent (lineage enforcement) |
| `agent.status` | Check status of an owned agent |
| `agent.list` | List child agents |
| `agent.stop` | Stop an owned agent |

Security: Lineage enforcement = agents can only manage their own children.
