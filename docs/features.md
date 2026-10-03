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
| Background services | Run channels independently through launchd or systemd (`moxxy service install telegram` or `discord`, or Channels → Telegram / Discord → Run mode → Always in the desktop), or serve the complete configured stack from one process. Switching the run mode back, or `moxxy service uninstall <name>`, removes the service. |

## Channels

Choose the interface that fits the task while keeping the same underlying session model.

| Channel | What it does | Command |
|---|---|---|
| TUI | Interactive, keyboard-driven terminal interface | `moxxy` |
| Desktop | Native multi-workspace Electron app | [Download](https://moxxy.ai) |
| Telegram | Text and voice access, paired by scanning a QR (or sending the six-digit code); `/voice` turns spoken replies on and off: while it is on, every reply (to a voice or a typed message) also comes as a voice message when a text-to-speech backend is set up, and while it is off replies are text only. A spoken reply uses a voice for the language it is written in, so a Polish reply is read with a Polish voice. Telegram does not let bots take or place calls, so `/call` points to voice messages instead. It has its own model (`/model` shows the providers, then the chosen provider's models, with the current one in green; or Channels → Telegram → Setup) that never changes the model the desktop or TUI run with; the desktop's chat with the bot shows and runs that model, and a model picked in that chat's header becomes the bot's model. `/auto-approve` (or `/yolo`) toggles running tool calls without asking; it is the same switch as Auto-approve in the desktop's chat with the bot. `/new` starts a fresh conversation. In the desktop, Channels → Telegram is a live chat with the bot, with the same Stop, workbench and browser as Discord: write from Telegram or from the app, and a message written in the app is posted to Telegram with its reply. The agent can push messages, and files you ask for (sent as documents, up to 50 MB), to you from any session (`telegram_send_message`) | `moxxy telegram` |
| Discord | Text and voice access over DMs with code pairing; voice calls in a server voice channel — `/call` to call the bot, the agent calls you with `discord_call` (it joins your voice channel or rings with a DM link), talk over its reply to interrupt it, `/hangup` or leaving ends the call (see [Discord voice calls](discord-voice-calls.md)) ("typing…" shows while the bot works); its own model (`/model` suggests the available models as you type, or Channels → Discord → Setup; the desktop's chat with the bot shows and runs it, and a model picked in that chat's header becomes the bot's model); `/auto-approve` toggles running tool calls without asking — the same switch as Auto-approve in the desktop's chat with the bot; `/new` starts a fresh conversation, and the desktop's chat with the bot clears with it; in the desktop, Channels → Discord is a live chat with the bot — write from Discord or from the app, a message written in the app is posted to Discord with its reply (and the reply is said aloud while a call is on) — with Stop while the bot's agent works on a Discord request, and the same Terminal / Files / Diff / Browser workbench as a workspace chat (browser tabs stay open when you collapse the workbench or switch panes): a bot started from the app drives the app's browser, so you can watch it and take over there (a page's choice such as a cookie banner is asked in the Discord chat, since Discord shows no browser); the agent can push progress DMs — and files you ask for, sent as attachments you can open or download, up to 10 MB per message — to you from any session (`discord_send_message`) | `moxxy channels discord` |
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

### Moxxy Browser

In the desktop, the agent works in the Browser pane — a real Chromium view you watch and can take over. A click brings its tab to the front, refuses an element something covers (naming what), and reports what it set off: a navigation, a dialog, a tab the page opened. It reads frames, answers dialogs (`browser_dialog`), picks from native lists (`browser_select`), scrolls, hovers and waits for text; links that open a new window open as tabs in the pane. You see the agent's own pointer glide to each element before it presses, and you can take the browser over at any time — press on the page, type into it, or use Take over — after which the agent's actions are refused until you resume or send a new message. You allow each site once (`browser_allow_site`) rather than approving every click; the agent's actions on a site you have not allowed are refused. In the terminal UI the same tools drive a headless browser. See [Moxxy Browser](browser-use/README.md).

### Waiting on work

The agent waits on events, not on a clock. A long command — a dev server, a watcher, a slow build — runs as a background job: `Bash` with `background: true` returns a job id at once and the command keeps running. `Wait` then blocks until that job finishes, or until it prints output matching `until` (for example `ready on \d+`), and wakes the instant that happens instead of sleeping a fixed number of seconds and checking again. Each `Wait` returns only the output printed since the previous one.

- `timeoutSeconds` only bounds a wait. When it passes, the job is still running; the agent can wait again, do other work, or end it with `StopJob`.
- `Wait` without a job id wakes on whichever running job finishes first.
- Stopping the turn ends the wait but not the job. Closing the conversation stops every job it started, and so does quitting moxxy — including Ctrl+C or `kill` on a `moxxy -p` run, which now closes the session before exiting instead of leaving its commands running.
- A blank `until`, or one that matches empty output (like `.*`), is ignored, and a blank job id means "any running job" — models often send such placeholders for optional fields.
- The chat shows a background command as started, not finished ("Started pnpm dev in the background"), and names the job each `Wait` and `StopJob` is about — in the desktop and in the terminal UI alike.
- `Sleep` stays for a real pause, or for re-checking something that cannot report when it is ready (a UI settling, an external service with no status stream).

A collaborative run's coordinator works the same way: it resumes the moment an agent reports done or its process exits, not on a half-second poll.

The `terminal` tool (the shared terminal you see in the desktop's workbench) also returns as soon as its command ends — including in a shell whose hooks set the window title, as Oh My Zsh does, which used to make every call wait out its full timeout. It returns what the terminal shows as plain text, without color codes or title sequences. The desktop's Terminal pane opens once the conversation's runner is up — a pane shown while a new conversation still starts no longer stays on "Terminal unavailable: not connected to a runner" — and opens again after the runner restarts. A long or multi-line command (a script fed through a heredoc) is saved to a private temporary file and sourced, instead of typed into the shell, which can lose part of long typed input and then sit at `heredoc>`; what the script changes in the shell (`cd`, `export`) stays, as if it had been typed. A shell still waiting for the rest of a command when the timeout comes (`heredoc>`, `quote>`) gets Ctrl-C, so the next command runs, and the result says so. Commands the agent runs get a UTF-8 character type (`LC_CTYPE`) when the environment sets none, so `pbcopy` and other tools keep Polish letters instead of turning them into mojibake.

Skills are Markdown playbooks that teach the agent repeatable procedures without adding runtime code. When no skill fits, the agent can author and register a new one. Plugins ship skills too (Computer Use's `computer-control`, OAuth, sub-agents), loaded with the plugin from its `package.json#moxxy.plugin.skills` folder. In any chat — the desktop, the terminal UI, a channel bot, mobile — `@skill-name` in a prompt calls that skill for the request (an `aliases:` entry works too, and `_` reads as `-`): `@computer_use` does the task in the app on your screen through Computer Use and keeps Moxxy's own Browser out of it, and `@moxxy_browser` does it in Moxxy's Browser and keeps Computer Use out. In the desktop, typing `@` opens a menu of these tools above the composer (Computer Use and Moxxy Browser first, then the other skills, narrowed as you type, in English or Polish: `@komputer`, `@przegladarka`); arrows move, Enter or Tab puts the pick in, Escape closes it. The skill is recorded on the prompt, so every surface and every replay sees the same request; a prompt a trigger wrote (a webhook, a schedule) calls no skill.

## Runtime capabilities

- **Prompt caching:** the stable-prefix strategy places deterministic cache breakpoints around stable and rolling prompt sections. Inspect token and cost savings with `/usage`.
- **Memory:** long-term journal recall and short-term event-log selectors preserve useful context across sessions.
- **Webhooks:** the webhook plugin provides signature verification, bearer authentication, include and exclude filters, delivery idempotency, and public tunnel helpers.
- **Speech to text:** Whisper is built in. Register a different `Transcriber` to use Deepgram, AssemblyAI, or local `whisper.cpp`.
- **Security:** capability declarations support filesystem path globs, network host allowlists, environment keys, and execution budgets. Isolation is off by default and should be enabled for deployments that require a stronger boundary.

For security guarantees and deployment guidance, read [SECURITY.md](../SECURITY.md). For extension examples, continue to the [developer guide](developer-guide.md).
