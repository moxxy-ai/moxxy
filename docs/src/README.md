# Moxxy

**Local-first agentic framework with a Rust core and Node.js CLI**

Moxxy is a framework for building, running, and orchestrating AI agents with strong isolation, pluggable providers, skill-based composition, and full event observability. It runs entirely on your machine -- no cloud required.

## Key Features

- **Pluggable providers** -- Any OpenAI-compatible LLM endpoint, plus built-in catalogs for Anthropic, OpenAI, xAI, Google Gemini, and DeepSeek
- **Skill-based agents** -- Markdown skills with YAML frontmatter, declared primitive allowlists, and quarantine-before-approval security
- **85 built-in primitives** -- Filesystem, shell, HTTP, memory, git, web browsing, webhooks, channels, skills, vault, agents, hive, MCP, and more
- **Per-agent isolation** -- Separate workspace, memory store, runtime sandbox, and scoped secrets per agent
- **Sub-agent orchestration** -- Hierarchical spawning with bounded depth and fan-out limits
- **Full SSE event stream** -- 60 event types covering every action, with automatic secret redaction and persistence
- **Scoped API tokens** -- SHA-256 hashed PATs with 9 permission scopes, optional TTL, and instant revocation
- **Full-screen TUI** -- Split-pane chat interface with real-time event streaming, agent info panel, and slash commands
- **WASI plugin host** -- Run provider plugins in sandboxed WebAssembly with fuel/memory limits and signature verification
- **Vector search** -- sqlite-vec powered semantic memory retrieval with 384-dimension embeddings

## Architecture at a Glance

```
                    +----------------+
                    |  moxxy CLI     |  Node.js interactive + scriptable
                    |  (Node.js)     |  commands, TUI, SSE consumer
                    +-------+--------+
                            | HTTP / SSE
                    +-------+--------+
                    |    Gateway     |  Axum REST + SSE server
                    |  (moxxy-      |  auth middleware, rate limiting,
                    |   gateway)    |  heartbeat cron
                    +-------+--------+
                            |
           +----------------+----------------+
           |                |                |
    +------+------+  +------+------+  +------+------+
    |    Core     |  |    Vault    |  |   Runtime   |
    | (moxxy-    |  | (moxxy-    |  | (moxxy-    |
    |  core)     |  |  vault)    |  |  runtime)  |
    +------+------+  +------+------+  +------+------+
           |                |                |
    +------+------+  +------+------+  +------+------+
    |   Storage   |  |     OS      |  |   Plugin    |
    | (moxxy-    |  |   Keychain  |  | (moxxy-    |
    |  storage)  |  +-------------+  |  plugin)   |
    +------+------+                  +------+------+
           |                                |
    +------+------+                  +------+------+
    |   SQLite    |                  |    WASI     |
    |   (WAL)     |                  |  Modules    |
    +-------------+                  +-------------+
```

## Workspace Crates

| Crate | Purpose |
|-------|---------|
| `moxxy-types` | Shared types, enums, error definitions |
| `moxxy-test-utils` | TestDb, fixture factories |
| `moxxy-storage` | SQLite DAOs, row types, Database wrapper |
| `moxxy-core` | Auth, events, memory, heartbeat, security, skills |
| `moxxy-vault` | Secret backend abstraction, grant-based access |
| `moxxy-gateway` | Axum REST API, auth middleware, SSE streaming |
| `moxxy-runtime` | Provider trait, Primitive trait, 85 primitives |
| `moxxy-channel` | Channel bridges, Telegram/Discord transports |
| `moxxy-mcp` | MCP client, stdio/SSE/streamable HTTP transports |
| `moxxy-plugin` | WASI plugin hosting, signature verification |

## Getting Started

The fastest way to get started:

```bash
# Install
curl -fsSL https://moxxy.ai/install.sh | sh

# Or build from source
git clone https://github.com/moxxy-ai/moxxy-v4.git
cd moxxy-v4 && cargo build --workspace --release
cd apps/moxxy-cli && npm install && npm link

# Run setup wizard
moxxy init

# Launch the TUI
moxxy tui
```

See the [Installation](getting-started/installation.md) and [Quick Start](getting-started/quick-start.md) guides for detailed instructions.

## License

Dual-licensed under Apache 2.0 and MIT.
