<p align="center">
  <h1 align="center">Moxxy</h1>
  <p align="center">Local-first agentic framework with a Rust core and Node.js CLI</p>
</p>

<p align="center">
  <a href="#installation"><strong>Installation</strong></a> &middot;
  <a href="#quick-start"><strong>Quick Start</strong></a> &middot;
  <a href="#architecture"><strong>Architecture</strong></a> &middot;
  <a href="#api-reference"><strong>API</strong></a> &middot;
  <a href="#contributing"><strong>Contributing</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/rust-1.80%2B-orange?logo=rust" alt="Rust 1.80+">
  <img src="https://img.shields.io/badge/node-%3E%3D22-green?logo=node.js" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/edition-2024-blue" alt="Rust Edition 2024">
  <img src="https://img.shields.io/badge/tests-224%20passing-brightgreen" alt="224 tests passing">
  <img src="https://img.shields.io/badge/clippy-zero%20warnings-brightgreen" alt="Clippy clean">
  <img src="https://img.shields.io/badge/license-MIT%2FApache--2.0-blue" alt="License">
</p>

---

Moxxy is a local-first agentic framework for building, running, and orchestrating AI agents with strong isolation, pluggable providers, skill-based composition, and full event observability. It runs entirely on your machine — no cloud required.

## Features

- **Full-screen TUI** — OpenCode-style split-pane chat interface with real-time SSE event streaming, agent info panel, and usage stats
- **Interactive wizards** — Guided step-by-step flows for every command; flags still work for scripting/CI
- **Built-in provider catalog** — Anthropic, OpenAI, xAI, Google Gemini, DeepSeek with frontier models + custom provider support
- **Pluggable providers** — Any OpenAI-compatible endpoint with custom model IDs and API key management
- **Skill-based agents** — Markdown skills with YAML frontmatter, declared primitive allowlists, and a quarantine-before-approval security model
- **Per-agent isolation** — Separate workspace (`~/.moxxy/agents/{id}/`), memory store, runtime sandbox, and scoped secrets
- **Sub-agent orchestration** — Hierarchical agent spawning with bounded depth and fan-out limits
- **Heartbeat scheduling** — Minute-granularity cron with per-agent serialized job queues
- **Vault secrets** — OS keychain integration with explicit grant-based access control
- **Full SSE event stream** — 25 event types covering every action, with automatic secret redaction
- **Scoped API tokens** — SHA-256 hashed PATs with 7 permission scopes, optional TTL, and instant revocation
- **Contract-first API** — OpenAPI 3.1.0 specification with Axum-powered REST gateway

## Installation

### Quick install (curl)

```bash
curl -fsSL https://moxxy.ai/install.sh | sh
```

### Build from source

**Prerequisites:** Rust 1.80+, Node.js 22+

```bash
git clone https://github.com/your-org/moxxy.git
cd moxxy

# Build all Rust crates
cargo build --workspace --release

# Install the CLI
cd apps/moxxy-cli
npm install && npm link
```

### Verify installation

```bash
moxxy doctor                     # Check everything is working
cargo test --workspace           # 187 Rust tests
cd apps/moxxy-cli && npm test    # 37 CLI tests
```

### Building release binaries

Build platform-specific gateway binaries for distribution:

```bash
# Build for current platform
./scripts/build-gateway.sh dist

# Build all targets (macOS + Linux, arm64 + x86_64)
./scripts/build-gateway.sh dist --all

# Build specific targets
./scripts/build-gateway.sh dist darwin-arm64 linux-x86_64
```

Output:
```
dist/
├── moxxy-gateway-darwin-arm64
├── moxxy-gateway-darwin-x86_64
├── moxxy-gateway-linux-arm64
├── moxxy-gateway-linux-x86_64
└── checksums.sha256
```

Upload the contents of `dist/` to your download server. The `install.sh` script fetches the correct binary by platform.

## Quick Start

### The easy way (interactive wizards)

Just type `moxxy` and follow the guides:

```bash
moxxy init              # Setup wizard: gateway, token, config
moxxy provider install  # Pick a provider, configure API key
moxxy agent create      # Guided agent creation
moxxy tui               # Full-screen chat interface
```

Every command launches an interactive wizard when run without flags.

### The scripted way (flags)

```bash
# 1. Start the gateway
cargo run -p moxxy-gateway

# 2. Bootstrap token
moxxy auth token create --scopes tokens:admin,agents:write,agents:read,runs:write,events:read
export MOXXY_TOKEN="mox_..."

# 3. Install a provider
moxxy provider install --id anthropic

# 4. Create and run an agent
moxxy agent create --provider anthropic --model claude-sonnet-4-20250514 --workspace ~/my-project
moxxy agent run --id <agent-id> --task "Refactor the auth module"

# 5. Watch events
moxxy events tail --agent <agent-id>
```

### Full-screen TUI

```bash
moxxy tui                    # Auto-select agent or pick from list
moxxy chat --agent <id>      # Specify agent directly
```

```
┌─────────────────────────────────┬──────────────────────┐
│  Chat                           │  Agent Info          │
│                                 │                      │
│  > You: Refactor auth module    │  ID: 019cac...       │
│                                 │  Provider: anthropic │
│  Assistant: I'll analyze the    │  Model: claude-4     │
│  auth module and refactor...    │  Status: ● running   │
│                                 │                      │
│  [skill.invoked] fs.read        │  ── Usage ──         │
│  [skill.completed] fs.read      │  Tokens: 12,450      │
│                                 │  Events: 34          │
│                                 │                      │
│                                 │  ── Activity ──      │
│                                 │  fs.read  ███ 12     │
│                                 │  fs.write ██  8      │
├─────────────────────────────────┴──────────────────────┤
│  > Type a task...                            Ctrl+C    │
└────────────────────────────────────────────────────────┘
```

## Architecture

```
                    ┌──────────────┐
                    │  moxxy CLI   │  Node.js interactive + scriptable
                    │  (Node.js)   │  commands, SSE consumer
                    └──────┬───────┘
                           │ HTTP/SSE
                    ┌──────┴───────┐
                    │   Gateway    │  Axum REST + SSE server
                    │  (moxxy-     │  auth middleware, route handlers,
                    │   gateway)   │  heartbeat cron
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌─────┴──────┐  ┌──────┴──────┐
   │    Core     │  │   Vault    │  │   Runtime   │
   │ (moxxy-    │  │ (moxxy-   │  │  (moxxy-   │
   │  core)     │  │  vault)   │  │   runtime) │
   └──────┬──────┘  └─────┬──────┘  └──────┬──────┘
          │                │                │
   ┌──────┴──────┐  ┌─────┴──────┐         │
   │  Storage    │  │  OS        │         │
   │ (moxxy-    │  │  Keychain  │    ┌────┴────┐
   │  storage)  │  └────────────┘    │  Agent  │
   └──────┬──────┘                   │ Process │
          │                          └─────────┘
   ┌──────┴──────┐
   │   SQLite    │
   │   (WAL)     │
   └─────────────┘
```

### Crate Map

| Crate | Purpose | Dependencies |
|-------|---------|-------------|
| **moxxy-types** | Shared types, enums, error definitions | serde, thiserror |
| **moxxy-test-utils** | `TestDb`, fixture factories, proptest strategies | rusqlite, moxxy-types |
| **moxxy-storage** | SQLite DAOs, row types, `Database` wrapper | rusqlite, moxxy-types |
| **moxxy-core** | Domain logic — auth, agents, events, heartbeat, skills, security, memory | moxxy-types, sha2, tokio |
| **moxxy-vault** | Secret backend abstraction, grant-based access policy | moxxy-types, moxxy-storage, keyring |
| **moxxy-gateway** | Axum REST API, auth middleware, SSE streaming | moxxy-types, moxxy-storage, moxxy-core, axum |
| **moxxy-runtime** | Primitive system, agent process lifecycle, provider trait | moxxy-types, moxxy-core, tokio |

### Database Schema

11 tables managed via `migrations/0001_init.sql`:

| Table | Purpose |
|-------|---------|
| `api_tokens` | Hashed PATs with scopes and TTL |
| `providers` | Registered provider plugins |
| `provider_models` | Available models per provider |
| `agents` | Agent configuration and state |
| `heartbeats` | Scheduled heartbeat rules |
| `skills` | Installed skills with quarantine status |
| `memory_index` | Agent memory metadata and tags |
| `memory_vec` | Embedding vectors for semantic search |
| `vault_secret_refs` | Secret reference metadata |
| `vault_grants` | Agent-to-secret access grants |
| `event_audit` | Full event audit log |

## API Reference

The API is defined contract-first in [`openapi/openapi.yaml`](openapi/openapi.yaml). All endpoints require a Bearer token except the bootstrap token creation.

### Authentication

```
POST   /v1/auth/tokens          Create API token (bootstrap: no auth required)
GET    /v1/auth/tokens          List tokens
DELETE /v1/auth/tokens/{id}     Revoke token
```

**Token scopes:** `agents:read`, `agents:write`, `runs:write`, `vault:read`, `vault:write`, `tokens:admin`, `events:read`

### Agents

```
GET    /v1/agents               List all agents
POST   /v1/agents               Create agent
GET    /v1/agents/{id}          Get agent status
POST   /v1/agents/{id}/runs    Start run
POST   /v1/agents/{id}/stop    Stop run
POST   /v1/agents/{id}/subagents  Spawn sub-agent
```

### Providers

```
GET    /v1/providers              List installed providers
POST   /v1/providers              Install provider with models
GET    /v1/providers/{id}/models  List available models
```

### Skills

```
POST   /v1/agents/{id}/skills/install           Install skill (quarantined)
POST   /v1/agents/{id}/skills/approve/{skill_id}  Approve skill
```

### Heartbeats

```
POST   /v1/agents/{id}/heartbeats   Create heartbeat rule
GET    /v1/agents/{id}/heartbeats   List heartbeat rules
```

### Vault

```
GET    /v1/vault/secrets        List secret references
POST   /v1/vault/secrets        Create secret reference
POST   /v1/vault/grants         Grant agent access to secret
```

### Events (SSE)

```
GET    /v1/events/stream        SSE event stream (?agent_id=...&run_id=...)
```

#### Event Types (25)

| Category | Events |
|----------|--------|
| Run lifecycle | `run.started`, `run.completed`, `run.failed` |
| Messages | `message.delta`, `message.final` |
| Model | `model.request`, `model.response` |
| Skills | `skill.invoked`, `skill.completed`, `skill.failed` |
| Primitives | `primitive.invoked`, `primitive.completed`, `primitive.failed` |
| Memory | `memory.read`, `memory.write` |
| Vault | `vault.requested`, `vault.granted`, `vault.denied` |
| Heartbeat | `heartbeat.triggered`, `heartbeat.completed`, `heartbeat.failed` |
| Sub-agents | `subagent.spawned`, `subagent.completed` |
| Security | `security.violation`, `sandbox.denied` |

## CLI Reference

```
moxxy                                               Interactive menu
moxxy init                                          First-time setup wizard
moxxy tui [--agent <id>]                            Full-screen chat interface
moxxy chat [--agent <id>]                           Alias for tui
moxxy doctor                                        Diagnose installation
moxxy uninstall                                     Remove all Moxxy data
moxxy auth token create [--scopes <s>] [--ttl <n>]  Create API token
moxxy auth token list [--json]                      List tokens
moxxy auth token revoke <id>                        Revoke token
moxxy agent create [--provider <p>] [--model <m>]   Create agent (wizard if no flags)
moxxy agent run [--id <id>] [--task "task"]          Start agent run
moxxy agent stop [--id <id>]                        Stop agent
moxxy agent status [--id <id>] [--json]             Agent status
moxxy provider install [--id <name>]                Install provider (wizard if no flags)
moxxy provider list                                 List installed providers
moxxy skill import [--agent <id>]                   Import skill (wizard if no flags)
moxxy skill approve --agent <id> --skill <id>       Approve quarantined skill
moxxy heartbeat set [--agent <id>]                  Set heartbeat rule (wizard if no flags)
moxxy heartbeat list --agent <id>                   List heartbeat rules
moxxy vault add [--key <k>] [--backend <b>]         Add secret (wizard if no flags)
moxxy vault grant [--agent <id>] [--secret <id>]    Grant agent access to secret
moxxy events tail [--agent <id>] [--run <id>]       Stream live events
moxxy gateway start|stop|restart|status|logs        Manage gateway process
```

All commands launch an **interactive wizard** when run without sufficient flags in a TTY. Add `--json` for machine-readable output.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOXXY_API_URL` | `http://localhost:3000` | Gateway API base URL |
| `MOXXY_TOKEN` | (none) | API token for authentication |
| `MOXXY_HOME` | `~/.moxxy` | Data directory (database, agents, config) |

### Built-in Providers

| Provider | Models | API Key Env |
|----------|--------|-------------|
| **Anthropic** | Claude Sonnet 5, Opus 4, Sonnet 4, Haiku 4 | `ANTHROPIC_API_KEY` |
| **OpenAI** | GPT-5.2, GPT-4.1, o3, o4-mini, GPT-4o | `OPENAI_API_KEY` |
| **xAI** | Grok 4, Grok 3, Grok 3 Mini/Fast | `XAI_API_KEY` |
| **Google Gemini** | Gemini 3.1 Pro, 2.5 Pro/Flash | `GOOGLE_API_KEY` |
| **DeepSeek** | V4, R1, V3 | `DEEPSEEK_API_KEY` |
| **ZAI / ZAI Plan** | Pro, Standard, Fast | `ZAI_API_KEY` |
| **Custom** | Any model ID | Any env var |

## Security Model

### Filesystem Isolation

- Agents can only read/write within their workspace directory
- Core mount is read-only (for built-in primitives)
- Canonical path resolution blocks `..` traversal
- Symlink escape detection on Unix systems

### Capability Gating

- Skills declare required primitives in YAML frontmatter
- Runtime enforces primitive allowlists at invocation time
- Network egress is default-deny with per-agent domain allowlists
- Shell execution is restricted to explicitly allowed commands

### Secret Handling

- No raw environment variable inheritance from host
- Secrets stored in OS keychain (macOS Keychain, Linux secret-service)
- Agent access requires explicit grant via API
- Secret values are automatically redacted in all event payloads

### Token Security

- Tokens are SHA-256 hashed at rest — plaintext is never stored
- 7 granular permission scopes
- Optional TTL with immediate revocation
- Full audit trail in `event_audit` table

## Built-in Primitives

| Primitive | Description |
|-----------|-------------|
| `fs.read` | Read file contents (workspace-scoped) |
| `fs.write` | Write file contents (workspace-scoped) |
| `fs.list` | List directory entries (workspace-scoped) |
| `shell.exec` | Execute allowed commands with timeout and output caps |
| `http.request` | HTTP requests to allowed domains with size limits |
| `memory.append` | Write timestamped markdown memory entry |
| `memory.search` | Search memory by content and tags |
| `memory.summarize` | Generate memory summary with entry counts |
| `notify.webhook` | Send webhook POST to allowed domains |
| `notify.cli` | Emit notification event to CLI subscribers |
| `skill.import` | Import and quarantine a new skill |
| `skill.validate` | Validate skill frontmatter without importing |

## Skill Format

Skills are Markdown files with YAML frontmatter:

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
safety_notes: "Read-only access to workspace files"
---

# Instructions

Review the code in the workspace for:
1. Security vulnerabilities
2. Performance issues
3. Code style violations

Write findings to memory for later retrieval.
```

**Required frontmatter fields:** `id`, `name`, `version`, `inputs_schema`, `allowed_primitives`, `safety_notes`

**Import flow:** Source accepted -> Quarantine -> Validate frontmatter -> Emit review event -> Require explicit approval

## Project Structure

```
moxxy/
├── Cargo.toml                    # Virtual workspace manifest
├── rust-toolchain.toml           # Rust edition 2024
├── install.sh                    # One-line installer
├── scripts/
│   └── build-gateway.sh          # Cross-platform release builder
├── migrations/
│   └── 0001_init.sql             # SQLite schema (11 tables)
├── openapi/
│   └── openapi.yaml              # OpenAPI 3.1.0 contract
├── crates/
│   ├── moxxy-types/              # Shared types and errors
│   ├── moxxy-test-utils/         # Test fixtures and TestDb
│   ├── moxxy-storage/            # SQLite DAOs (9 data access objects)
│   ├── moxxy-core/               # Domain logic (7 modules)
│   ├── moxxy-vault/              # Secret management
│   ├── moxxy-gateway/            # REST + SSE server + binary
│   └── moxxy-runtime/            # Primitives and agent process
└── apps/
    └── moxxy-cli/                # Node.js CLI
        ├── src/
        │   ├── tui/              # Full-screen Ink TUI
        │   ├── commands/         # Command handlers with wizards
        │   ├── ui.js             # Shared wizard utilities
        │   └── api-client.js     # Gateway HTTP client
        └── test/
```

### Data Directory (`~/.moxxy/`)

```
~/.moxxy/
├── moxxy.db                      # SQLite database
├── config/                       # Configuration files
└── agents/
    └── {agent-id}/
        ├── workspace/            # Agent working directory
        └── memory/               # Agent memory journal
```

## Testing

The project was built with strict TDD (Red -> Green -> Refactor). Every module has tests written before implementation.

```bash
# Run all Rust tests (187 tests)
cargo test --workspace

# Run CLI tests (37 tests)
cd apps/moxxy-cli && npm test

# Run with verbose output
cargo test --workspace -- --nocapture

# Run a specific crate's tests
cargo test -p moxxy-core
cargo test -p moxxy-gateway

# Run a specific test
cargo test -p moxxy-core -- auth::token::tests::issued_token_has_mox_prefix
```

### Test Coverage by Crate

| Crate | Unit | Integration | Property | Total |
|-------|-----:|------------:|---------:|------:|
| moxxy-types | 7 | 0 | 2 | 9 |
| moxxy-test-utils | 3 | 0 | 0 | 3 |
| moxxy-storage | 0 | 55 | 0 | 55 |
| moxxy-core | 27 | 12 | 8 | 47 |
| moxxy-vault | 0 | 10 | 0 | 10 |
| moxxy-gateway | 0 | 29 | 0 | 29 |
| moxxy-runtime | 10 | 24 | 0 | 34 |
| moxxy-cli | 37 | 0 | 0 | 37 |
| **Total** | **84** | **130** | **10** | **224** |

## Contributing

### Development Setup

```bash
# Clone and build
git clone https://github.com/your-org/moxxy.git
cd moxxy
cargo build --workspace

# Run tests
cargo test --workspace

# Lint
cargo clippy --workspace -- -D warnings
cargo fmt --all --check

# CLI development
cd apps/moxxy-cli
npm test
```

### TDD Workflow

This project follows strict TDD. When adding new functionality:

1. **RED** — Write failing tests first. They must compile but fail.
2. **GREEN** — Write the minimum code to make every test pass.
3. **REFACTOR** — Improve structure while keeping all tests green.

### Commit Convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `refactor:` — Code change that neither fixes a bug nor adds a feature
- `test:` — Adding or updating tests
- `docs:` — Documentation changes

### Code Quality

Before submitting a PR, ensure:

```bash
cargo test --workspace                    # All tests pass
cargo clippy --workspace -- -D warnings   # No clippy warnings
cargo fmt --all --check                   # Code is formatted
cd apps/moxxy-cli && npm test             # CLI tests pass
```

## Roadmap

- [x] Full-screen TUI (Ink-based split-pane chat interface)
- [x] Interactive CLI wizards (@clack/prompts)
- [x] Built-in provider catalog with frontier models
- [x] `~/.moxxy` data directory with agent workspaces
- [x] Doctor and uninstall commands
- [x] Cross-platform release build script
- [ ] Provider plugin host (WASI-based signed plugin loading)
- [ ] Process isolation (Linux bubblewrap/namespaces, macOS seatbelt)
- [ ] Vector search via `sqlite-vec` for semantic memory retrieval
- [ ] Memory compaction and summarization pipeline
- [ ] Sub-agent process orchestration with lifecycle management
- [ ] E2E integration test suite (token -> agent -> run -> SSE)
- [ ] Markdown rendering in TUI (assistant responses)
- [ ] TUI command palette and slash commands
- [ ] Multi-agent TUI tabs
- [ ] Metrics and observability (tracing integration)
- [ ] Documentation site

## License

Licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT License ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
