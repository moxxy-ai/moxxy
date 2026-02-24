# Benchmark: moxxy vs OpenClaw

> Comparison date: 2026-02-24 | moxxy v0.11.2 vs OpenClaw (latest main)

## Executive Summary

Both moxxy and OpenClaw are self-hosted, multi-agent AI frameworks that connect to messaging platforms and execute tasks autonomously. They differ fundamentally in philosophy: **moxxy** prioritizes performance, security isolation, and a minimal footprint via Rust + WASM sandboxing, while **OpenClaw** prioritizes breadth of integrations and community-driven extensibility via TypeScript/Node.js.

---

## 1. Technical Foundation

| Metric | moxxy | OpenClaw |
|---|---|---|
| **Language** | Rust (2024 edition) | TypeScript / Node.js (v22+) |
| **Binary / Runtime** | Single ~12 MB static binary | Node.js monorepo (pnpm) |
| **Source LOC** | ~17,000 (Rust) | ~50,000+ (TypeScript) |
| **Dependencies** | 51 direct crates | 200+ npm packages |
| **Package manager** | Cargo | pnpm |
| **Frontend** | React 19 SPA (embedded in binary) | React-based web UI + companion apps |
| **Deployment** | Single binary, zero runtime deps | Node.js + pnpm + native modules |

### Verdict

moxxy ships as a single self-contained binary with the frontend baked in -- despite growing from ~11k to ~17k LOC over recent releases, the binary size has remained stable at ~12 MB. OpenClaw requires a Node.js runtime and a full monorepo install. For deployment simplicity and cold-start performance, moxxy has a clear edge. OpenClaw trades that for faster iteration speed and a larger contributor pool.

---

## 2. Agent Architecture

| Feature | moxxy | OpenClaw |
|---|---|---|
| **Agent isolation** | Per-agent directory with private SQLite, vault, persona, skills | Per-agent workspace with session-based routing |
| **Execution model** | ReAct loop (XML `<invoke>` tags, max 10 iterations) | Pi agent runtime with tool streaming |
| **Sandboxing** | WASM (wasmtime) with capability-based permissions | Not prominently documented |
| **Memory** | SQLite with STM + LTM + vec0 vector embeddings | Local Markdown files |
| **Swarm intelligence** | `[ANNOUNCE]` tags to shared `swarm.db` | Multi-agent routing (no shared knowledge base) |
| **Self-modification** | `evolve_core` skill in dev mode | Not available |
| **Scheduled autonomy** | Cron-based heartbeat daemon | Heartbeat daemon + webhooks + Gmail Pub/Sub |

### Verdict

moxxy provides stronger isolation guarantees (WASM sandbox with filesystem/network/memory caps) and a more structured memory system (vector-embedded SQLite vs flat Markdown). OpenClaw offers a broader scheduling surface (webhooks, Gmail triggers). moxxy's swarm intelligence is unique -- agents can share learned facts across the swarm, which OpenClaw lacks.

---

## 3. LLM Provider Support

| Provider | moxxy | OpenClaw |
|---|---|---|
| OpenAI (GPT-4o, o1, o3) | Yes | Yes |
| Anthropic (Claude) | Yes | Yes |
| Google (Gemini) | Yes | Yes |
| DeepSeek | Yes | Yes |
| xAI (Grok) | Yes | -- |
| Mistral | Yes | Yes |
| Z.Ai (GLM-5, GLM-4) | Yes | -- |
| OpenRouter (300+ models) | Yes | -- |
| Vercel AI Gateway | Yes | -- |
| Custom / Local (Ollama, LM Studio, vLLM) | Yes (custom provider system) | Yes |
| Meta (Llama via local) | Yes (via OpenRouter or custom) | Yes (local) |
| MiniMax (M2.5, M2.1, M2) | Yes | Yes |
| **Total built-in providers** | **11** | **6+** |
| **Total supported models** | **64** | **~30** |
| **Custom provider support** | **Yes (via API, UI, and agent skill)** | **Limited** |

### Verdict

moxxy now supports 11 built-in providers (including Z.Ai) with 64 supported models across multi-model gateways (OpenRouter with 300+ models, Vercel AI Gateway), Chinese AI providers (Z.Ai, MiniMax), and all major Western providers. The custom provider system allows users to add any OpenAI/Gemini/Anthropic-compatible endpoint (local or remote) via the web UI, API, or by simply asking their agent.

---

## 4. Channel / Interface Support

| Channel | moxxy | OpenClaw |
|---|---|---|
| Web dashboard | Yes (Axum + SSE) | Yes (WebSocket gateway) |
| Terminal UI | Yes (Ratatui) | -- |
| Telegram | Yes (teloxide) | Yes |
| Discord | Yes (serenity) | Yes |
| Slack | Yes | Yes |
| WhatsApp | Yes | Yes |
| Signal | -- | Yes |
| iMessage | -- | Yes (via BlueBubbles) |
| Microsoft Teams | -- | Yes |
| Matrix | -- | Yes |
| Google Chat | -- | Yes |
| Zalo | -- | Yes |
| macOS hotkey | Yes | -- |
| Mobile endpoint | Yes | Yes (companion apps) |
| Voice (wake word) | -- | Yes |
| Browser automation | -- | Yes (Chrome control) |
| **Total channels** | **8** | **12+** |

### Verdict

OpenClaw has broader channel coverage, especially for enterprise messaging (Teams, Google Chat) and privacy-focused platforms (Signal, Matrix). moxxy uniquely offers a full terminal UI and macOS global hotkey. OpenClaw's browser automation and voice wake word are notable capabilities moxxy lacks.

---

## 5. Performance Characteristics

| Metric | moxxy | OpenClaw |
|---|---|---|
| **Cold start time** | ~50ms (native binary) | ~2-5s (Node.js boot + module load) |
| **Memory footprint (idle)** | ~15-30 MB (single agent) | ~100-200 MB (Node.js baseline) |
| **Binary size** | ~12 MB | N/A (runtime + node_modules ~300 MB+) |
| **Async model** | tokio (zero-cost futures) | Node.js event loop (V8) |
| **Concurrency** | Multi-threaded (tokio tasks) | Single-threaded (event loop) + worker threads |
| **Database** | SQLite (embedded, zero-network) | Markdown files (filesystem I/O) |
| **Memory search** | Vector similarity (vec0) | Grep/text search on Markdown |

> *Note: Cold start and memory figures are estimated based on runtime characteristics. Formal benchmarks with instrumentation are pending.*

### Verdict

Rust gives moxxy fundamental performance advantages: faster startup, lower memory usage, true multi-threaded concurrency, and zero-cost async. The embedded SQLite with vector search is significantly faster for memory retrieval than scanning Markdown files. For resource-constrained environments (VPS, Raspberry Pi, edge devices), moxxy is the clear winner.

---

## 6. Security Model

| Feature | moxxy | OpenClaw |
|---|---|---|
| **Agent sandboxing** | WASM with capability controls | Process-level isolation |
| **Filesystem isolation** | Per-agent, configurable in WASM | Per-agent workspace |
| **Network isolation** | Capability-gated in WASM | Not documented |
| **Memory limits** | Configurable per container | Not documented |
| **Secret storage** | Encrypted `SecretsVault` | Environment variables / config |
| **Auth** | Internal token (`X-Moxxy-Internal-Token`) | WebSocket gateway auth |

### Verdict

moxxy's WASM sandboxing provides defense-in-depth that OpenClaw currently lacks. An agent in moxxy can be restricted from filesystem access, network access, or given memory limits -- critical for running untrusted agent code. moxxy's encrypted vault is also stronger than environment-variable-based secret management.

---

## 7. Extensibility & Ecosystem

| Feature | moxxy | OpenClaw |
|---|---|---|
| **Skill system** | 25 built-in (manifest.toml + run.sh) | 50+ integrations + community skills |
| **MCP support** | Yes (Model Context Protocol) | Not documented |
| **Plugin format** | Shell/Python scripts | TypeScript modules |
| **Community size** | Early stage | 100,000+ GitHub stars |
| **Companion apps** | -- | macOS, iOS, Android |
| **Live Canvas / A2UI** | -- | Yes |

### Verdict

OpenClaw has a massive ecosystem advantage with 50+ integrations and a thriving community. moxxy's MCP support is a forward-looking differentiator, and its shell/Python skill format has a lower barrier to entry than TypeScript modules. However, OpenClaw's sheer community momentum is hard to match.

---

## 8. Scorecard

| Category | moxxy | OpenClaw | Winner |
|---|---|---|---|
| **Performance** | 9/10 | 5/10 | moxxy |
| **Security / Isolation** | 9/10 | 5/10 | moxxy |
| **Memory System** | 9/10 | 4/10 | moxxy |
| **Deployment Simplicity** | 10/10 | 4/10 | moxxy |
| **LLM Provider Coverage** | 10/10 | 8/10 | moxxy |
| **Channel Coverage** | 7/10 | 10/10 | OpenClaw |
| **Ecosystem / Community** | 3/10 | 10/10 | OpenClaw |
| **Extensibility** | 8/10 | 8/10 | Tie |
| **Swarm Intelligence** | 8/10 | 3/10 | moxxy |
| **Resource Efficiency** | 10/10 | 4/10 | moxxy |
| **Overall** | **84/100** | **61/100** | **moxxy** |

---

## Conclusion

**moxxy excels** where engineering rigor matters: performance, security, memory architecture, and deployment simplicity. A single ~12 MB binary with 25 built-in skills, 11 LLM providers (64 models), WASM-sandboxed agents, vector-embedded memory, and swarm intelligence represents a technically superior foundation.

**OpenClaw excels** where ecosystem breadth matters: more messaging channels, more integrations, and a massive community. Its TypeScript stack enables faster community contributions and broader adoption.

**Choose moxxy** if you need: self-hosted efficiency, strong agent isolation, structured memory with semantic search, resource-constrained deployment, or multi-agent swarm coordination.

**Choose OpenClaw** if you need: maximum channel coverage, the largest plugin ecosystem, voice interaction, browser automation, or community support.

---

*This benchmark reflects publicly available information as of February 2026. Performance figures are based on runtime characteristics and may vary by hardware and configuration.*
