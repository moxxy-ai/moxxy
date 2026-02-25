<p align="center">
  <img src="https://moxxy.ai/logo-gradient.svg" alt="moxxy" width="200" />
</p>

<h3 align="center">Your Everyday AI Assistant Agents</h3>

<p align="center">
  A self-hosted multi-agent AI framework built in Rust. Complete data sovereignty with agents running on your own infrastructure.
</p>

<p align="center">
  <a href="https://github.com/moxxy-ai/moxxy/releases"><img src="https://img.shields.io/github/v/release/moxxy-ai/moxxy?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/moxxy-ai/moxxy/blob/main/LICENSE"><img src="https://img.shields.io/github/license/moxxy-ai/moxxy?style=flat-square" alt="License"></a>
  <a href="https://github.com/moxxy-ai/moxxy/stargazers"><img src="https://img.shields.io/github/stars/moxxy-ai/moxxy?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/moxxy-ai/moxxy/issues"><img src="https://img.shields.io/github/issues/moxxy-ai/moxxy?style=flat-square" alt="Issues"></a>
  <a href="https://github.com/moxxy-ai/moxxy/actions"><img src="https://img.shields.io/github/actions/workflow/status/moxxy-ai/moxxy/ci.yml?style=flat-square&label=build" alt="Build"></a>
</p>

<p align="center">
  <a href="https://docs.moxxy.ai">Documentation</a> · <a href="https://moxxy.ai">Website</a> · <a href="https://github.com/moxxy-ai/moxxy">GitHub</a>
</p>

---

## What is moxxy?

moxxy is a self-hosted runtime for autonomous AI agents. Each agent gets its own isolated workspace with private memory, a persona, encrypted secrets, and access to extensible skills. Agents run autonomously on schedules, respond to messages across multiple channels, and share intelligence through a swarm knowledge base - all on your own infrastructure with complete data sovereignty.

**Key features:**

- **Multi-agent isolation** - each agent has its own SQLite memory, persona, vault, and skills
- **ReAct loop execution** - LLM-driven tool invocation with a transparent execution model
- **Multiple interfaces** - Web dashboard, terminal UI, Telegram, Discord, Slack, WhatsApp
- **Extensible skills** - shell scripts, Python, MCP servers, or custom tools
- **WASM sandboxing** - containerized execution with capability-based permissions
- **Scheduled autonomy** - cron-based heartbeats for proactive agent behavior
- **Swarm intelligence** - agents share facts through a global knowledge base

**What can you do with it?**

- Automate repetitive tasks - emails, reports, data processing
- Monitor systems via logs and APIs with alerting
- Build custom workflows by chaining skills together
- Deploy conversational bots to messaging platforms
- Develop AI applications via the REST API

## Quick Start

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/moxxy-ai/moxxy/main/install.sh | bash
```

The install script downloads the binary and runs `moxxy install` to scaffold the `~/.moxxy` directory. After installation, run the interactive setup:

```bash
moxxy init
```

### Build from Source

```bash
git clone https://github.com/moxxy-ai/moxxy.git
cd moxxy
cd frontend && npm install && npm run build && cd ..
cargo build --release
./target/release/moxxy install
./target/release/moxxy init
```

### First-Time Setup

`moxxy install` creates the directory structure and initialises the database (non-interactive, safe to run from a piped script).

`moxxy init` walks you through LLM provider configuration, API keys, and optional Telegram setup (interactive, requires a terminal).

### Start

```bash
# Web dashboard (opens browser automatically)
moxxy web

# Terminal UI
moxxy tui

# Background daemon
moxxy gateway start
```

## Commands

```
moxxy install                           Set up directories and database
moxxy init                              Interactive setup wizard
moxxy web                               Web dashboard
moxxy tui                               Terminal UI
moxxy gateway start|stop|restart|status  Daemon management
moxxy logs                              Follow daemon logs
moxxy run --agent <name> --prompt "..."  One-shot prompt execution
moxxy channel telegram --agent <name>    Telegram channel setup
moxxy oauth <skill>|list                 OAuth flows (see [docs/oauth.md](docs/oauth.md))
moxxy agent restart|remove <name>       Agent management
moxxy doctor                             System diagnostics
```

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  moxxy Gateway                   │
├──────────┬───────────┬───────────┬───────────────┤
│ Telegram │  Discord  │   Slack   │   WhatsApp    │
│   Bot    │   Bot     │   Bot     │   Bridge      │
├──────────┴───────────┴───────────┴───────────────┤
│              AutonomousBrain (ReAct)              │
│         LLM → <invoke> → Skill → Result          │
├──────────────────────────────────────────────────┤
│  Agent 1          │  Agent 2          │  Agent N  │
│  ┌─────────────┐  │  ┌─────────────┐  │          │
│  │ memory.db   │  │  │ memory.db   │  │   ...    │
│  │ persona.md  │  │  │ persona.md  │  │          │
│  │ vault       │  │  │ vault       │  │          │
│  │ skills/     │  │  │ skills/     │  │          │
│  └─────────────┘  │  └─────────────┘  │          │
├──────────────────────────────────────────────────┤
│              Shared swarm.db                     │
└──────────────────────────────────────────────────┘
```

### Agent Workspace

Each agent lives in `~/.moxxy/agents/<name>/` with:

| File | Purpose |
|------|---------|
| `persona.md` | System prompt / personality |
| `memory.db` | Private SQLite (STM + LTM with vector embeddings) |
| `current.md` | Human-readable STM snapshot |
| `skills/` | Agent-specific custom skills |
| `workspace/` | Sandboxed working directory (all agent file operations are confined here) |
| `container.toml` | Runtime config (native or WASM) |

### LLM Providers

| Provider | Models |
|----------|--------|
| OpenAI | GPT-4o, GPT-4o-mini, o1, o3-mini |
| Google | Gemini 2.0 Flash, Gemini 2.5 Pro |
| Z.Ai | Grok |

Configure via the web dashboard (Config tab) or during `moxxy init`.

### Built-in Skills

| Skill | Description |
|-------|-------------|
| `host_shell` | Execute shell commands on the host machine |
| `host_python` | Run Python scripts on the host machine |
| `browser` | Browser automation and web page fetching (lightweight fetch or full Chromium) |
| `git` | Git operations with managed isolated worktrees (`ws init/use/list`) plus `-C` support |
| `github` | GitHub API (issues, PRs, clone, fork, comment) - clones into agent workspace by default |
| `file_ops` | Read, write, patch, append, and navigate files for development tasks |
| `workspace_shell` | Run build/test commands locked to the agent workspace (npm, cargo, make, etc.) |
| `computer_control` | macOS accessibility automation via AppleScript |
| `delegate_task` | Delegate sub-tasks to other agents in the swarm |
| `skill` | Unified skill management (list, install, remove, upgrade, modify, create, read) |
| `scheduler` | Schedule recurring jobs using cron syntax |
| `modify_schedule` | Modify an existing scheduled job |
| `remove_schedule` | Remove a scheduled job by name |
| `telegram_notify` | Send proactive Telegram messages |
| `discord_notify` | Send proactive Discord messages |
| `whatsapp_notify` | Send proactive WhatsApp messages |
| `webhook` | Manage webhook endpoints for receiving external events |
| `manage_providers` | Manage LLM providers (list, add, remove, switch) |
| `manage_vault` | Manage vault secrets (list, get, set, remove) |
| `mcp` | Configure external MCP servers (list, add, remove) |
| `contribute` | Suggest features or open PRs on the moxxy repo via GitHub |
| `evolve_core` | Self-modify framework code (requires user confirmation) |
| `openclaw_migrate` | Migrate OpenClaw agents, personas, and skills to moxxy |

### MCP Integration

Connect external [Model Context Protocol](https://modelcontextprotocol.io/) servers to extend agent capabilities:

```
Web Dashboard → MCP Servers tab → Add Server
```

MCP tools are automatically registered as agent skills.

## Telegram Setup

```bash
moxxy channel telegram --agent default
```

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Provide the bot token
3. Send `/start` to your bot
4. Enter the pairing code

**Bot commands:** `/start` (pair), `/skills` (list skills), `/new` (clear memory)

Voice messages are supported via OpenAI Whisper (configurable).

## Security & Agent Isolation

moxxy enforces strict workspace isolation for agents through multiple security layers:

**Workspace confinement** - Every agent's file operations are restricted to `~/.moxxy/agents/<name>/workspace/`. There is no mechanism for an agent to read or write files outside this directory.

**Privilege tiers** - Skills are divided into privileged (hardcoded built-in skills with full host access: `host_shell`, `host_python`, `computer_control`, `evolve_core`, `browser`, `osx_email`, `git`, `github`, `file_ops`, `workspace_shell`) and sandboxed (all other skills, including agent-installed ones). Agent-installed skills cannot escalate to privileged status.

**OS-level sandboxing** - Non-privileged skills execute inside an OS sandbox (`sandbox-exec` on macOS, `bwrap` on Linux) that enforces read-write access only to the agent's workspace directory at the kernel level.

**Environment isolation** - Sandboxed skills receive a clean environment with no internal API tokens, no access to the agent's home directory, and no source directory paths. Without the internal token, sandboxed skills cannot call host proxy endpoints.

**Host proxy authentication** - The host proxy (`execute_bash`, `execute_python`, `execute_applescript`) always requires the internal token. Working directory parameters are validated to stay within `~/.moxxy/`.

**WASM containerization** - Agents can optionally run their brain (ReAct loop) inside a WASM container for defense-in-depth. WASM preopened directories are restricted to `./workspace` only, with path traversal protection via canonicalization.

Configure WASM mode in `container.toml`:

```toml
[runtime]
type = "wasm"
image = "base"      # base | networked | full

[capabilities]
filesystem = ["./workspace"]
network = false
max_memory_mb = 128
env_inherit = false
```

## Contributing - Humans and Agents Welcome

We welcome contributions from humans **and** their AI agents. If you're using moxxy and your agent has an idea for improving the framework, it can contribute directly.

### The `contribute` skill

Every moxxy agent ships with a built-in `contribute` skill that can:

- **Suggest features** - create a GitHub issue describing the idea
- **Implement changes** - fork the repo, make changes on a branch, and open a draft PR
- **Check status** - see your open issues and PRs

All your agent needs is a `GITHUB_TOKEN` stored in its vault (go to Vault tab in the web dashboard or use the `manage_vault` skill). Then it can suggest and implement improvements autonomously.

```
"Hey, I think moxxy could benefit from X. Can you suggest it?"
→ Agent creates a GitHub issue via the contribute skill

"Go ahead and implement it too."
→ Agent forks, codes the change, and opens a draft PR
```

AI-authored PRs are opened as **drafts** so a maintainer always reviews before merging. Every contribution - whether from a human, an agent, or a collaboration - is valued equally.

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development setup and guidelines.

## Comparison

How moxxy compares to similar self-hosted AI agent frameworks:

| | **moxxy** | **[OpenClaw](https://github.com/openclaw/openclaw)** | **[ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw)** |
|---|---|---|---|
| **Language** | Rust | TypeScript / Node.js | Rust |
| **Focus** | Multi-agent autonomy & swarm intelligence | Personal assistant across devices | Minimal agentic runtime ("agent OS") |
| **Agent model** | Multi-agent with isolated workspaces | Single-agent, single-user | Single-agent, trait-swappable |
| **Execution** | ReAct loop (LLM → skill → result) | Gateway + WebSocket control plane | Trait-based provider loop |
| **LLM providers** | OpenAI, Google Gemini, Z.Ai (Grok) | Anthropic, OpenAI (with failover) | OpenAI-compatible, Anthropic, OpenRouter, custom |
| **Channels** | Web, TUI, Telegram, Discord, Slack, WhatsApp | 13+ (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, Matrix, Google Chat, Zalo, WebChat) | CLI, Telegram, Discord, Slack, Mattermost, iMessage, Matrix, Signal, WhatsApp |
| **Memory** | Per-agent SQLite (STM + LTM with vec0 embeddings) + shared swarm.db | Session-based with compacting/summarization | SQLite hybrid search (vectors + FTS5), PostgreSQL, or Markdown |
| **Swarm / multi-agent** | Yes - agents share facts via `[ANNOUNCE]` tags | No | No |
| **Skill system** | Shell/Python scripts with manifest.toml, MCP servers | ClawHub skill registry + SKILL.md | Shell, file, HTTP, git, browser, cron tools |
| **Sandboxing** | OS-level sandbox (sandbox-exec / bwrap) + optional WASM containers, workspace-confined agents | Chrome profile isolation, macOS TCC | Docker sandbox (WASM planned) |
| **Voice** | Whisper transcription (Telegram) | ElevenLabs + Wake/Talk Mode overlay | No |
| **Desktop/mobile apps** | Web dashboard, macOS hotkey, mobile endpoint | macOS menu bar app, iOS & Android companion apps | No |
| **Self-modification** | Yes - `evolve_core` skill (with user confirmation) | No | No |
| **Binary size / footprint** | Single binary (~12 MB), ~20 MB RAM | Node.js process, higher baseline | Single binary, <5 MB RAM |
| **License** | MIT | MIT | Apache 2.0 + MIT |

## Development

```bash
# Backend
cargo build --release

# Frontend (dev server with hot reload)
cd frontend && npm run dev

# Run diagnostics
moxxy doctor
```

### Testing

```bash
# Run all OAuth-related tests
cargo test oauth

# Run full OAuth flow integration test (requires moxxy install)
MOXXY_OAUTH_FULL_FLOW=1 cargo test --test oauth_integration oauth_full_flow
```

## Links

- [Website](https://moxxy.ai)
- [Documentation](https://docs.moxxy.ai)
- [GitHub](https://github.com/moxxy-ai/moxxy)

## License

[MIT](LICENSE)
