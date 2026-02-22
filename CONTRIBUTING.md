# Contributing to moxxy

Thank you for your interest in contributing to moxxy! This guide will help you get started.

## Development Setup

### Prerequisites

- **Rust** (edition 2024) with `cargo`
- **Node.js** (v18+) and npm
- **SQLite3** development libraries
- **wasm32-wasip1** target (optional, for WASM agent runtime)

### Building from Source

```bash
# Clone the repository
git clone https://github.com/moxxy-ai/moxxy.git
cd moxxy

# Build the frontend (required before backend)
cd frontend && npm install && npm run build && cd ..

# Build the backend
cargo build --release

# Run first-time setup
./target/release/moxxy init

# Start the web dashboard
./target/release/moxxy web
```

### Development Workflow

```bash
# Backend: rebuild on changes
cargo build --release

# Frontend: dev server with hot reload (proxies API to :17890)
cd frontend && npm run dev

# Run diagnostics
./target/release/moxxy doctor
```

## Project Structure

```
src/
  main.rs                  # Entry point (delegates to cli/)
  logging.rs               # Tracing/SSE log writer
  cli/                     # CLI command dispatch
    mod.rs                 # Argument parsing, help text
    doctor.rs              # System diagnostics
    onboarding.rs          # First-time setup wizard
    channels.rs            # Telegram channel setup
    daemon.rs              # Gateway start/stop/restart
    agent_cmd.rs           # Agent restart/remove
    swarm.rs               # Swarm engine boot
  core/
    agent/                 # Agent instance lifecycle
      mod.rs               # AgentInstance, boot(), run()
      bootstrap.rs         # Core subsystem initialization
      interfaces.rs        # Interface attachment
      selfcheck.rs         # Health check heartbeat
    brain.rs               # ReAct loop (LLM + skill execution)
    container/             # WASM container runtime
      mod.rs               # Re-exports
      config.rs            # ContainerConfig, RuntimeConfig
      profiles.rs          # Image profiles (base/networked/full)
      image.rs             # Embedded WASM image extraction
      wasm.rs              # AgentContainer, host bridge functions
    memory/                # SQLite-based memory system
      mod.rs               # MemorySystem struct, constructor, lifecycle
      types.rs             # StmEntry, ScheduledJobRecord, etc.
      stm.rs               # Short-term memory CRUD
      ltm.rs               # Long-term memory
      swarm.rs             # Shared swarm intelligence
      schedule.rs          # Scheduled jobs CRUD
      mcp.rs               # MCP server records
    llm/                   # LLM provider abstraction
    vault/                 # Encrypted secrets storage
    lifecycle/             # Component lifecycle state machine
    mcp.rs                 # MCP client (Model Context Protocol)
    terminal.rs            # Terminal output helpers
  interfaces/
    web/                   # Axum API + web dashboard
      mod.rs               # Server structs, SSE, static files
      router.rs            # Route definitions
      handlers/            # 12 handler modules (agents, chat, etc.)
    cli/                   # Ratatui terminal UI
      mod.rs               # CliInterface struct
      ui.rs                # Message rendering
      events.rs            # Input event loop
      commands.rs          # Slash command handlers
      stream.rs            # SSE streaming
      history.rs           # Session history
    telegram.rs            # Telegram bot integration
    discord.rs             # Discord bot integration
    slack.rs               # Slack bot integration
    whatsapp.rs            # WhatsApp integration
    desktop.rs             # macOS global hotkey
    mobile.rs              # Mobile copilot endpoint
  skills/                  # Skill manager + native executor
frontend/                  # React 19 + Vite + Tailwind dashboard
agent_runtime/             # WASM agent runtime (wasm32-wasip1)
```

## Code Style

- **Rust edition**: 2024
- **Formatting**: `cargo fmt` before committing
- **Linting**: `cargo clippy` - address warnings where reasonable
- **Frontend**: Standard Prettier/ESLint via `npm run lint`
- **Commits**: Use conventional commit messages (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`)

## Adding a New Skill

Skills are script-based modules with a manifest and entry point:

1. Create a directory under `src/skills/builtins/your_skill/`
2. Add `manifest.toml` with skill metadata:
   ```toml
   [skill]
   name = "your_skill"
   description = "What the skill does"
   version = "1.0.0"
   executor_type = "shell"
   entrypoint = "run.sh"
   needs_network = false
   needs_fs_read = false
   needs_fs_write = false
   needs_env = false
   ```
3. Add `run.sh` (or `run.py`) with the skill logic
4. Skills are auto-embedded via `include_dir!` at compile time

## Adding a New Interface

1. Create a new file in `src/interfaces/` (e.g., `matrix.rs`)
2. Implement the `LifecycleComponent` trait
3. Register the interface in `src/core/agent/interfaces.rs`
4. Add `pub mod matrix;` to `src/interfaces/mod.rs`

## Adding a New LLM Provider

1. Create a new provider in `src/core/llm/providers/`
2. Implement the `LlmProvider` trait
3. Register it in `src/core/agent/bootstrap.rs`

## AI-Assisted Contributions

We actively encourage contributions from moxxy agents. If your agent discovers a bug, has a feature idea, or wants to implement an improvement, it can use the built-in `contribute` skill to participate directly.

### Quick start for agents

1. Store a GitHub token in the vault: go to the **Vault** tab in the web dashboard and add a secret named `GITHUB_TOKEN`, or use:
   ```
   <invoke name="manage_vault">["set", "GITHUB_TOKEN", "ghp_your_token"]</invoke>
   ```
2. Suggest a feature:
   ```
   <invoke name="contribute">["suggest", "Feature title", "Description of the feature"]</invoke>
   ```
3. Or implement it yourself:
   ```
   <invoke name="contribute">["implement", "Feature title", "What this changes", "feat/branch-name"]</invoke>
   # ... make changes, commit ...
   <invoke name="contribute">["submit", "PR title", "Description", "feat/branch-name"]</invoke>
   ```

Agent-submitted PRs are always opened as **drafts** and go through the same review process as human contributions.

## Pull Request Process

1. Fork the repository and create a feature branch
2. Make your changes with clear, focused commits
3. Ensure `cargo build --release` and `cd frontend && npm run build` both succeed
4. Open a PR against `master` with:
   - A clear title describing the change
   - Description of what and why
   - Any testing you've done

## Reporting Issues

Use [GitHub Issues](https://github.com/moxxy-ai/moxxy/issues) to report bugs or request features. Include:

- Steps to reproduce (for bugs)
- Expected vs actual behavior
- OS, Rust version, Node version
- Relevant log output (`moxxy logs`)

## License

By contributing to moxxy, you agree that your contributions will be licensed under the same license as the project.
