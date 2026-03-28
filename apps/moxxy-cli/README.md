<p align="center">
  <img src="https://moxxy.ai/logo-gradient.svg" alt="Moxxy" width="80" />
</p>

<h1 align="center">moxxy-cli</h1>

<p align="center">
  <strong>CLI and full-screen TUI for the Moxxy agentic framework.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/moxxy-cli"><img src="https://img.shields.io/npm/v/moxxy-cli?color=cb3837&logo=npm&logoColor=white" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-5FA04E?logo=node.js&logoColor=white" alt="Node.js 22+">
  <a href="https://github.com/moxxy-ai/moxxy"><img src="https://img.shields.io/badge/github-moxxy-181717?logo=github&logoColor=white" alt="GitHub"></a>
  <a href="https://github.com/moxxy-ai/moxxy/blob/main/LICENSE-MIT"><img src="https://img.shields.io/badge/license-MIT%2FApache--2.0-blue" alt="License"></a>
</p>

---

`moxxy-cli` is the command-line interface for [Moxxy](https://github.com/moxxy-ai/moxxy) = a local-first framework for building, running, and orchestrating AI agents. It provides interactive wizards for every operation and a split-pane TUI for real-time agent interaction.

## Requirements

- **Bun** 1.2+ (for development / building from source)
- A running **Moxxy gateway** (the Rust backend - see [full setup](https://github.com/moxxy-ai/moxxy#getting-started))

## Install

```bash
npm install --global @moxxy/cli
```

Or install from source with Bun:

```bash
cd apps/moxxy-cli
bun install
bun run build
# binary is at dist/moxxy
```

## Building Pre-built Binaries

The CLI can be compiled into standalone binaries for each platform using `bun build --compile`. No runtime is needed to run the resulting binary.

### Current platform

```bash
bun run build          # → dist/moxxy
```

### Cross-platform targets

```bash
# Individual targets
bun run build:darwin-arm64     # → dist/moxxy-cli-darwin-arm64   (macOS Apple Silicon)
bun run build:darwin-x86_64    # → dist/moxxy-cli-darwin-x86_64  (macOS Intel)
bun run build:linux-arm64      # → dist/moxxy-cli-linux-arm64    (Linux ARM64)
bun run build:linux-x86_64     # → dist/moxxy-cli-linux-x86_64   (Linux x86_64)

# All platforms at once
bun run build:all
```

Bun's `--compile --target` flag handles cross-compilation - you can build all platforms from a single machine.

## Quick Start

```bash
# First-time setup (creates token, configures provider)
moxxy init

# Open the full-screen chat interface
moxxy tui
```

Every command launches an **interactive wizard** when run without flags = just type the command and follow the prompts.

## Commands

```
moxxy                                          Interactive menu
moxxy init                                     First-time setup wizard
moxxy doctor                                   Diagnose installation
moxxy uninstall                                Remove all Moxxy data

moxxy tui [--agent <id>]                       Full-screen chat interface
moxxy chat [--agent <id>]                      Alias for tui

moxxy auth token create [--scopes <s>] [--ttl <n>]
moxxy auth token list [--json]
moxxy auth token revoke <id>

moxxy agent create [--provider <p>] [--model <m>] [--workspace <path>]
moxxy agent run [--id <id>] [--task "..."]
moxxy agent stop [--id <id>]
moxxy agent status [--id <id>] [--json]

moxxy provider install [--id <name>]
moxxy provider list

moxxy skill import [--agent <id>]
moxxy skill approve --agent <id> --skill <id>

moxxy heartbeat set [--agent <id>]
moxxy heartbeat list --agent <id>

moxxy vault add [--key <k>] [--backend <b>]
moxxy vault grant [--agent <id>] [--secret <id>]

moxxy events tail [--agent <id>] [--run <id>]

moxxy gateway start|stop|restart|status|logs
```

Add `--json` to most commands for machine-readable output.

## TUI

The built-in terminal UI provides a split-pane interface with real-time SSE event streaming:

```
┌─────────────────────────────────┬──────────────────────┐
│  Chat                           │  Agent Info          │
│                                 │  ID: 019cac...       │
│  > You: Refactor auth module    │  Provider: anthropic │
│                                 │  Model: claude-4     │
│  Assistant: Analyzing...        │  Status: ● running   │
│                                 │                      │
│  [skill.invoked] fs.read        │  ── Usage ──         │
│  [skill.completed] fs.read      │  Tokens: 12,450      │
│                                 │  Events: 34          │
├─────────────────────────────────┴──────────────────────┤
│  > Type a task...                            Ctrl+C    │
└────────────────────────────────────────────────────────┘
```

**Slash commands** inside the TUI: `/quit`, `/stop`, `/clear`, `/help`, `/status`, `/model` = with autocomplete.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MOXXY_API_URL` | `http://localhost:3000` | Gateway base URL |
| `MOXXY_TOKEN` | = | API bearer token |
| `MOXXY_HOME` | `~/.moxxy` | Data directory |

## Supported Providers

The CLI includes a built-in provider catalog:

| Provider | Env Var |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| xAI | `XAI_API_KEY` |
| Google Gemini | `GOOGLE_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| ZAI | `ZAI_API_KEY` |
| Custom | Any OpenAI-compatible endpoint |

## About Moxxy

Moxxy is a local-first agentic framework with a Rust core and Node.js CLI. It provides:

- **34 built-in primitives** = filesystem, git, shell, HTTP, browsing, memory, webhooks, vault, multi-agent orchestration
- **Skill-based agents** = Markdown skills with YAML frontmatter that define capabilities and permission boundaries
- **Strong isolation** = sandboxed workspaces, command allowlists, domain-gated networking, OS keychain secrets
- **Real-time observability** = 28 SSE event types with automatic secret redaction

For the full project, architecture, and development guide, see the [main repository](https://github.com/moxxy-ai/moxxy).

## License

Dual-licensed under [MIT](https://github.com/moxxy-ai/moxxy/blob/main/LICENSE-MIT) or [Apache 2.0](https://github.com/moxxy-ai/moxxy/blob/main/LICENSE-APACHE) at your option.
