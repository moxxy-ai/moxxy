<p align="center">
  <a href="https://moxxy.ai">
    <img src="https://moxxy.ai/moxxy-head-256.png" alt="moxxy" width="120" />
  </a>
</p>

<h1 align="center">moxxy</h1>

<p align="center">
  <strong>Build an AI agent without buying into a closed stack.</strong><br />
  Moxxy is the modular agent framework where providers, modes, tools, memory, security, and interfaces are all swappable.
</p>

<p align="center">
  <a href="https://github.com/moxxy-ai/moxxy/actions/workflows/ci.yml"><img src="https://github.com/moxxy-ai/moxxy/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20.10-brightgreen?logo=node.js&logoColor=white" alt="Node.js 20.10 or newer" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict mode" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="#why-moxxy">Why moxxy</a> ·
  <a href="#showcase">Showcase</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="https://docs.moxxy.ai">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

## About moxxy

Moxxy is an open source TypeScript framework and ready-to-use personal agent. Run the same session in a keyboard-driven terminal, a native desktop app, Telegram, or an authenticated HTTP endpoint. Start with the built-in stack, then replace any block with a plugin as your product grows.

The framework is developed by the agent it runs, backed by strict CI, adversarial review, and live end-to-end validation. Read more about the project and its engineering approach in [How moxxy is built](docs/engineering.md).

## Why moxxy

| | |
|---|---|
| **Modular by design** | Swap providers, agent modes, tools, compactors, cache strategies, memory, channels, and isolators behind stable SDK contracts. |
| **One agent, every surface** | Continue a shared session from the TUI, desktop, Telegram, HTTP, schedules, or verified webhooks. |
| **Install and go** | Plugins are discovered from npm metadata and can be enabled or hot-reloaded without application wiring. |
| **Production controls** | Every tool call is permission-gated. Secrets stay in an AES-256-GCM vault, while optional capability isolation provides stronger execution boundaries. |
| **Built for long-running work** | Persistent event logs, long-term memory, workflows, scheduling, background services, and resumable sessions are included. |
| **Provider freedom** | Use built-in providers, subscription-backed CLIs, or register any compatible provider without rewriting the agent loop. |
| **Type-safe extension** | The zero-runtime-dependency `@moxxy/sdk` gives plugin authors a small, typed public contract with full IDE support. |

Explore [features and channels](docs/features.md) for the complete capability map.

## Showcase

<p align="center">
  <a href="assets/moxxy-ai-video.mp4">
    <img src="assets/moxxy-mascot.gif" alt="Moxxy agent mascot" width="180" />
  </a>
</p>

<p align="center">
  <a href="assets/moxxy-ai-video.mp4"><strong>Watch the product overview</strong></a>
</p>

### A capable agent in your terminal

<p align="center">
  <img src="assets/tui-demo.gif" alt="Moxxy using its terminal tools to fix and verify code" width="900" />
</p>

The TUI streams reasoning and tool results, supports slash commands and voice input, and lets you switch agent modes without leaving the session. Prefer a graphical workspace? [Download the desktop app](https://moxxy.ai).

## Get started

**Requirements:** Node.js 20.10 or newer, plus a supported API key, ChatGPT OAuth, or an authenticated Claude Code installation.

```sh
npm install -g @moxxy/cli
moxxy onboard
moxxy
```

`moxxy onboard` guides you through provider setup, an optional messaging channel, device pairing, and background service installation. You can also run a single turn directly from your shell:

```sh
moxxy -p "summarize the README in three bullets"
```

See the [getting started guide](docs/getting-started.md) for provider setup, channels, services, and troubleshooting. Use `moxxy --help` to list every command.

## Documentation

- [Getting started](docs/getting-started.md)
- [Features and channels](docs/features.md)
- [Developer guide](docs/developer-guide.md)
- [Configuration reference](docs/configuration.md)
- [How moxxy is built](docs/engineering.md)
- [Security policy and hardening](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Full documentation](https://docs.moxxy.ai)

## License

Moxxy is available under the [MIT License](LICENSE).
