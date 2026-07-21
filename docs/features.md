# Features and channels

Moxxy ships as a useful agent and as a framework whose main blocks can be replaced independently.

## Core features

| Feature | Description |
|---|---|
| Modular plugins | Providers, modes, tools, compactors, cache strategies, channels, transcribers, memory, and isolators share stable plugin contracts. |
| Plugin discovery | Install a compatible npm package and Moxxy discovers its metadata. Plugins can be enabled and hot-reloaded without manual application wiring. |
| Multiple interfaces | A session can be accessed from the TUI, desktop, Telegram, HTTP, schedules, and webhooks. |
| Voice input | Send Telegram voice notes, use TUI voice input, or post raw audio to HTTP. OpenAI Whisper support is included, and the `Transcriber` contract is replaceable. |
| Permissions | Every Moxxy tool call passes through the permission engine. Persisted allow rules can be scoped by tool. |
| Secrets vault | AES-256-GCM encryption protects secrets at rest. Configuration refers to secrets with `${vault:NAME}` placeholders. |
| Capability isolation | Optional isolators enforce declared filesystem, network, environment, time, and memory capabilities. In-process, worker, subprocess, and experimental WebAssembly options are available. |
| Long-term memory | Journal-based memory supports vector recall. TF-IDF is built in, with OpenAI and on-device embedding plugins available. |
| Workflows and scheduling | Chain skills, prompts, and tools into reusable DAGs, then run them directly, on a cron, or at a specific time. |
| Verified webhooks | External systems can trigger prompts with HMAC or bearer verification, filters, replay protection, idempotency, and tunnel support. |
| Type-safe SDK | `@moxxy/sdk` is the zero-runtime-dependency public contract for plugin authors. |
| Background services | Run channels independently through launchd or systemd, or serve the complete configured stack from one process. |

## Channels

Choose the interface that fits the task while keeping the same underlying session model.

| Channel | What it does | Command |
|---|---|---|
| TUI | Interactive, keyboard-driven terminal interface | `moxxy` |
| Desktop | Native multi-workspace Electron app | [Download](https://moxxy.ai) |
| Telegram | Text and voice access with six-digit account pairing | `moxxy telegram` |
| HTTP | Authenticated JSON, SSE streaming, and raw-audio endpoints | `moxxy channels http` |
| Cron | Prompts triggered by cron expressions or one-shot timestamps | `moxxy schedule add ...` |
| Webhooks | Prompts triggered by verified and filtered external POST requests | `moxxy serve` |

See [Getting started](getting-started.md) for background service commands.

## Providers and modes

Built-in providers include Anthropic, OpenAI, ChatGPT OAuth, and a Claude Code subscription provider. The provider administration plugin can register OpenAI-compatible providers at runtime. Custom providers use the same `defineProvider` contract.

Moxxy includes three agent modes:

- `default`: a Claude Code-style ReAct loop
- `goal`: an autonomous, auto-approved loop that continues until `goal_complete`
- `research`: query planning, parallel subagent research, and cited synthesis

Switch modes from the TUI with `/mode` or set the default in configuration.

## Tools and integrations

Built-in tools include Read, Edit, Write, Bash, Grep, Glob, recall, and Sleep. Optional plugins add web fetching, Playwright browser sessions, macOS computer control, MCP servers, OAuth, subagents, and other integrations.

Skills are Markdown playbooks that teach the agent repeatable procedures without adding runtime code. When no skill fits, the agent can author and register a new one.

## Runtime capabilities

- **Prompt caching:** the stable-prefix strategy places deterministic cache breakpoints around stable and rolling prompt sections. Inspect token and cost savings with `/usage`.
- **Memory:** long-term journal recall and short-term event-log selectors preserve useful context across sessions.
- **Webhooks:** the webhook plugin provides signature verification, bearer authentication, include and exclude filters, delivery idempotency, and public tunnel helpers.
- **Speech to text:** Whisper is built in. Register a different `Transcriber` to use Deepgram, AssemblyAI, or local `whisper.cpp`.
- **Security:** capability declarations support filesystem path globs, network host allowlists, environment keys, and execution budgets. Isolation is off by default and should be enabled for deployments that require a stronger boundary.

For security guarantees and deployment guidance, read [SECURITY.md](../SECURITY.md). For extension examples, continue to the [developer guide](developer-guide.md).
