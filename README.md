<p align="center">
  <img src="https://moxxy.ai/logo-gradient.svg" alt="Moxxy" width="120" />
</p>

<h1 align="center">Moxxy</h1>

<p align="center">
  <strong>Local-first agentic framework for building, running, and orchestrating AI agents.</strong><br>
  Rust core. Node.js CLI. No cloud required.
</p>

<p align="center">
  <a href="https://crates.io/crates/moxxy-gateway"><img src="https://img.shields.io/badge/crates.io-moxxy-orange?logo=rust&logoColor=white" alt="crates.io"></a>
  <a href="https://www.npmjs.com/package/moxxy-cli"><img src="https://img.shields.io/npm/v/moxxy-cli?color=cb3837&logo=npm&logoColor=white&label=npm" alt="npm"></a>
  <a href="https://github.com/moxxy-ai/moxxy/actions"><img src="https://img.shields.io/github/actions/workflow/status/moxxy-ai/moxxy/ci.yml?branch=main&logo=github&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/tests-506%20passing-brightgreen?logo=checkmarx&logoColor=white" alt="506 tests passing">
  <img src="https://img.shields.io/badge/rust-1.80%2B-dea584?logo=rust&logoColor=white" alt="Rust 1.80+">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-5FA04E?logo=node.js&logoColor=white" alt="Node.js 22+">
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT%2FApache--2.0-blue" alt="License"></a>
</p>

<p align="center">
  <a href="#getting-started"><strong>Getting Started</strong></a> ·
  <a href="docs/API_REFERENCE.md"><strong>API Reference</strong></a> ·
  <a href="#architecture"><strong>Architecture</strong></a> ·
  <a href="examples/skills/"><strong>Example Skills</strong></a> ·
  <a href="CONTRIBUTING.md"><strong>Contributing</strong></a>
</p>

---

Moxxy gives you a complete toolkit for running AI agents on your own machine = with strong isolation, pluggable LLM providers, a skill-based permission model, and real-time event observability. Every agent gets its own sandboxed workspace, memory store, and scoped secrets. Orchestrate single agents or hierarchical multi-agent workflows, all through a REST API or a full-screen terminal UI.

## Highlights

**Runtime** = 34 built-in primitives across filesystem, git, shell, HTTP, browsing, memory, webhooks, vault, and multi-agent orchestration. Agents can only use primitives explicitly granted by their skill.

**Providers** = Ship with Anthropic, OpenAI, xAI, Google Gemini, DeepSeek, and ZAI out of the box. Add any OpenAI-compatible endpoint as a custom provider.

**Security** = Workspace-scoped filesystem access, command allowlists, domain-gated networking, OS keychain secrets with grant-based access, and automatic secret redaction in all events.

**Observability** = 28 SSE event types covering every agent action, full audit log persistence, and a split-pane TUI that streams events in real time.

**Skills** = Markdown files with YAML frontmatter that define agent capabilities. All skills start quarantined and must be explicitly approved before use.

**Orchestration** = Hierarchical sub-agent spawning with depth and fan-out limits, heartbeat scheduling (cron), and cancellation tokens.

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

## Getting Started

### Prerequisites

- **Rust** 1.80+ ([rustup.rs](https://rustup.rs))
- **Node.js** 22+ ([nodejs.org](https://nodejs.org))

### 1. Clone and build

```bash
git clone https://github.com/moxxy-ai/moxxy.git
cd moxxy

# Build the Rust workspace
cargo build --workspace

# Install the CLI globally
cd apps/moxxy-cli
npm install && npm link
cd ../..
```

### 2. Start the gateway

```bash
cargo run -p moxxy-gateway
```

The gateway starts on `http://localhost:3000` by default.

### 3. Run the setup wizard

```bash
moxxy init
```

This walks you through creating your first API token, configuring a provider, and setting up an agent.

### 4. Interactive mode

Every command has an interactive wizard when run without flags:

```bash
moxxy provider install   # Pick a provider, set API key
moxxy agent create       # Choose provider, model, workspace
moxxy tui                # Open the full-screen chat interface
```

### 5. Scripted mode

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
cargo test --workspace           # 448 Rust tests
cd apps/moxxy-cli && npm test    # 58 CLI tests
```

## Architecture

```
                    ┌──────────────┐
                    │  moxxy CLI   │  Node.js = commands, wizards, TUI
                    └──────┬───────┘
                           │ HTTP / SSE
                    ┌──────┴───────┐
                    │   Gateway    │  Axum = REST API, auth, SSE streaming
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌─────┴──────┐  ┌──────┴──────┐
   │    Core     │  │   Vault    │  │   Runtime   │
   │  auth,      │  │  keychain, │  │  34 prims,  │
   │  events,    │  │  grants    │  │  providers, │
   │  skills     │  │            │  │  agent loop │
   └──────┬──────┘  └────────────┘  └──────┬──────┘
          │                                │
   ┌──────┴──────┐                  ┌──────┴──────┐
   │  Storage    │                  │  Channels   │
   │  SQLite WAL │                  │  Telegram,  │
   │  15 DAOs    │                  │  Discord    │
   └─────────────┘                  └─────────────┘
```

### Workspace (9 crates + CLI)

| Crate | Role |
|---|---|
| `moxxy-types` | Shared types, enums, errors |
| `moxxy-test-utils` | `TestDb`, fixture factories |
| `moxxy-storage` | SQLite DAOs, row types, migration runner |
| `moxxy-core` | Auth, agents, events, heartbeat, skills, memory |
| `moxxy-vault` | OS keychain backend, grant-based secret access |
| `moxxy-channel` | Telegram and Discord messaging bridges |
| `moxxy-gateway` | Axum REST + SSE server, auth middleware, audit logging |
| `moxxy-runtime` | 34 primitives, provider trait, agentic loop |
| `moxxy-plugin` | WASI-based plugin host |
| `moxxy-cli` | Node.js CLI with interactive wizards and TUI |

### Data directory

```
~/.moxxy/
├── moxxy.db              # SQLite database (17 tables)
├── config/               # User configuration
└── agents/{id}/
    ├── workspace/        # Sandboxed working directory
    └── memory/           # Persistent memory journal
```

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

All skills start **quarantined** and must be approved before use. The `allowed_primitives` list is enforced at runtime = even if all 34 primitives are registered, an agent can only invoke what its skill permits.

See [`examples/skills/`](examples/skills/) for ready-to-use skills including code review, git workflow, web scraping, and webhook notifications.

## Providers

| Provider | Example Models | Env Var |
|---|---|---|
| Anthropic | Claude Sonnet 5, Opus 4, Haiku 4 | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-5.2, GPT-4.1, o3, o4-mini | `OPENAI_API_KEY` |
| xAI | Grok 4, Grok 3, Grok 3 Mini | `XAI_API_KEY` |
| Google Gemini | Gemini 3.1 Pro, 2.5 Pro/Flash | `GOOGLE_API_KEY` |
| DeepSeek | V4, R1, V3 | `DEEPSEEK_API_KEY` |
| ZAI | Pro, Standard, Fast | `ZAI_API_KEY` |
| Custom | Any model ID | Any env var |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MOXXY_API_URL` | `http://localhost:3000` | Gateway base URL |
| `MOXXY_TOKEN` | = | API bearer token |
| `MOXXY_HOME` | `~/.moxxy` | Data directory |

## Documentation

| Document | Description |
|---|---|
| [API Reference](docs/API_REFERENCE.md) | Full REST API with all endpoints, events, and auth |
| [Contributing](CONTRIBUTING.md) | Dev setup, TDD workflow, code quality, commit conventions |
| [Example Skills](examples/skills/) | Ready-to-use skill definitions |
| [OpenAPI Spec](openapi/openapi.yaml) | Machine-readable API contract (OpenAPI 3.1.0) |

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE) at your option.
