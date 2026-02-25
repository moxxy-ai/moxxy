# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
# Backend (Rust, edition 2024)
cargo build --release        # Production build → target/release/moxxy

# Frontend (React + Vite + Tailwind)
cd frontend && npm install && npm run build   # Builds to frontend/dist/

# WASM Agent Runtime
cd agent_runtime && cargo build --target wasm32-wasip1 --release

# Run
./target/release/moxxy web    # Web dashboard at http://127.0.0.1:3000
./target/release/moxxy tui    # Terminal UI

# Daemon management
./target/release/moxxy start|stop|status|restart
```

> **Note:** `frontend/dist/` is not checked into git. The `build.rs` script automatically runs `npm ci && npm run build` if `frontend/dist/` is missing, so `cargo build` just works. Node.js must be installed.

## Architecture Overview

moxxy is an autonomous multi-agent AI framework. Each agent runs as an independent tokio task with isolated memory, skills, and LLM access.

### Core Loop

Agents use a **ReAct loop** (`src/core/brain.rs`): trigger → LLM generates response with `<invoke>` XML tags → SkillManager executes skill → result fed back → loop (max 10 iterations).

### Agent Isolation

Each agent lives in `~/.moxxy/agents/<name>/` with:
- `persona.md` - system prompt
- `memory.db` - private SQLite (STM + LTM with vec0 embeddings)
- `container.toml` - runtime config (native or WASM sandbox)
- `skills/` - agent-specific skill modules

### Module Map

- **`src/main.rs`** - Entry point only, delegates to `cli::run_main()`
- **`src/logging.rs`** - SSE log writer for tracing integration
- **`src/cli/`** - CLI command dispatch
  - `mod.rs` - argument parsing, help text, `run_main()`
  - `doctor.rs` - system diagnostics (`moxxy doctor`)
  - `install.rs` - non-interactive setup (`moxxy install`)
  - `onboarding.rs` - interactive setup wizard (`moxxy init`)
  - `channels.rs` - Telegram channel setup
  - `daemon.rs` - gateway start/stop/restart/status
  - `agent_cmd.rs` - agent restart/remove
  - `swarm.rs` - swarm engine boot loop
- **`src/core/agent/`** - Agent instance lifecycle
  - `mod.rs` - `AgentInstance`, type aliases, `boot()`, `run()`
  - `bootstrap.rs` - core subsystem init (memory, vault, skills, LLM)
  - `interfaces.rs` - interface attachment (Telegram, Discord, etc.)
  - `selfcheck.rs` - health check heartbeat
- **`src/core/brain.rs`** - `AutonomousBrain` ReAct loop, skill invocation parsing
- **`src/core/container/`** - WASM container runtime
  - `config.rs` - `ContainerConfig`, `RuntimeConfig`, `CapabilityConfig`
  - `profiles.rs` - image profiles (base/networked/full)
  - `image.rs` - embedded WASM image extraction
  - `wasm.rs` - `AgentContainer`, host bridge functions
- **`src/core/memory/`** - SQLite-based memory system
  - `mod.rs` - `MemorySystem` struct, constructor, lifecycle
  - `types.rs` - `StmEntry`, `ScheduledJobRecord`, `McpServerRecord`
  - `stm.rs` - short-term memory read/write
  - `ltm.rs` - long-term memory
  - `swarm.rs` - shared swarm intelligence
  - `schedule.rs` - scheduled jobs CRUD
  - `mcp.rs` - MCP server records
- **`src/core/vault/`** - `SecretsVault` encrypted credential storage
- **`src/core/llm/`** - `LlmManager` with trait-based providers (OpenAI, Google, Z.Ai)
- **`src/core/lifecycle/`** - State machine: Init → PluginsLoad → ConnectChannels → Ready → Shutdown
- **`src/core/mcp.rs`** - MCP client (Model Context Protocol)
- **`src/interfaces/web/`** - Axum API server + web dashboard
  - `mod.rs` - server structs, SSE endpoint, static file handler
  - `router.rs` - API route definitions
  - `handlers/` - 12 handler modules (agents, chat, memory, skills, vault, channels, schedules, mcp, config, proxy, webhooks, mobile)
- **`src/interfaces/cli/`** - Ratatui terminal UI
  - `mod.rs` - `CliInterface` struct, lifecycle
  - `ui.rs` - message rendering, markdown parsing
  - `events.rs` - input event loop
  - `commands.rs` - slash command handlers
  - `stream.rs` - SSE streaming
  - `history.rs` - session history
- **`src/interfaces/telegram.rs`** - Telegram bot (teloxide)
- **`src/interfaces/discord.rs`** - Discord bot (serenity)
- **`src/interfaces/slack.rs`** - Slack bot
- **`src/interfaces/whatsapp.rs`** - WhatsApp bridge
- **`src/interfaces/desktop.rs`** - macOS global hotkey
- **`src/interfaces/mobile.rs`** - Mobile copilot endpoint
- **`src/skills/`** - `SkillManager`, manifest-based skills with `NativeExecutor`, built-in skills embedded via `include_dir!`
- **`agent_runtime/`** - Minimal WASM binary (wasm32-wasip1) for sandboxed agent execution
- **`frontend/`** - React 19 SPA with component-based architecture
  - `App.tsx` - layout + tab routing
  - `types/` - shared TypeScript interfaces
  - `hooks/` - custom React hooks (useApi, useAgents, useLogs, usePolling)
  - `components/` - UI panels (ChatPanel, SkillsManager, ChannelsPanel, etc.)

### Key Patterns

- **Swarm intelligence**: Agents share facts via `[ANNOUNCE]` tags written to shared `swarm.db`
- **Skills are scripts**: Each built-in skill has `manifest.toml` + `run.sh`, compiled into the binary via `include_dir!`
- **All interfaces feed the same brain**: Telegram, Discord, Slack, WhatsApp, Web, TUI all route to `AutonomousBrain::execute_react_loop()`
- **Run modes**: `Web`, `Tui`, `Daemon` - `evolve_core` skill is available in all modes (requires user confirmation)
- **Frontend dev proxy**: Vite proxies `/api` to `http://127.0.0.1:17890` during development
- **Environment variables**: `MOXXY_API_BASE`, `MOXXY_INTERNAL_TOKEN`, `MOXXY_SOURCE_DIR`, `MOXXY_ARGS_MODE`
- **Internal auth header**: `X-Moxxy-Internal-Token`
- **Formatting**: Always run `cargo fmt` after any Rust code change before committing or building

### Test-Driven Development (TDD)

We enforce a TDD approach for each component:

1. **Write failing tests first** - Define the expected behavior with tests that specify the proper output we expect.
2. **Implement to pass** - Create the implementation only after the tests are in place and failing.

Never implement functionality before the corresponding tests exist. Tests should be the specification; implementation should make them pass.

## Developer Documentation

Detailed guides for extending the framework:

- **`docs/architecture.md`** - Architecture deep-dive: boot sequence, ReAct loop, skill pipeline, registries, memory system, frontend patterns
- **`docs/skills-authoring.md`** - Complete guide to creating built-in skills (manifest, run.sh, skill.md, compilation, testing)
- **`docs/api-reference.md`** - All API endpoints with request/response shapes for skill scripts and handlers

## Claude Code Commands

Slash commands for agentic development (`.claude/commands/`):

| Command | Description |
|---------|-------------|
| `/create-skill <name> - <description>` | Scaffold a new built-in skill (manifest.toml + run.sh + skill.md) |
| `/create-interface <name> - <description>` | Scaffold a new messaging interface with LifecycleComponent |
| `/create-handler <name> - <description>` | Add a new Axum web API handler module |
| `/create-component <Name> - <description>` | Create a new React dashboard panel component |
| `/build` | Build and verify both frontend and backend |
| `/test-skill <name>` | Validate and test a built-in skill end-to-end |

### Workflow Examples

**Add a new skill:**
```
/create-skill email_send - Send emails via SMTP using vault credentials
/test-skill email_send
```

**Add a new channel integration:**
```
/create-interface matrix - Matrix messenger integration
/create-skill matrix_notify - Send a proactive message via Matrix
/create-handler matrix_channel - Matrix channel configuration endpoints
/create-component MatrixPanel - Matrix channel configuration UI
/build
```
