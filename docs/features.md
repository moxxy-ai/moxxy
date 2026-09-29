# Features and channels

Moxxy ships as a useful agent and as a framework whose main blocks can be replaced independently.

## Core features

| Feature | Description |
|---|---|
| Modular plugins | Providers, modes, tools, compactors, cache strategies, channels, transcribers, memory, and isolators share stable plugin contracts. |
| Plugin discovery | Install a compatible npm package and Moxxy discovers its metadata. Plugins can be enabled and hot-reloaded without manual application wiring. |
| Multiple interfaces | A session can be accessed from the TUI, desktop, Telegram, HTTP, schedules, and webhooks. |
| Voice input | Send Telegram or Discord voice notes, use TUI voice input, or post raw audio to HTTP. Every session picks `plugins.transcriber.default` at start, else Codex transcription when you are logged in with ChatGPT (`moxxy login openai-codex`). OpenAI Whisper support is included, and the `Transcriber` contract is replaceable. |
| Desktop Voice Mode | Talk to a session hands-free: the local engine runs every utterance as an agent turn read aloud by the spoken voice chosen in Settings → Voice (Gemini Flash-Lite or Local Piper), and the GPT-Live engine holds a live conversation over your ChatGPT login that knows the chat, hands explicit tasks to the agent in your own words, and reads back the real result ([details](voice-gpt-live.md)). |
| Permissions | Every Moxxy tool call passes through the permission engine. Persisted allow rules can be scoped by tool. |
| Secrets vault | AES-256-GCM encryption protects secrets at rest. Configuration refers to secrets with `${vault:NAME}` placeholders. |
| Capability isolation | Optional isolators enforce declared filesystem, network, environment, time, and memory capabilities. In-process, worker, subprocess, and experimental WebAssembly options are available. |
| Long-term memory | Journal-based memory supports vector recall. TF-IDF is built in, with OpenAI and on-device embedding plugins available. |
| Workflows and scheduling | Chain skills, prompts, and tools into reusable DAGs, then run them directly, on a cron, or at a specific time. |
| Verified webhooks | External systems can trigger prompts with HMAC or bearer verification, filters, replay protection, idempotency, and tunnel support. |
| Type-safe SDK | `@moxxy/sdk` is the zero-runtime-dependency public contract for plugin authors. |
| Background services | Run channels independently through launchd or systemd (`moxxy service install telegram` or `discord`, or Channels → Discord → Run mode → Always in the desktop), or serve the complete configured stack from one process. Switching the run mode back, or `moxxy service uninstall <name>`, removes the service. |

## Channels

Choose the interface that fits the task while keeping the same underlying session model.

| Channel | What it does | Command |
|---|---|---|
| TUI | Interactive, keyboard-driven terminal interface | `moxxy` |
| Desktop | Native multi-workspace Electron app | [Download](https://moxxy.ai) |
| Telegram | Text and voice access with six-digit account pairing | `moxxy telegram` |
| Discord | Text and voice access over DMs with code pairing; voice calls in a server voice channel — `/call` to call the bot, the agent calls you with `discord_call` (it joins your voice channel or rings with a DM link), talk over its reply to interrupt it, `/hangup` or leaving ends the call (see [Discord voice calls](discord-voice-calls.md)) ("typing…" shows while the bot works); its own model (`/model` suggests the available models as you type, or Channels → Discord → Setup); `/auto-approve` toggles running tool calls without asking — the same switch as Auto-approve in the desktop's chat with the bot; `/new` starts a fresh conversation, and the desktop's chat with the bot clears with it; in the desktop, Channels → Discord is a live chat with the bot — write from Discord or from the app, a message written in the app is posted to Discord with its reply (and the reply is said aloud while a call is on) — with Stop while the bot's agent works on a Discord request, and the same Terminal / Files / Diff / Browser workbench as a workspace chat (browser tabs stay open when you collapse the workbench or switch panes): a bot started from the app drives the app's browser, so you can watch it and take over there (a page's choice such as a cookie banner is asked in the Discord chat, since Discord shows no browser); the agent can push progress DMs — and files you ask for, sent as attachments you can open or download, up to 10 MB per message — to you from any session (`discord_send_message`) | `moxxy channels discord` |
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

Built-in tools include Read, Edit, Write, Bash, Grep, Glob, recall, Sleep, Wait, and StopJob. Optional plugins add web fetching, Playwright browser sessions, macOS computer control, MCP servers, OAuth, subagents, and other integrations.

### Waiting on work

The agent waits on events, not on a clock. A long command — a dev server, a watcher, a slow build — runs as a background job: `Bash` with `background: true` returns a job id at once and the command keeps running. `Wait` then blocks until that job finishes, or until it prints output matching `until` (for example `ready on \d+`), and wakes the instant that happens instead of sleeping a fixed number of seconds and checking again. Each `Wait` returns only the output printed since the previous one.

- `timeoutSeconds` only bounds a wait. When it passes, the job is still running; the agent can wait again, do other work, or end it with `StopJob`.
- `Wait` without a job id wakes on whichever running job finishes first.
- Stopping the turn ends the wait but not the job. Closing the conversation stops every job it started, and so does quitting moxxy — including Ctrl+C or `kill` on a `moxxy -p` run, which now closes the session before exiting instead of leaving its commands running.
- A blank `until`, or one that matches empty output (like `.*`), is ignored, and a blank job id means "any running job" — models often send such placeholders for optional fields.
- `Sleep` stays for a real pause, or for re-checking something that cannot report when it is ready (a UI settling, an external service with no status stream).

A collaborative run's coordinator works the same way: it resumes the moment an agent reports done or its process exits, not on a half-second poll.

The `terminal` tool (the shared terminal you see in the desktop's workbench) also returns as soon as its command ends — including in a shell whose hooks set the window title, as Oh My Zsh does, which used to make every call wait out its full timeout. It returns what the terminal shows as plain text, without color codes or title sequences.

Skills are Markdown playbooks that teach the agent repeatable procedures without adding runtime code. When no skill fits, the agent can author and register a new one.

## Runtime capabilities

- **Prompt caching:** the stable-prefix strategy places deterministic cache breakpoints around stable and rolling prompt sections. Inspect token and cost savings with `/usage`.
- **Memory:** long-term journal recall and short-term event-log selectors preserve useful context across sessions.
- **Webhooks:** the webhook plugin provides signature verification, bearer authentication, include and exclude filters, delivery idempotency, and public tunnel helpers.
- **Speech to text:** Whisper is built in. Register a different `Transcriber` to use Deepgram, AssemblyAI, or local `whisper.cpp`.
- **Security:** capability declarations support filesystem path globs, network host allowlists, environment keys, and execution budgets. Isolation is off by default and should be enabled for deployments that require a stronger boundary.

For security guarantees and deployment guidance, read [SECURITY.md](../SECURITY.md). For extension examples, continue to the [developer guide](developer-guide.md).
