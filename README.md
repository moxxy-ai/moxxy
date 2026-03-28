<p align="center">
  <img src="https://moxxy.ai/logo-gradient.svg" alt="moxxy" width="200" />
</p>

<h3 align="center">Your Everyday AI Assistant Agents</h3>

<p align="center">
  A self-hosted multi-agent AI framework built in Rust. Complete data sovereignty with agents running on your own infrastructure.
</p>

<p align="center">
  <a href="https://crates.io/crates/moxxy-gateway"><img src="https://img.shields.io/badge/crates.io-moxxy-orange?style=flat-square&logo=rust&logoColor=white" alt="crates.io"></a>
  <a href="https://www.npmjs.com/package/moxxy-cli"><img src="https://img.shields.io/npm/v/moxxy-cli?style=flat-square&color=cb3837&logo=npm&logoColor=white&label=npm" alt="npm"></a>
  <a href="https://github.com/moxxy-ai/moxxy/actions"><img src="https://img.shields.io/github/actions/workflow/status/moxxy-ai/moxxy/ci.yml?branch=main&style=flat-square&logo=github&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/tests-940%2B%20passing-brightgreen?style=flat-square&logo=checkmarx&logoColor=white" alt="940+ tests passing">
  <img src="https://img.shields.io/badge/rust-1.80%2B-dea584?style=flat-square&logo=rust&logoColor=white" alt="Rust 1.80+">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-5FA04E?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22+">
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT%2FApache--2.0-blue?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="https://docs.moxxy.ai">Documentation</a> ·
  <a href="https://moxxy.ai">Website</a> ·
  <a href="https://github.com/moxxy-ai/moxxy">GitHub</a>
</p>

---

```bash
npm install --global @moxxy/cli
```

---

## What is Moxxy?

Moxxy is a self-hosted runtime for autonomous AI agents. Each agent gets its own isolated workspace with private memory, scoped secrets via OS keychain, and access to 85 built-in primitives. Agents run autonomously on schedules, respond to messages across channels, and coordinate through hierarchical sub-agent spawning or structured hive swarms - all on your own infrastructure with complete data sovereignty.

**Key features:**

- **Multi-agent isolation** - each agent has its own workspace, memory store, and scoped vault secrets
- **Agentic execution loop** - LLM-driven tool invocation with stuck detection and automatic recovery
- **Hive swarm orchestration** - queen/worker hierarchy with task boards, signal boards, and voting
- **85 built-in primitives** - filesystem, git, shell, HTTP, browsing, memory, webhooks, vault, MCP, skills, and more
- **Multiple interfaces** - Node.js CLI with interactive wizards, full-screen TUI, REST API, SSE streaming
- **Extensible skills** - Markdown files with YAML frontmatter that define agent capabilities and permissions
- **WASI plugin system** - sandboxed plugin execution with capability-based permissions
- **Scheduled autonomy** - cron-based heartbeats for proactive agent behavior
- **Real-time observability** - 60 SSE event types covering every agent action with audit logging

**What can you do with it?**

- Automate complex multi-step workflows with sub-agent delegation
- Orchestrate parallel workloads through hive swarms with task dependencies
- Monitor systems and respond to events via heartbeat scheduling
- Build conversational bots connected to Telegram and Discord
- Develop AI applications via the REST API with full event streaming

## Highlights

**Runtime** - 85 built-in primitives across filesystem, git, shell, HTTP, browsing, memory, webhooks, vault, MCP, skills, and multi-agent orchestration. Agents can only use primitives explicitly granted by their allowlist.

**Providers** - Anthropic and OpenAI providers built-in. Any OpenAI-compatible endpoint (xAI, DeepSeek, Google Gemini, etc.) can be added as a custom provider.

**Security** - Workspace-scoped filesystem access, command allowlists, domain-gated networking, OS keychain secrets with grant-based access, and automatic secret redaction in all events.

**Observability** - 60 SSE event types covering every agent action, full audit log persistence, and a TUI that streams events in real time.

**Skills** - Markdown files with YAML frontmatter that define agent capabilities. All skills start quarantined and must be explicitly approved before use.

**Orchestration** - Hierarchical sub-agent spawning with depth and fan-out limits, hive swarm coordination with task/signal boards, heartbeat scheduling (cron), and cancellation tokens.

## Quick Start

### Install

```bash
npm install --global @moxxy/cli
```

Then run the interactive setup:

```bash
moxxy init
```

This downloads the gateway binary from the latest GitHub release, starts it, and walks you through creating your first API token, configuring a provider, and setting up an agent.

### Interactive mode

Every command has an interactive wizard when run without flags:

```bash
moxxy provider install   # Pick a provider, set API key
moxxy agent create       # Choose provider, model, workspace
moxxy tui                # Open the full-screen chat interface
```

### Scripted mode

```bash
# Create a token
moxxy auth token create --scopes tokens:admin,agents:write,agents:read,runs:write,events:read
export MOXXY_TOKEN="mox_..."

# Install a provider and create an agent
moxxy provider install --id anthropic
moxxy agent create --provider anthropic --model claude-sonnet-4-20250514 --workspace ~/my-project

# Run a task
moxxy agent run --id <agent-id> --task "Refactor the auth module"

# Stream events
moxxy events tail --agent <agent-id>
```

### Verify everything works

```bash
moxxy doctor                     # System check
```

### Build from source

If you prefer to build locally:

**Prerequisites:** Rust 1.80+ ([rustup.rs](https://rustup.rs)), Node.js 22+ ([nodejs.org](https://nodejs.org))

```bash
git clone https://github.com/moxxy-ai/moxxy.git
cd moxxy

# Build the Rust workspace
cargo build --workspace

# Install the CLI globally
cd apps/moxxy-cli
npm install && npm link
cd ../..

# Run setup
moxxy init
```

## Architecture

```
                    ┌──────────────┐
                    │  moxxy CLI   │  Node.js - commands, wizards, TUI
                    └──────┬───────┘
                           │ HTTP / SSE
                    ┌──────┴───────┐
                    │   Gateway    │  Axum - REST API, auth, SSE streaming
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌─────┴──────┐  ┌──────┴──────┐
   │    Core     │  │   Vault    │  │   Runtime   │
   │  auth,      │  │  keychain, │  │  85 prims,  │
   │  events,    │  │  grants    │  │  providers, │
   │  skills     │  │            │  │  agent loop │
   └──────┬──────┘  └────────────┘  └──────┬──────┘
          │                                │
   ┌──────┴──────┐                  ┌──────┴──────┐
   │  Storage    │                  │  Channels   │
   │  SQLite WAL │                  │  Telegram,  │
   │  16 DAOs    │                  │  Discord    │
   └─────────────┘                  └─────────────┘
```

### Workspace (10 crates + CLI)

| Crate | Role |
|---|---|
| `moxxy-types` | Shared types, enums, errors |
| `moxxy-test-utils` | `TestDb`, fixture factories |
| `moxxy-storage` | SQLite WAL, 16 DAOs, row types |
| `moxxy-core` | Auth, agents, events, heartbeat, skills, memory |
| `moxxy-vault` | OS keychain backend, grant-based secret access |
| `moxxy-channel` | Telegram and Discord messaging bridges |
| `moxxy-gateway` | Axum REST + SSE server, auth middleware, audit logging |
| `moxxy-runtime` | 85 primitives, providers, agentic loop, agent kinds |
| `moxxy-plugin` | WASI-based plugin host |
| `moxxy-mcp` | Model Context Protocol integration |
| `moxxy-cli` | Node.js CLI with interactive wizards and TUI |

### Agent Workspace

Each agent lives in `~/.moxxy/agents/<id>/` with:

| File | Purpose |
|------|---------|
| `workspace/` | Sandboxed working directory (all file operations confined here) |
| `memory/` | Persistent memory journal |
| `config.yaml` | Agent configuration (provider, model, limits) |
| `allowlist.yaml` | Permitted primitives |

### Data directory

```
~/.moxxy/
├── moxxy.db              # SQLite database (16 tables)
├── bin/                  # Gateway binary
├── config/               # User configuration
├── logs/                 # Gateway logs
└── agents/{id}/
    ├── workspace/        # Sandboxed working directory
    └── memory/           # Persistent memory journal
```

## Built-in Primitives

| Category | Primitives | Description |
|----------|-----------|-------------|
| **Filesystem** | `fs.read`, `fs.write`, `fs.list`, `fs.remove`, `fs.cd` | Workspace-scoped file operations via PathPolicy |
| **Browse** | `browse.fetch`, `browse.extract` | HTTP + CSS selector fetching, pure HTML parsing |
| **Git** | `git.init`, `git.clone`, `git.status`, `git.commit`, `git.push`, `git.checkout`, `git.pr_create`, `git.fork`, `git.worktree_add/list/remove` | Full git workflow with worktree support |
| **Memory** | `memory.store`, `memory.recall`, `memory.stm_read`, `memory.stm_write` | Long-term with semantic search + short-term file-based memory |
| **Shell** | `shell.exec` | Command execution with allowlist enforcement |
| **HTTP** | `http.request` | Domain-allowlisted HTTP requests |
| **Webhook** | `webhook.register`, `webhook.list`, `webhook.listen`, `webhook.delete`, `webhook.update`, `webhook.rotate` | Receive and manage external events |
| **Notify** | `notify.cli` | Outbound CLI notifications |
| **Skill** | `skill.create`, `skill.execute`, `skill.find`, `skill.get`, `skill.list`, `skill.remove`, `skill.validate` | Full skill lifecycle management |
| **Channel** | `channel.notify` | Send messages via Telegram/Discord bridges |
| **Heartbeat** | `heartbeat.create/list/update/disable/delete` | Cron and interval-based scheduled autonomy |
| **Vault** | `vault.set/get/delete/list` | OS keychain secret management with grants |
| **Ask** | `user.ask`, `agent.respond` | Synchronous Q&A between agents and users |
| **Agent** | `agent.spawn/status/list/stop/dismiss`, `agent.self.get/update/persona_read/persona_write` | Sub-agent lifecycle + self-introspection |
| **Allowlist** | `allowlist.list/add/remove/deny/undeny` | Runtime primitive permission management |
| **Config** | `config.get`, `config.set` | Agent configuration management |
| **MCP** | `mcp.list`, `mcp.connect`, `mcp.disconnect`, `mcp.tool` | Model Context Protocol server integration |
| **Hive** | `hive.create/recruit/disband`, `hive.task_create/list/claim/complete/fail/review`, `hive.signal/board_read`, `hive.propose/vote/resolve_proposal`, `hive.assign/aggregate` | Swarm orchestration with task boards, signals, and voting |

## Skills

Skills are Markdown files with YAML frontmatter that define what an agent can do:

```markdown
---
id: code-review
name: Code Review
version: "1.0"
inputs_schema: {}
allowed_primitives:
  - fs.read
  - fs.list
  - memory.append
  - shell.exec
safety_notes: "Read-only. Shell restricted to safe commands."
---

# Instructions
Review code for security issues, performance, and style violations.
Use `fs.list` to discover files and `fs.read` to examine them.
```

All skills start **quarantined** and must be approved before use. The `allowed_primitives` list is enforced at runtime - even if all 85 primitives are registered, an agent can only invoke what its skill permits.


## Providers

| Provider | Type | Example Models | Env Var |
|---|---|---|---|
| Anthropic | Built-in | Claude Opus 4, Sonnet 4, Haiku | `ANTHROPIC_API_KEY` |
| OpenAI | Built-in | GPT-4.1, o3, o4-mini | `OPENAI_API_KEY` |
| xAI | OpenAI-compatible | Grok 3, Grok 3 Mini | `XAI_API_KEY` |
| Google Gemini | OpenAI-compatible | Gemini 2.5 Pro/Flash | `GOOGLE_API_KEY` |
| DeepSeek | OpenAI-compatible | R1, V3 | `DEEPSEEK_API_KEY` |
| Custom | OpenAI-compatible | Any model ID | Any env var |

Anthropic and OpenAI have dedicated provider implementations. Any OpenAI-compatible API can be registered as a custom provider via `moxxy provider install`.

## Hive Orchestration

The Hive system extends single-agent execution with structured multi-agent swarm coordination for larger jobs.

### How it works

1. A **queen** agent creates a hive with a coordination strategy (`consensus`, `dictator`, or `swarm`).
2. The queen recruits **workers** and **scouts** via `hive.recruit`, which spawns sub-agents with hive-specific capabilities.
3. The queen creates tasks with priorities, dependencies, and retry limits on a shared **task board**.
4. Workers self-organize: claim tasks via `hive.task_claim`, execute them, and report results via `hive.task_complete`.
5. Agents communicate through the **signal board** - append-only messages with tags, threading, and quality scores.
6. For collective decisions, members use **proposals and voting** with configurable quorum.
7. The queen's executor stays alive via `HiveEventListener` until all workers complete.
8. The queen calls `hive.disband` to terminate the hive and clean up workers.

### Hive roles

| Role | Capabilities |
|------|-------------|
| **Queen** | Create hive, recruit workers, create tasks, propose decisions, disband |
| **Worker** | Claim tasks, complete/fail tasks, post signals, vote on proposals |
| **Scout** | Same as worker - specializes in information gathering |

### Task lifecycle

```
pending → claimed (in_progress) → completed
                                → failed → retry (if attempts < max_retries)
                                         → failed (permanent)
```

Tasks support `depends_on` for DAG-style dependency chains - a task stays blocked until all dependencies complete.

### Agent hierarchy

Sub-agents spawned via `agent.spawn` or `hive.recruit` enforce lineage limits:

- **max_depth** (default 2) - prevents infinite recursion
- **max_total** (default 8 per parent) - caps fan-out
- Children inherit parent's config, workspace, and allowlist
- Ephemeral agents are leaf-only (cannot spawn further)
- Results flow back via `SubagentCompleted`/`SubagentFailed` events injected into parent's conversation

### Coordination strategies

- **Consensus** - decisions require quorum votes from members
- **Dictator** - queen makes all decisions unilaterally
- **Swarm** - workers self-organize with minimal queen oversight

## Security & Agent Isolation

Moxxy enforces strict workspace isolation through multiple security layers:

**Workspace confinement** - Every agent's file operations are restricted to its workspace directory via `PathPolicy`. There is no mechanism for an agent to read or write files outside this boundary.

**Primitive allowlists** - Skills define which primitives an agent can use. Even if all 85 primitives are registered, only explicitly allowed ones can be invoked. Child agents inherit the parent's allowlist.

**Command allowlists** - `shell.exec` enforces a configurable command allowlist. Only pre-approved commands can be executed.

**Domain-gated networking** - `http.request` enforces a domain allowlist. Agents cannot make arbitrary network requests.

**Vault isolation** - Secrets are stored in the OS keychain via `SecretBackend` trait. Access requires explicit grants scoped to specific agents. All secret values are automatically redacted from events via `RedactionEngine`.

**Auth tokens** - SHA-256 hashed tokens with `mox_` prefix, scoped permissions, and configurable TTL.

**WASI sandboxing** - The plugin system uses WASI for sandboxed execution with capability-based permissions.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MOXXY_API_URL` | `http://localhost:3000` | Gateway base URL |
| `MOXXY_TOKEN` | - | API bearer token |
| `MOXXY_HOME` | `~/.moxxy` | Data directory |
| `MOXXY_GATEWAY_URL` | - | Override gateway binary download URL (skips GitHub releases) |
| `MOXXY_GITHUB_REPO` | `moxxy-ai/moxxy` | GitHub repo for release downloads |
| `GITHUB_TOKEN` | - | GitHub token for authenticated API requests (avoids rate limits) |

## Local Development

When developing Moxxy itself, you'll want `moxxy init` to use your locally built gateway binary instead of downloading from GitHub releases.

### Option 1: Build and place the binary manually

```bash
cargo build -p moxxy-gateway --release
cp target/release/moxxy-gateway ~/.moxxy/bin/moxxy-gateway
```

`moxxy init` skips the download when the binary already exists at `~/.moxxy/bin/moxxy-gateway`.

### Option 2: Point to a local file or URL

Set `MOXXY_GATEWAY_URL` to either a local file path or an HTTP URL:

```bash
# Use a local binary directly (copies it into ~/.moxxy/bin/)
MOXXY_GATEWAY_URL=./target/release/moxxy-gateway moxxy init

# Or serve via HTTP
cd target/release && python3 -m http.server 9090
MOXXY_GATEWAY_URL=http://localhost:9090/moxxy-gateway moxxy init
```

### Option 3: Run the gateway directly from source

Skip `moxxy init`'s download entirely and run the gateway from the workspace:

```bash
cargo run -p moxxy-gateway          # starts on localhost:3000
moxxy init                           # detects the running gateway, skips download
```

### Running tests

```bash
cargo test --workspace               # ~940 Rust tests
cd apps/moxxy-cli && npm test        # 80 CLI tests
cargo clippy --workspace -- -D warnings
cargo fmt --all --check
```

## Links

- [Documentation](https://docs.moxxy.ai)
- [Website](https://moxxy.ai)
- [GitHub](https://github.com/moxxy-ai/moxxy)

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE) at your option.
