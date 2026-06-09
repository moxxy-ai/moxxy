---
title: 'Package index'
description: One-line map of every package in the moxxy monorepo.
sidebar:
  order: 0
---

Every package in the monorepo, one line each. Packages with a dedicated
page link to it; the rest are summarized here.

## Runtime

| Package | What it is |
|---|---|
| [`@moxxy/sdk`](/packages/sdk/) | Typed public surface: `define*` factories, event types, hooks. Zero runtime deps. |
| [`@moxxy/core`](/packages/core/) | The runtime: event log, plugin host, registries, permissions, session. |
| [`@moxxy/config`](/packages/config/) | `defineConfig` + `moxxy.config.ts` loader. |
| [`@moxxy/cli`](/packages/cli/) | The `moxxy` binary. |
| `@moxxy/runner` | Bare session runner; channels attach over a unix socket (JSON-RPC). |
| [`@moxxy/testing`](/packages/testing/) | FakeProvider + record/replay harness + session helpers. |
| `@moxxy/skills-builtin` | Markdown skills bundled with the framework. |
| [`@moxxy/tools-builtin`](/packages/tools-builtin/) | Read / Write / Edit / Bash / Grep / Glob / recall / Sleep. |

## Modes (loop strategies)

| Package | What it is |
|---|---|
| [`@moxxy/mode-default`](/packages/mode-default/) | Claude Code-style ReAct loop; the default mode. |
| [`@moxxy/mode-goal`](/packages/mode-goal/) | Autonomous auto-approve loop; runs across turns until `goal_complete`. |
| [`@moxxy/mode-deep-research`](/packages/mode-deep-research/) | Multi-query fan-out + cited synthesis. |
| `@moxxy/compactor-summarize` | Default summarize-old-turns context compactor. |
| `@moxxy/cache-strategy-stable-prefix` | Default prompt-cache strategy (deterministic stable-prefix breakpoints). |

## Providers

| Package | What it is |
|---|---|
| [`@moxxy/plugin-provider-anthropic`](/packages/plugin-provider-anthropic/) | Anthropic Messages API (API key). |
| [`@moxxy/plugin-provider-openai`](/packages/plugin-provider-openai/) | OpenAI Chat Completions (API key). |
| [`@moxxy/plugin-provider-openai-codex`](/packages/plugin-provider-openai-codex/) | ChatGPT Pro/Plus OAuth (Responses API). |
| `@moxxy/plugin-provider-claude-code` | Claude Pro/Max OAuth (Anthropic Messages API via a Claude Code token). |
| `@moxxy/plugin-provider-admin` | `provider_add/list/remove/test` tools — register OpenAI-compatible vendors at runtime. |

## Channels

| Package | What it is |
|---|---|
| [`@moxxy/plugin-cli`](/packages/plugin-cli/) | Ink TUI channel + interactive permission resolver. |
| [`@moxxy/plugin-telegram`](/packages/plugin-telegram/) | Telegram channel (TOFU pairing, voice notes). |
| [`@moxxy/plugin-channel-http`](/packages/plugin-channel-http/) | HTTP channel (`POST /v1/turn`, SSE streaming, audio). |
| `@moxxy/plugin-channel-web` | Web surface channel: browser app rendering agent-authored view-spec UIs over a WebSocket. |
| `@moxxy/plugin-channel-mobile` | Mobile channel: the desktop IPC contract over an authenticated WebSocket (`moxxy mobile`). |

## Plugins

| Package | What it is |
|---|---|
| [`@moxxy/plugin-vault`](/packages/plugin-vault/) | AES-256-GCM secret store (OS keychain or passphrase). |
| [`@moxxy/plugin-memory`](/packages/plugin-memory/) | Long-term memory journal + TF-IDF / vector recall. |
| [`@moxxy/plugin-mcp`](/packages/plugin-mcp/) | Model Context Protocol servers as tool sources. |
| [`@moxxy/plugin-browser`](/packages/plugin-browser/) | `web_fetch` + Playwright browser sessions. |
| [`@moxxy/plugin-scheduler`](/packages/plugin-scheduler/) | Cron/heartbeat time-driven prompts. |
| [`@moxxy/plugin-webhooks`](/packages/plugin-webhooks/) | External-event triggers: verified HTTP listener + tunnels. |
| `@moxxy/plugin-workflows` | Swappable DAG engine: chain skills/prompts/tools into saved, schedulable pipelines. |
| [`@moxxy/plugin-security`](/packages/plugin-security/) | Opt-in capability isolation (Isolator interface + `none`/`inproc`). |
| [`@moxxy/isolator-worker`](/packages/isolator-worker/) | `worker_threads` isolator. |
| [`@moxxy/isolator-subprocess`](/packages/isolator-subprocess/) | Subprocess isolator (kernel-enforced boundary). |
| [`@moxxy/isolator-wasm`](/packages/isolator-wasm/) | WebAssembly isolator (experimental). |
| [`@moxxy/plugin-subagents`](/packages/plugin-subagents/) | Dispatch typed sub-agents from a turn. |
| [`@moxxy/plugin-oauth`](/packages/plugin-oauth/) | Generic OAuth 2.0 + PKCE / device-code flows. |
| [`@moxxy/plugin-embeddings-openai`](/packages/plugin-embeddings-openai/) | OpenAI embeddings. |
| [`@moxxy/plugin-embeddings-transformers`](/packages/plugin-embeddings-transformers/) | On-device embeddings (transformers.js). |
| `@moxxy/plugin-stt-whisper` | OpenAI Whisper transcriber (voice in). |
| `@moxxy/plugin-stt-whisper-codex` | Whisper transcriber via the ChatGPT OAuth credentials. |
| [`@moxxy/plugin-computer-control`](/packages/plugin-computer-control/) | macOS native input (screenshot, click, type). |
| `@moxxy/plugin-commands` | Channel-agnostic slash commands (`/info`, `/clear`, `/new`, `/help`). |
| [`@moxxy/plugin-plugins-admin`](/packages/plugin-plugins-admin/) | Install / enable / disable plugins at runtime (+ `moxxy plugins`, `/plugins`). |
| `@moxxy/plugin-self-update` | Guardrailed, transactional self-editing of plugins/skills (Tier 1) and core (Tier 2). |
| `@moxxy/plugin-usage-stats` | Cross-session token + cost accounting (`~/.moxxy/usage.json`). |
| `@moxxy/plugin-view` | `present_view` tool: agent-authored JSX-like view-specs parsed into a validated AST. |

## Desktop & shared client layer

| Package | What it is |
|---|---|
| `@moxxy/chat-model` | UI-neutral chat model: event→block fold + markdown AST + chunked append log. |
| `@moxxy/desktop-ipc-contract` | Single source of truth for the desktop IPC boundary (channels, payloads, Zod validation). |
| `@moxxy/desktop-host` | Desktop Electron main process: runner pool/supervisor, IPC handlers, NDJSON chat log, self-update gate. |
| `@moxxy/desktop-ui` | Dependency-free React UI primitives (Icon set, Modal, Skeleton). |
| `@moxxy/client-core` | DOM-free headless client layer: stores + `use*` hooks + transport seam + platform capabilities. |
| `@moxxy/client-platform-web` | Web platform capabilities (mic capture, Web Speech TTS, localStorage KV). |
| `@moxxy/client-transport-ws` | `MoxxyApi` over a WebSocket JSON-RPC client (Metro/React Native-safe). |
| `@moxxy/ipc-server-ws` | Serves the desktop IPC contract over an authenticated WebSocket. |
| `@moxxy/design-tokens` | Framework-neutral design tokens + `:root` CSS-variable generator. |

## Apps

| App | What it is |
|---|---|
| `apps/desktop` | Electron desktop app; attaches to `@moxxy/runner`, hot self-updates its JS layers. |
| `apps/mobile` | Expo (React Native) proof-of-concept on the shared client layer over the WebSocket bridge. |
| `apps/docs` | This documentation site (Astro Starlight). |
| `apps/fixture-recorder` | Internal helper for recording provider fixtures. |
