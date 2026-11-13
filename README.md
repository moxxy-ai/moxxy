<p align="center">
  <a href="https://moxxy.ai">
    <img src="assets/brand/png/moxxy-mark-256.png" alt="moxxy" width="120" />
  </a>
</p>

<h1 align="center">moxxy</h1>

<p align="center">
  <strong>Your personal AI assistant, right on your computer.</strong><br />
  It browses the web, works your apps, runs things on a schedule and remembers what matters.<br />
  It uses the AI account you already have, and it asks before it does anything important.
</p>

<p align="center">
  <a href="https://github.com/moxxy-ai/moxxy/actions/workflows/ci.yml"><img src="https://github.com/moxxy-ai/moxxy/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22.19-brightgreen?logo=node.js&logoColor=white" alt="Node.js 22.19 or newer" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/status-alpha-FF4A1E" alt="Alpha" />
</p>

<p align="center">
  <a href="https://moxxy.ai"><strong>Download the desktop app</strong></a> ·
  <a href="#use-it-in-the-terminal">Terminal</a> ·
  <a href="#extend-it">Extend</a> ·
  <a href="#for-teams">For teams</a> ·
  <a href="https://docs.moxxy.ai">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

## What moxxy is

Moxxy is a free, open-source assistant that does the steps for you. Ask for an
outcome ("book a table for Friday", "sort my Downloads", "send me the weather
every morning") and it uses a browser, your files and your apps to get there.

It runs on your own computer in two forms that share one runtime:

- **Desktop app** for macOS, Windows and Linux. This is where most people start.
- **Terminal app** (`moxxy`) for people who live on the keyboard, script things
  or work in code.

Organizations can put the same assistant under company policy. See
[For teams](#for-teams).

## Get the desktop app

1. Download the installer from [moxxy.ai](https://moxxy.ai) or the newest
   `desktop-v*` entry on the [releases page](https://github.com/moxxy-ai/moxxy/releases):
   `.dmg` for macOS (Apple silicon and Intel), `-setup.exe` for Windows, `.deb`
   or AppImage for Linux.
2. Open it and connect the AI you already use: a ChatGPT account, a Claude
   subscription, an API key, or a model running on your machine.
3. Ask for something.

The installer carries everything it needs, so there is nothing else to install
first. [What the installer contains](docs/desktop-installer.md).

## What it does

| | |
|---|---|
| **Does the web for you** | Opens a real browser, searches, compares and fills in forms. You can watch every step and take over. |
| **Works your apps** | With Computer Use turned on, it clicks and types in desktop apps on macOS, Windows and Linux. |
| **Runs while you are away** | Schedules run a request on weekdays at 8, once next Friday, or on any other rhythm. |
| **Talks** | Voice Mode turns a run into a spoken, hands-free conversation. |
| **Remembers** | Preferences, people and past work are kept in a memory on your computer. |
| **Answers on your phone** | Pair Telegram or Discord and message your assistant from anywhere, in text or voice. |
| **Works in code** | Reads, edits and runs a project, or hands a turn to Claude Code, Codex or OpenCode. |

More in [Features and channels](docs/features.md).

## You stay in charge

- **It asks before it acts.** Reading is quiet. A command, a change or anything
  that reaches outside is described first and waits for your approval.
- **It lives on your computer.** Runs and memory are stored locally, and moxxy
  sends no usage analytics or crash reports. Your prompts go to the AI provider
  you chose. [What leaves the machine](docs/data-flow.md).
- **Secrets stay secret.** Keys and passwords sit in an encrypted vault; the
  model sees a placeholder.
- **You choose the AI.** ChatGPT, Claude, Gemini and Grok through an account or
  an API key, or a local model through Ollama, LM Studio or any
  OpenAI-compatible server.

## Use it in the terminal

**Requirements:** Node.js 22.19 or newer (Node 24 LTS recommended) and one supported model account.

```sh
npm install -g @moxxy/cli
cd your-project
moxxy
```

On first start, moxxy asks you to choose a model connection and sign in or add
an API key, then opens the terminal UI. Safe workspace reads proceed directly;
commands, changes, and external access are described before approval. No config
file is required.

Ask one question without opening the interactive UI:

```sh
moxxy -p "explain how authentication works in this repository"
```

Use `moxxy help advanced` when you want channels, services, automation, or
operator commands. See [Getting started](docs/getting-started.md) for all
supported authentication paths.

## Extend it

`moxxy extensions` finds, installs, enables, and removes optional capabilities.
Skills are Markdown; code extensions use the typed `@moxxy/sdk` contract. MCP
servers plug in as well.

```sh
moxxy extensions list
moxxy extensions search browser
moxxy extensions install browser
```

Advanced authors can contribute tools, model connections, channels, modes,
compactors, cache strategies, embedders, and isolators. Start with the
[developer guide](docs/developer-guide.md).

## For teams

Company-governed moxxy applies an organization profile to the same assistant.
A profile can set the allowed model connections, extensions, tools and network
egress, attach the identity of the person behind each action, and export
tamper-evident receipts of what happened in a run.

This is a preview for design partners: moxxy does not yet claim a fleet control
plane, compliance certification, or production SLA. Read
[Deploying in an organisation](docs/deployment.md), the
[threat model](docs/threat-model.md), and [what leaves the machine](docs/data-flow.md).

## Alpha

Moxxy is in alpha. Expect rough edges, and please tell us about them:
reproducible problems go to
[GitHub Issues](https://github.com/moxxy-ai/moxxy/issues), product feedback to
[GitHub Discussions](https://github.com/moxxy-ai/moxxy/discussions). Known
limitations and the feedback format are in [Developer alpha](docs/developer-alpha.md).

If moxxy is useful to you, a star on this repository helps other people find it.

## Documentation

- [Getting started](docs/getting-started.md)
- [Features and channels](docs/features.md)
- [Agent connections](docs/agent-connections.md)
- [Developer guide](docs/developer-guide.md)
- [Configuration reference](docs/configuration.md)
- [Product contract](PRODUCT.md)
- [Security policy](SECURITY.md)
- [Full documentation](https://docs.moxxy.ai)

## License

Moxxy is available under the [MIT License](LICENSE).
