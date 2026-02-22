<p align="center">
  <img src="https://moxxy.ai/logo-gradient.svg" alt="moxxy" width="200" />
</p>

<h3 align="center">Your Everyday AI Assistant Agents</h3>

<p align="center">
  A self-hosted multi-agent AI framework built in Rust. Complete data sovereignty with agents running on your own infrastructure.
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
curl -fsSL https://raw.githubusercontent.com/moxxy-ai/moxxy/master/install.sh | bash
```

### Build from Source

```bash
git clone https://github.com/moxxy-ai/moxxy.git
cd moxxy
cd frontend && npm install && npm run build && cd ..
cargo build --release
```

### First-Time Setup

```bash
moxxy init
```

This walks you through LLM provider configuration, API keys, and optional Telegram setup.

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
moxxy init                              First-time setup wizard
moxxy web                               Web dashboard
moxxy tui                               Terminal UI
moxxy gateway start|stop|restart|status  Daemon management
moxxy logs                              Follow daemon logs
moxxy run --agent <name> --prompt "..."  One-shot prompt execution
moxxy channel telegram --agent <name>    Telegram channel setup
moxxy agent restart|remove <name>        Agent management
moxxy doctor                             System diagnostics
moxxy dev                                Dev mode (elevated permissions)
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
| `container.toml` | Runtime config (native or WASM) |
| `mounts.toml` | File indexer paths |

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
| `host_shell` | Execute shell commands |
| `host_python` | Run Python scripts |
| `web_crawler` | Fetch and parse web pages |
| `git` | Git operations |
| `telegram_notify` | Send Telegram notifications |
| `scheduler` | Create cron-based heartbeats |
| `computer_control` | macOS accessibility automation |
| `delegate_task` | Delegate work to other agents |
| `create_skill` / `install_skill` / `modify_skill` / `remove_skill` / `upgrade_skill` | Skill lifecycle management |
| `evolve_core` | Self-modify framework code (dev mode only) |
| `mcp` | Call MCP server tools |

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

## WASM Sandboxing

Agents can run inside WASM containers with capability-based permissions. Configure in `container.toml`:

```toml
[runtime]
type = "wasm"
image = "base"      # base | networked | full

[capabilities]
filesystem = ["./skills", "./memory"]
network = false
max_memory_mb = 128
env_inherit = false
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and contribution guidelines.

```bash
# Backend
cargo build --release

# Frontend (dev server with hot reload)
cd frontend && npm run dev

# Run diagnostics
moxxy doctor
```

## Links

- [Website](https://moxxy.ai)
- [Documentation](https://docs.moxxy.ai)
- [GitHub](https://github.com/moxxy-ai/moxxy)

## License

[MIT](LICENSE)
