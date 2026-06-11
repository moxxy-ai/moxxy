<p align="center">
  <a href="https://moxxy.ai">
    <img src="https://moxxy.ai/moxxy-head-256.png" alt="moxxy" width="120" />
  </a>
</p>

<h1 align="center">moxxy</h1>

<p align="center">
  <strong>The agent framework where every block is swappable.</strong><br/>
  Bring your own model. Bring your own loop. Bring your own tools — and run it from your terminal, your desktop, or a phone.
</p>

<p align="center">
  <a href="https://github.com/moxxy-ai/moxxy/actions/workflows/ci.yml">
    <img src="https://github.com/moxxy-ai/moxxy/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/badge/node-%3E%3D20.10-brightgreen?logo=node.js&logoColor=white" alt="Node ≥20.10" />
  </a>
  <a href="https://www.typescriptlang.org">
    <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  </a>
  <a href="https://pnpm.io">
    <img src="https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
  </a>
  <a href="#-license">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  </a>
</p>

<p align="center">
  <a href="#-get-started">Get started</a>
  &nbsp;·&nbsp;
  <a href="#-why-moxxy">Why moxxy</a>
  &nbsp;·&nbsp;
  <a href="#-see-it-in-action">See it</a>
  &nbsp;·&nbsp;
  <a href="https://docs.moxxy.ai">Docs</a>
  &nbsp;·&nbsp;
  <a href="#-channels">Channels</a>
  &nbsp;·&nbsp;
  <a href="#-built-by-the-agent-it-runs">Built by itself</a>
  &nbsp;·&nbsp;
  <a href="#-developer-guide">Developer guide</a>
</p>

<!--
  HERO DEMO  ▸ replace the placehold.co src below with a real GIF/MP4.
  WHAT TO SHOW: a ~20–30s loop — `moxxy init` → ask a question in the TUI →
  the agent runs a tool (e.g. edits a file / runs a command) → streams the answer.
  Suggested size: 1280×640. Drop the file at assets/hero-demo.gif and point src there.
-->
<p align="center">
  <a href="#-see-it-in-action">
    <img src="https://placehold.co/1280x640/0d1117/58a6ff.png?text=moxxy+%E2%80%94+30-second+demo" alt="moxxy demo" width="760" />
  </a>
</p>

---

## 🤖 Built by the agent it runs

**~95% of moxxy is written by moxxy** — the agent builds the framework, and the framework runs the agent. (For comparison, Anthropic has said Claude writes ~80% of Claude Code.) That number isn't a gimmick or a license to ship slop; it's a forcing function for the opposite. When the machine that writes the code is the same machine you're shipping, *engineering discipline becomes the product*, and you get to apply it at a scale and speed a human-only team can't match.

What that discipline looks like here, in practice:

- **Adversarial self-review, not vibes.** Findings are produced by fan-out analysis agents and then handed to independent agents whose only job is to *refute* them — false positives die before they reach a human. A recent full-codebase audit ran dozens of agents this way, surfaced 47 confirmed issues across security, stability, performance and packaging, and fixed every one in verified, single-concern PRs.
- **Every change runs the gate.** Build, typecheck, lint, and the full test suite (thousands of tests across ~50 packages) pass on three Node versions before anything merges — enforced in CI and locally by [git hooks](.claude/hooks/) so the agent can't declare done on a red tree.
- **Real-world, not just mocked.** A one-press [live E2E workflow](.github/workflows/e2e-live.yml) drives the actual CLI against the real OpenAI API — a streaming turn, a tool round-trip, and a confirmed SSRF-guard refusal of a cloud-metadata address — so security and provider behavior are proven against production, not fixtures.
- **The codebase teaches the next agent.** A living [tech-debt journal](TECH_DEBT.md) (retire-one-per-change), a [skill library](.claude/skills/) of thin, single-purpose playbooks, and [specialized agent definitions](.claude/agents/) mean each change leaves the repo *easier* to change correctly — compounding quality instead of eroding it.

The result is delivery that's **faster** (parallel agents, hours not weeks), **cleaner** (one concern per PR, every claim cited to a file and line), and **more robust** (adversarial verification + live validation + a gate nothing skips) than a conventional pipeline — *because* the author is an agent held to a higher bar, not in spite of it.

> Want to see the machinery? Start with [`.claude/skills/`](.claude/skills/), [`TECH_DEBT.md`](TECH_DEBT.md), and the [Developer guide](#-developer-guide).

---

## 🚀 Get started

```sh
npm install -g @moxxy/cli      # or: npx @moxxy/cli init
```

```sh
moxxy init      # interactive: choose a provider, paste an API key (stored in the vault)
moxxy           # launch the interactive TUI
```

One-shot, straight from the shell:

```sh
moxxy -p "summarize the README in three bullets"
```

Already running? Keep it current:

```sh
moxxy update    # checks npm and upgrades in place (the TUI also nudges you when a new version ships)
```

**Requirements:** Node.js ≥ 20.10 and an API key for a supported provider (Anthropic, OpenAI, or ChatGPT/Claude via OAuth). `moxxy --help` lists every command.

---

## ✨ Why moxxy?

Most agent frameworks lock you in. One LLM provider. One loop topology. One frontend. One opinionated way the agent should behave.

**moxxy doesn't.** Every block is a plugin. Swap Anthropic for OpenAI. Swap the default loop for `goal` (autonomous, auto-approve) or `research` (parallel fan-out + cited synthesis). Drive the same Session from your terminal, the desktop app, Telegram, or an HTTP endpoint — at the same time. Install a package and it's auto-discovered; nothing to wire by hand.

<p align="center">
  <img src="assets/moxxy-mascot.gif" alt="moxxy mascot" width="150" />
</p>

|   |   |
|---|---|
| 🧩 **Truly modular** | Every block is a swappable plugin: provider, loop strategy, tools, compactor, cache strategy, channel. |
| 🔌 **Plug-and-play** | Install a package, it's auto-discovered. Hot-reload without restarting. |
| 🤖 **Multi-channel** | TUI, desktop app, Telegram, HTTP. One Session, many surfaces. |
| 🎙 **Voice in** | Telegram voice notes or POST raw audio to the HTTP channel. Whisper ships built-in; swap to Deepgram or local whisper.cpp by registering a different `Transcriber`. |
| 🔐 **Secrets done right** | Built-in AES-256-GCM vault. OS keychain by default, passphrase fallback. |
| 🧠 **Long-term memory** | Journal-based with vector recall. TF-IDF ships built-in; swap to OpenAI embeddings. |
| 🛠 **Type-safe SDK** | Zero-runtime-dep `@moxxy/sdk` is the contract. Author plugins with full IDE support. |
| ⏰ **Always-on** | `moxxy service install` turns any channel into a launchd / systemd service, or `moxxy serve --background` runs everything in one shared-session process. |
| 🔔 **Webhooks** | Any system can fire prompts: verified (HMAC / bearer), filtered, idempotent. Auto-tunneled with `cloudflared` for a one-command public URL. |
| 🪪 **Permissions** | Every tool call gated. Allow-always rules learned per tool over time. |
| 🛡 **Pluggable isolation** | Opt-in capability sandboxing. Tools declare what they need (fs paths, hosts, time / memory); an `Isolator` enforces. `inproc` built-in; `worker` / `subprocess` / `wasm` / `docker` drop in behind the same interface. Off by default. |

---

## 🎬 See it in action

<table>
<tr>
<td width="50%" valign="top">

**In your terminal**

<!--
  TUI DEMO  ▸ replace src with a real GIF.
  WHAT TO SHOW: the Ink TUI — boot splash → type a prompt → streamed answer
  with a tool block expanding → the bottom status line (provider · model · context bar).
  Suggested size: 1200×675. Drop at assets/tui-demo.gif and point src there.
-->
<img src="https://placehold.co/1200x675/0d1117/c9d1d9.png?text=moxxy+TUI+demo" alt="moxxy TUI" />

`moxxy` — a fast, keyboard-driven terminal UI. Slash commands, live tool output, voice input, `/mode` to switch loops.

</td>
<td width="50%" valign="top">

**On your desktop**

<!--
  DESKTOP DEMO  ▸ replace src with a real GIF.
  WHAT TO SHOW: the Electron app — multiple workspaces in the sidebar, a chat
  turn streaming, maybe the Settings → Dashboard "update" panel.
  Suggested size: 1200×675. Drop at assets/desktop-demo.gif and point src there.
-->
<img src="https://placehold.co/1200x675/0d1117/c9d1d9.png?text=moxxy+Desktop+demo" alt="moxxy Desktop" />

A native workspace app (Electron) that attaches to the same runner — multiple workspaces, hot self-updates, no reinstall.

</td>
</tr>
</table>

---

## 📺 Channels

Run your agent through whatever surface fits the task:

| Channel | What it does | Command |
|---|---|---|
| **TUI** | Interactive terminal UI | `moxxy` |
| **Desktop** | Native multi-workspace app (Electron) | [download](https://moxxy.ai) |
| **Telegram** | Message your agent from anywhere; voice notes transcribed and run as turns; pairs with a 6-digit code | `moxxy telegram` |
| **HTTP** | `POST /v1/turn` (JSON, SSE streaming) or `POST /v1/turn/audio` (raw bytes, iOS Shortcut friendly), bearer-token auth | `moxxy channels http` |
| **Cron** | Time-driven prompts (cron expressions or one-shot ISO timestamps) | `moxxy schedule add …` |
| **Webhooks** | External systems fire prompts on signed POST. HMAC + bearer + filter rules. | `moxxy serve` (auto-starts the listener) |

Keep them online 24/7 as background OS services. Two paths:

```sh
# Per-channel units (one process each, independent crashes)
moxxy service install telegram     # launchd on macOS, systemd --user on Linux
moxxy service logs telegram         # tail the log

# Or: one process for everything, shared event log
moxxy serve --background            # every channel + scheduler + webhooks
moxxy serve --background --except http   # skip what you don't want
moxxy serve --status                # is it running?
```

Logs land in `~/.moxxy/services/<name>.log`; units survive reboots.

## 🧩 What's in the box

- **Providers**: Anthropic, OpenAI, Codex (ChatGPT OAuth), Claude (Pro/Max OAuth). Add your own with one `defineProvider({})`.
- **Loop strategies**: `default` (Claude-Code-style ReAct loop), `goal` (autonomous auto-approve loop — runs across turns until `goal_complete`), `research` (plan queries → parallel subagent fan-out → cited synthesis). Switch in the TUI with `/mode`.
- **Built-in tools**: Read, Edit, Write, Bash, Grep, Glob, recall, Sleep — plus `web_fetch` (via `@moxxy/plugin-browser`), computer-control (macOS), and browser sessions (Playwright).
- **Prompt caching**: `@moxxy/cache-strategy-stable-prefix` places deterministic cache breakpoints (static tools/system/stable-prefix + a rolling tail) so the inner iterations of a turn read the prompt from cache instead of paying full price. Provider-neutral; swap it or disable with the `none` strategy. Inspect savings live with `/usage`.
- **MCP**: register any Model Context Protocol server as a tool source.
- **Skills**: prompt-only Markdown files. The agent can author new skills for itself when no existing skill fits.
- **Memory**: long-term journal + STM event-log selectors. TF-IDF vector recall built in; swap to OpenAI embeddings via `@moxxy/plugin-embeddings-openai`.
- **Webhooks**: `@moxxy/plugin-webhooks` ships a verified HTTP listener, include/exclude filters (headers + JSON paths), delivery idempotency, and a `cloudflared`/`ngrok` tunnel helper.
- **Voice in (STT)**: `@moxxy/plugin-stt-whisper` ships an OpenAI Whisper `Transcriber`. Wire it once and every channel with audio input routes through it. Swap to Deepgram, AssemblyAI, or local `whisper.cpp` by registering a different `Transcriber`.
- **Vault**: AES-256-GCM at rest. Reference secrets in config as `${vault:KEY}`.
- **Security / isolation**: `@moxxy/plugin-security` — opt-in capability sandboxing. Tools declare an `isolation: { capabilities }` spec on `defineTool({...})` (fs path globs, net host allowlist, env keys, `timeMs`, `memMb`); when enabled, an `Isolator` enforces those bounds at every call. Ships `none` + `inproc`; stronger modes (`worker_threads`, subprocess, wasm, Docker) register through the same SDK interface. Off by default — enable via `moxxy init` or `security.enabled: true`.

## 📚 Docs

Full docs at **[docs.moxxy.ai](https://docs.moxxy.ai)**: concepts, recipes, plugin authoring, channel guides. Marketing site: [moxxy.ai](https://moxxy.ai).

---

# 🛠 Developer guide

Everything below is for plugin authors, contributors, and folks embedding moxxy in their own TypeScript apps.

## Embedding the SDK

```ts
import { Session, runTurn, autoAllowResolver } from '@moxxy/core';
import { anthropicPlugin } from '@moxxy/plugin-provider-anthropic';
import { builtinToolsPlugin } from '@moxxy/tools-builtin';
import { defaultModePlugin } from '@moxxy/mode-default';

const session = new Session({ cwd: process.cwd(), permissionResolver: autoAllowResolver });
session.pluginHost.registerStatic(anthropicPlugin);
session.pluginHost.registerStatic(builtinToolsPlugin);
session.pluginHost.registerStatic(defaultModePlugin);
session.providers.setActive('anthropic');

for await (const event of runTurn(session, 'list TS files in cwd')) {
  if (event.type === 'assistant_chunk') process.stdout.write(event.delta);
}
```

## Authoring a plugin

```ts
import { definePlugin, defineTool, z } from '@moxxy/sdk';

export default definePlugin({
  name: '@acme/moxxy-plugin-greet',
  tools: [
    defineTool({
      name: 'greet',
      description: 'Return a greeting for the given name.',
      inputSchema: z.object({ name: z.string() }),
      handler: ({ name }) => `Hello, ${name}!`,
    }),
  ],
});
```

Add a `"moxxy"` block to your `package.json` and moxxy auto-discovers it:

```json
{
  "moxxy": { "plugin": { "entry": "./dist/index.js", "kind": "tools" } }
}
```

Per-block author guides live in [`.claude/agents/`](.claude/agents/), one per surface (skill, plugin, tool, channel, provider, loop strategy, compactor, cache strategy).

## Configuration

`moxxy.config.ts` at your project root:

```ts
import { defineConfig } from '@moxxy/config';

export default defineConfig({
  provider: {
    name: 'anthropic',
    model: 'claude-sonnet-4-6',
    config: { apiKey: '${vault:ANTHROPIC_API_KEY}' },   // resolved from the vault
  },
  mode: 'default',
  plugins: {
    '@moxxy/plugin-browser': { enabled: false },        // disable a plugin (or use `moxxy plugins disable`)
  },
});
```

`${vault:NAME}` placeholders are resolved on session start. The vault unlocks via OS keychain (`keytar`) with a passphrase fallback (`MOXXY_VAULT_PASSPHRASE` for headless boxes).

## Environment variables

Provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) are picked up automatically. Everything moxxy-specific:

| Variable | Effect |
|---|---|
| `MOXXY_HOME` | Override the `~/.moxxy` data directory (vault, skills, sessions, services). |
| `MOXXY_DEBUG=1` | Verbose CLI error output + process-guard diagnostics. |
| `MOXXY_VAULT_PASSPHRASE` | Headless vault passphrase (alternative to the OS keychain). |
| `MOXXY_SESSION_ID` | Sticky session id for `moxxy serve` — resume this persisted session instead of booting a fresh one. |
| `MOXXY_RUNNER_SOCKET` | Override the runner's unix-socket path. |
| `MOXXY_NO_CORE_UPDATE=1` | Don't register the Tier-2 core self-update tools. |
| `MOXXY_FIXTURES` | `record` \| `replay` \| `passthrough` — provider fixture mode (tests). |
| `MOXXY_TELEGRAM_TOKEN` | Override the vault-stored Telegram bot token. |
| `MOXXY_HTTP_TOKEN` | Bearer token for the HTTP channel. |
| `MOXXY_WEB_TOKEN` | Auth token for the web surface channel. |
| `MOXXY_NO_WEB_SURFACE=1` | Skip starting the web surface in `moxxy serve`. |
| `MOXXY_MOBILE_TOKEN` | Bearer token for the mobile channel's WebSocket bridge. |
| `MOXXY_MOBILE_HOST` | Bind host for the mobile channel (default `127.0.0.1`; `0.0.0.0` exposes it on the LAN). |
| `MOXXY_MOBILE_TUNNEL` | `localhost` \| `cloudflared` \| `ngrok` — tunnel for the mobile channel. |
| `MOXXY_VOICE_AUDIO_DEVICE` | Audio capture device for TUI voice input. |
| `MOXXY_MCP_STDERR=inherit` | Surface MCP server stderr (default: ignored). |
| `MOXXY_WS_BRIDGE=1` | Desktop: enable the WebSocket IPC bridge for remote clients (the mobile app). |
| `MOXXY_WS_PORT` / `MOXXY_WS_HOST` / `MOXXY_WS_TOKEN` | Desktop bridge port / bind host / auth token (token auto-generated when unset). |
| `MOXXY_WS_ALLOW_QUERY_TOKEN=1` | Desktop bridge: also accept the legacy `?t=` query-string token (off by default; native clients use the `Sec-WebSocket-Protocol` bearer). |
| `MOXXY_RUNNER_STRICT_ABORT=1` | Runner: deny cross-client turn aborts instead of allowing + audit-logging them. |
| `MOXXY_CLI_ENTRY` | Desktop: explicit path to the CLI entry used to spawn runners. |
| `MOXXY_CHATS_DIR` | Desktop: override the NDJSON chat-log directory (default `~/.moxxy/chats`). |
| `MOXXY_UPDATE_URL` | Desktop: override the self-update manifest URL. |
| `MOXXY_UPDATE_SIGNING_KEY` | CI only: private key used to sign desktop app bundles. |
| `MOXXY_APP_BUNDLE_ROOT` / `MOXXY_APP_BUNDLE_VERSION` | Set internally by the desktop bootstrap loader — not user-set. |

## Architecture

```
@moxxy/sdk                          ← typed public surface (zero runtime deps)
@moxxy/core                         ← runtime: event log, registries, plugin host, permissions, skills
@moxxy/tools-builtin                ← Read / Edit / Write / Bash / Grep / Glob
@moxxy/mode-default                 ← "default" mode: Claude Code-style ReAct loop (active by default)
@moxxy/mode-goal                    ← "goal" mode: autonomous auto-approve loop (runs until goal_complete)
@moxxy/mode-deep-research           ← "research" mode: multi-query fan-out + cited synthesis
@moxxy/plugin-provider-anthropic    ← LLM provider
@moxxy/plugin-provider-openai       ← LLM provider
@moxxy/plugin-provider-openai-codex ← ChatGPT OAuth provider
@moxxy/plugin-provider-claude-code  ← Claude Pro/Max OAuth provider
@moxxy/plugin-provider-admin        ← register OpenAI-compatible providers at runtime
@moxxy/plugin-mcp                   ← MCP servers as tool sources
@moxxy/plugin-vault                 ← encrypted secrets
@moxxy/plugin-memory                ← journal LTM + vector recall + STM selectors
@moxxy/plugin-embeddings-openai     ← neural embeddings (optional)
@moxxy/plugin-embeddings-transformers ← on-device embeddings via transformers.js
@moxxy/plugin-stt-whisper           ← OpenAI Whisper Transcriber (voice in)
@moxxy/plugin-stt-whisper-codex     ← Whisper Transcriber via the ChatGPT OAuth creds
@moxxy/plugin-browser               ← headless Playwright sidecar + web_fetch
@moxxy/plugin-computer-control      ← macOS native input (screenshot, click, type, …)
@moxxy/plugin-oauth                 ← generic OAuth 2.0 + PKCE / device-code
@moxxy/plugin-cli                   ← Ink TUI + TuiChannel
@moxxy/plugin-telegram              ← TelegramChannel via grammy (text + voice)
@moxxy/plugin-channel-http          ← HTTP channel (POST /v1/turn, /v1/turn/stream, /v1/turn/audio)
@moxxy/plugin-channel-web           ← web surface channel (browser app rendering view-spec UIs over a WebSocket)
@moxxy/plugin-channel-mobile        ← mobile channel (desktop IPC contract over an authenticated WebSocket; `moxxy mobile`)
@moxxy/plugin-channel-virtual-office ← pixel-art office game channel — every worker sprite is a full session (`moxxy office`)
@moxxy/plugin-view                  ← present_view tool: agent-authored JSX-like view-specs → validated AST
@moxxy/plugin-scheduler             ← time-driven prompts
@moxxy/plugin-webhooks              ← external-event triggers (verified HTTP listener + tunnels)
@moxxy/plugin-workflows             ← swappable DAG engine: chain skills/prompts/tools into saved, schedulable pipelines
@moxxy/plugin-security              ← opt-in capability isolation (Isolator interface + none/inproc impls)
@moxxy/isolator-worker              ← worker_threads Isolator (memory + time + JS-state isolation)
@moxxy/isolator-subprocess          ← subprocess Isolator (kernel-enforced process boundary)
@moxxy/isolator-wasm                ← WebAssembly Isolator (zero ambient authority; experimental)
@moxxy/plugin-subagents             ← spawn sub-agents from a turn
@moxxy/plugin-commands              ← built-in slash commands (/info, /clear, /compact, …)
@moxxy/plugin-self-update           ← agent edits its own plugins/skills (Tier 1) + core (Tier 2)
@moxxy/plugin-plugins-admin         ← install / remove / enable / disable plugins at runtime (model tools + `moxxy plugins` CLI + `/plugins` picker)
@moxxy/plugin-usage-stats           ← per-session token + cost accounting
@moxxy/compactor-summarize          ← default context-window compactor
@moxxy/cache-strategy-stable-prefix ← default prompt-cache strategy (deterministic breakpoints; `none` opts out)
@moxxy/skills-builtin               ← Markdown skills bundled with the framework
@moxxy/runner                       ← bare session runner; channels attach over a unix socket (JSON-RPC)
@moxxy/cli                          ← the `moxxy` binary
@moxxy/config                       ← defineConfig + moxxy.config.ts loader
@moxxy/testing                      ← FakeProvider + record/replay harness
@moxxy/chat-model                   ← UI-neutral chat model (event→block fold + markdown AST + chunked log); shared by the TUI and desktop
apps/desktop                        ← Electron desktop app (attaches to @moxxy/runner)
apps/mobile                         ← Expo (React Native) PoC: the shared client layer over the desktop's WebSocket bridge
@moxxy/desktop-ipc-contract         ← typed desktop IPC boundary (channels + payloads + Zod validation + error envelope)
@moxxy/desktop-host                 ← desktop Electron main process (runner pool/supervisor, IPC, NDJSON chat log, security)
@moxxy/desktop-ui                   ← framework-light React UI primitives (Icon set, Modal, Skeleton); shared by the renderer
@moxxy/client-core                  ← DOM-free headless client layer (stores + use* hooks + transport seam + platform capabilities)
@moxxy/client-platform-web          ← web platform capabilities for client-core (mic capture, Web Speech TTS, localStorage KV)
@moxxy/client-transport-ws          ← MoxxyApi over a WebSocket JSON-RPC client (global WebSocket; Metro/RN-safe)
@moxxy/ipc-server-ws                ← serves the desktop IPC contract over an authenticated WebSocket (bearer-token handshake)
@moxxy/design-tokens                ← framework-neutral design tokens + :root CSS-variable generator
```

The hard invariant: `@moxxy/sdk` has zero internal deps; `@moxxy/core` doesn't import any plugin. Enforced in CI via `pnpm check:deps`.

## Repo layout

```
packages/        publishable @moxxy/* packages
apps/            desktop app, mobile (Expo) PoC, docs site, fixture-recorder
assets/          README media (mascot + demo gifs)
tooling/         shared tsconfig + eslint + vitest preset
.claude/agents/  AI-agent author guides (skill, plugin, tool, channel, provider, compactor, cache strategy, …)
AGENTS.md        index for AI agents working in this repo
```

## Development

```sh
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm -r test           # 250+ tests across the workspace
pnpm check:deps        # architectural invariant check (SDK & core stay clean)
```

CI runs all of the above on every push + PR.

## 🤝 Contributing

PRs welcome. Open an issue first for anything non-trivial. Per-block author guides in [`.claude/agents/`](.claude/agents/) describe how to write skills, plugins, tools, channels, providers, loop strategies, compactors, and cache strategies.

## 📝 License

TBD.
