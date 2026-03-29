<p align="center">
  <img src="https://moxxy.ai/logo-gradient.svg" alt="Moxxy" width="80" />
</p>

<h1 align="center">@moxxy/cli</h1>

<p align="center">
  <strong>CLI and full-screen TUI for the Moxxy agentic framework.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@moxxy/cli"><img src="https://img.shields.io/npm/v/@moxxy/cli?color=cb3837&logo=npm&logoColor=white" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-5FA04E?logo=node.js&logoColor=white" alt="Node.js 22+">
  <a href="https://github.com/moxxy-ai/moxxy"><img src="https://img.shields.io/badge/github-moxxy-181717?logo=github&logoColor=white" alt="GitHub"></a>
  <a href="https://github.com/moxxy-ai/moxxy/blob/main/LICENSE-MIT"><img src="https://img.shields.io/badge/license-MIT%2FApache--2.0-blue" alt="License"></a>
</p>

---

`@moxxy/cli` is the command-line interface for [Moxxy](https://github.com/moxxy-ai/moxxy) — a local-first framework for building, running, and orchestrating AI agents. It provides interactive wizards for every operation and a split-pane TUI for real-time agent interaction.

## Requirements

- **Node.js** 22+
- A running **Moxxy gateway** (the Rust backend — see [full setup](https://github.com/moxxy-ai/moxxy#getting-started))

## Install

```bash
npm install --global @moxxy/cli
```

Or run from source:

```bash
cd apps/moxxy-cli
npm install
node --import tsx src/cli.js
```

## Quick Start

```bash
# First-time setup (creates token, configures provider)
moxxy init

# Open the full-screen chat interface
moxxy tui
```

Every command launches an **interactive wizard** when run without flags — just type the command and follow the prompts.

## Commands

```
moxxy                                               Interactive menu
moxxy init                                          First-time setup wizard
moxxy doctor                                        Diagnose installation
moxxy update [--check] [--force] [--json]           Check for and install updates
moxxy update --rollback                             Restore previous gateway version
moxxy uninstall                                     Remove all Moxxy data

moxxy tui [--agent <id>]                            Full-screen chat interface
moxxy chat [--agent <id>]                           Alias for tui

moxxy gateway start|stop|restart|status|logs

moxxy auth token create [--scopes <s>] [--ttl <n>] [--json]
moxxy auth token list [--json]
moxxy auth token revoke <id>

moxxy provider list
moxxy provider install --id <provider-id>
moxxy provider login --id <id> --method browser|headless

moxxy agent create --provider <p> --model <m> --workspace <w> [--json]
moxxy agent run --id <id> --task "task" [--json]
moxxy agent stop --id <id>
moxxy agent status --id <id> [--json]
moxxy agent update --id <id> [--model <m>] [--temperature <n>]
moxxy agent delete --id <id>

moxxy skill create --agent <id> --content <c>
moxxy skill list --agent <id>
moxxy skill remove --agent <id> --skill <id>

moxxy template list
moxxy template get <slug>
moxxy template create --content <c>
moxxy template update --slug <slug> --content <c>
moxxy template remove <slug>
moxxy template assign --agent <id> --template <slug>

moxxy vault add --key <k> --backend <b>
moxxy vault grant --agent <id> --secret <id>
moxxy vault revoke --id <id>
moxxy vault list

moxxy heartbeat set --agent <id> --interval <n> [--action_type <t>]
moxxy heartbeat list --agent <id>
moxxy heartbeat disable --agent <id> --id <id>

moxxy channel create
moxxy channel list
moxxy channel pair --code <code> --agent <id>
moxxy channel delete <id>
moxxy channel bindings <id>
moxxy channel unbind <channel-id> <binding-id>

moxxy mcp list --agent <name>
moxxy mcp add --agent <name> --id <id> --transport stdio --command <cmd> [--args ...]
moxxy mcp add --agent <name> --id <id> --transport sse --url <url>
moxxy mcp remove --agent <name> --id <id>
moxxy mcp test --agent <name> --id <id>

moxxy plugin list                                   List installed plugins
moxxy plugin install <package>                       Install a plugin
moxxy plugin start <name>                            Start a plugin
moxxy plugin stop <name>                             Stop a plugin
moxxy plugin restart <name>                          Restart a plugin
moxxy plugin uninstall <name>                        Remove a plugin
moxxy plugin logs <name>                             Tail plugin logs

moxxy events tail [--agent <id>] [--run <id>] [--json]
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

**Slash commands** inside the TUI:

| Command | Description |
|---|---|
| `/quit`, `/exit` | Exit the TUI |
| `/stop` | Stop the running agent |
| `/new`, `/reset` | Reset session and start fresh |
| `/clear` | Clear chat history |
| `/help` | Show available commands |
| `/status` | Show agent status |
| `/model` | Open interactive model picker |
| `/vault` | Open vault actions |
| `/mcp` | Open MCP actions |
| `/template` | Open template actions |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MOXXY_API_URL` | `http://localhost:3000` | Gateway base URL |
| `MOXXY_TOKEN` | — | API bearer token |

## Supported Providers

The CLI includes a built-in provider catalog:

| Provider | Env Var | Auth |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | API key, OAuth |
| OpenAI | `OPENAI_API_KEY` | API key |
| OpenAI Codex | `OPENAI_CODEX_SECRET_KEY` | OAuth (browser/headless) |
| Ollama | — | Local OpenAI-compatible endpoint, no auth |
| xAI | `XAI_API_KEY` | API key |
| Google Gemini | `GOOGLE_API_KEY` | API key |
| DeepSeek | `DEEPSEEK_API_KEY` | API key |
| ZAI | `ZAI_API_KEY` | API key |
| ZAI Plan | `ZAI_API_KEY` | API key |
| Claude Code CLI | — | Claude Code binary |
| Custom | Any | OpenAI-compatible endpoint |

## Plugins

Plugins are npm packages that extend Moxxy with additional functionality — web dashboards, virtual offices, custom integrations, and more. Each plugin runs as a standalone process that connects to the gateway via the REST API and SSE events.

### Built-in plugins

| Plugin | Package | Description |
|---|---|---|
| Web Dashboard | `@moxxy/web-plugin` | Browser-based dashboard on port 17900 |
| Virtual Office | `@moxxy/virtual-office-plugin` | Virtual office environment on port 5174 |

```bash
# Install and start the web dashboard
moxxy plugin install @moxxy/web-plugin
moxxy plugin start @moxxy/web-plugin

# Or use the interactive menu
moxxy plugin
```

### Creating a custom plugin

A Moxxy plugin is any npm package that declares a `moxxy` section and a `plugin:start` script in its `package.json`:

```json
{
  "name": "my-moxxy-dashboard",
  "version": "1.0.0",
  "moxxy": {
    "type": "plugin",
    "displayName": "My Dashboard",
    "description": "Custom monitoring dashboard for Moxxy agents",
    "port": 4000
  },
  "scripts": {
    "plugin:start": "node src/server.js",
    "plugin:stop": "echo 'shutting down'",
    "plugin:install": "npm run build",
    "plugin:uninstall": "rm -rf dist"
  }
}
```

**Required fields:**

- `moxxy.type` — must be `"plugin"`
- `scripts["plugin:start"]` — the command that starts your plugin

**Optional fields:**

- `moxxy.displayName` — friendly name shown in the CLI menu
- `moxxy.description` — short description
- `moxxy.port` — default port the plugin listens on
- `scripts["plugin:stop"]` — graceful shutdown hook (run before SIGTERM)
- `scripts["plugin:install"]` — post-install setup (e.g. build step)
- `scripts["plugin:uninstall"]` — cleanup hook before removal

### Environment variables

When started, your plugin receives these environment variables:

| Variable | Description |
|---|---|
| `MOXXY_API_URL` | Gateway base URL (e.g. `http://localhost:3000`) |
| `MOXXY_TOKEN` | API bearer token for gateway access |
| `MOXXY_PLUGIN_NAME` | The plugin's own package name |
| `MOXXY_PLUGIN_PORT` | Allocated port from `moxxy.port` |
| `MOXXY_HOME` | Moxxy home directory (`~/.moxxy`) |
| `PORT` | Same as `MOXXY_PLUGIN_PORT` (convenience) |

### Example: minimal plugin

```js
// src/server.js
import http from 'node:http';

const PORT = process.env.PORT || 4000;
const API_URL = process.env.MOXXY_API_URL;
const TOKEN = process.env.MOXXY_TOKEN;

const server = http.createServer(async (req, res) => {
  if (req.url === '/') {
    // Fetch agents from the gateway
    const resp = await fetch(`${API_URL}/v1/agents`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const agents = await resp.json();

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <h1>Moxxy Agents</h1>
      <ul>${agents.map(a => `<li>${a.name} [${a.status}]</li>`).join('')}</ul>
    `);
    return;
  }
  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => console.log(`Dashboard running on http://localhost:${PORT}`));
```

Publish to npm, then install in Moxxy:

```bash
moxxy plugin install my-moxxy-dashboard
moxxy plugin start my-moxxy-dashboard
```

### Plugin lifecycle scripts

| Script | When it runs |
|---|---|
| `plugin:install` | After `npm install`, before first use (build steps, etc.) |
| `plugin:start` | When the user runs `moxxy plugin start <name>` |
| `plugin:stop` | Before SIGTERM when the user runs `moxxy plugin stop <name>` |
| `plugin:uninstall` | Before removal when the user runs `moxxy plugin uninstall <name>` |

## About Moxxy

Moxxy is a local-first agentic framework with a Rust core and Node.js CLI. It provides:

- **80+ built-in primitives** — filesystem, git, shell, HTTP, browsing, memory, webhooks, vault, MCP, hive orchestration, allowlists, and more
- **Skill-based agents** — Markdown skills with YAML frontmatter that define capabilities and permission boundaries
- **Multi-agent orchestration** — hive swarms with task boards, proposals, voting, and signal-based coordination
- **Strong isolation** — sandboxed workspaces, command allowlists, domain-gated networking, OS keychain secrets
- **MCP support** — connect agents to Model Context Protocol servers (stdio and SSE transports)
- **Real-time observability** — SSE event streaming with automatic secret redaction

For the full project, architecture, and development guide, see the [main repository](https://github.com/moxxy-ai/moxxy).

## License

Dual-licensed under [MIT](https://github.com/moxxy-ai/moxxy/blob/main/LICENSE-MIT) or [Apache 2.0](https://github.com/moxxy-ai/moxxy/blob/main/LICENSE-APACHE) at your option.
