<p align="center">
  <a href="https://moxxy.ai">
    <img src="assets/brand/moxxy-mark-dark.svg" alt="moxxy" width="120" />
  </a>
</p>

<h1 align="center">moxxy</h1>

<p align="center">
  <strong>Your local AI agent. Simple to start. Ready to govern.</strong><br />
  Work in a project with your preferred model, explicit approvals, and optional extensions.
</p>

<p align="center">
  <a href="https://github.com/moxxy-ai/moxxy/actions/workflows/ci.yml"><img src="https://github.com/moxxy-ai/moxxy/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20.10-brightgreen?logo=node.js&logoColor=white" alt="Node.js 20.10 or newer" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/status-developer%20alpha-C426D7" alt="Developer alpha" />
</p>

<p align="center">
  <a href="#start-in-a-project">Start</a> ·
  <a href="#extend-when-you-need-to">Extend</a> ·
  <a href="#governed-workstations">Govern</a> ·
  <a href="https://docs.moxxy.ai">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

## What moxxy is

Moxxy is an open-source agent for software work. It runs locally, understands
the current workspace, and asks before consequential tool calls. Connect an API
key, ChatGPT account, or Claude Code subscription and start from the terminal
or desktop app.

The product has two paths built on the same runtime:

- **Personal use:** a developer connects a model and works in a project with
  sensible defaults.
- **Governed use:** an organization supplies policy, approved model
  connections and extensions, and inspectable activity receipts.

The modular TypeScript runtime remains available to extension authors, but its
internal modes, compactors, cache strategies, embedders, and isolators are not
part of first-run setup. See the [product contract](PRODUCT.md) for the boundary.

## Start in a project

**Requirements:** Node.js 20.10 or newer and one supported model account.

```sh
npm install -g @moxxy/cli
cd your-project
moxxy
```

On first start, Moxxy asks you to choose a model connection and sign in or add
an API key, then opens the project TUI. Safe workspace reads proceed directly;
commands, changes, and external access are described before approval. No config
file is required.

Ask one question without opening the interactive UI:

```sh
moxxy -p "explain how authentication works in this repository"
```

Use `moxxy help advanced` when you want channels, services, automation, or
operator commands. See [Getting started](docs/getting-started.md) for all
supported authentication paths.

## What you get

| | |
|---|---|
| **Local workspace context** | The agent works in the project you launch it from and persists runs locally. |
| **Clear approvals** | Commands, changes, and external access are presented by target and impact. |
| **Model choice** | Use first-party API providers or subscription-backed ChatGPT and Claude Code connections. |
| **Long-running work** | Continue saved runs with bounded context and optional long-term memory. |
| **CLI and desktop** | Use the same runtime from a keyboard-first terminal or native desktop workspace. |
| **Open extension surface** | Add capabilities without forking the core or locking into one model vendor. |

## Extend when you need to

`moxxy extensions` finds, installs, enables, and removes optional capabilities.
Skills are Markdown; code extensions use the typed `@moxxy/sdk` contract.

```sh
moxxy extensions list
moxxy extensions search browser
moxxy extensions install browser
```

Advanced authors can contribute tools, model connections, channels, modes,
compactors, cache strategies, embedders, and isolators. Start with the
[developer guide](docs/developer-guide.md).

## Governed workstations

The governed path applies an organization profile to the same local developer
experience. Profiles can constrain model connections, extensions, tools,
network egress, and audit export while verified receipts explain what happened
in a run.

Governed use is a developer-alpha preview for design partners; moxxy does not
yet claim a fleet control plane, compliance certification, or production SLA.
Read [Deploying in an organisation](docs/deployment.md), the
[threat model](docs/threat-model.md), and [what leaves the machine](docs/data-flow.md).

## Developer alpha

The alpha is for developers willing to test installation, authentication,
first useful work, approvals, and resume behavior. Limitations and the feedback
format are documented in [Developer alpha](docs/developer-alpha.md).

Please report reproducible problems through
[GitHub Issues](https://github.com/moxxy-ai/moxxy/issues) and product feedback
through [GitHub Discussions](https://github.com/moxxy-ai/moxxy/discussions).

## Documentation

- [Getting started](docs/getting-started.md)
- [Developer alpha](docs/developer-alpha.md)
- [Features and channels](docs/features.md)
- [Developer guide](docs/developer-guide.md)
- [Configuration reference](docs/configuration.md)
- [Security policy](SECURITY.md)
- [Full documentation](https://docs.moxxy.ai)

## License

Moxxy is available under the [MIT License](LICENSE).
