# moxxy Architecture Deep-Dive

This document provides implementation-level architecture details for developers (human or AI) building on the moxxy framework.

## System Boot Sequence

```
cli::run_main()
  -> parse CLI args (web/tui/daemon/dev/headless)
  -> cli::swarm::boot_swarm_engine()
       -> for each agent in ~/.moxxy/agents/*/
            -> AgentInstance::boot(name, workspace_dir, run_mode, ...)
                 1. bootstrap::init_core_subsystems()
                      -> MemorySystem::new()         (SQLite)
                      -> SecretsVault::new()          (encrypted KV in same DB)
                      -> ContainerConfig::load()      (native or WASM)
                      -> NativeExecutor::new()        (skill runner)
                      -> SkillManager::new()          (skill registry)
                      -> LlmManager::new()            (multi-provider)
                 2. bootstrap::spawn_mcp_servers()    (MCP tool connections)
                 3. Register in global registries     (MemoryRegistry, SkillRegistry, etc.)
                 4. Register scheduler                (tokio-cron-scheduler)
                 5. lifecycle.attach(memory, skills)  (core components)
                 6. bootstrap::schedule_persisted_jobs() (restore cron from DB)
                 7. interfaces::attach_interfaces()   (Telegram, Discord, Slack, WhatsApp, Web, Desktop, Mobile)
                 8. Desktop mail poller               (macOS, if enabled)
                 9. selfcheck::attach_self_check()    (heartbeat)
            -> AgentInstance::run()
                 -> lifecycle.start()    (Init -> PluginsLoad -> ConnectChannels -> Ready)
                 -> await ctrl_c or headless job
                 -> lifecycle.shutdown()
```

**Key files:**
- `src/cli/mod.rs` -- CLI argument parsing and dispatch
- `src/cli/swarm.rs` -- Swarm engine boot loop
- `src/core/agent/mod.rs` -- `AgentInstance::boot()` and `run()`
- `src/core/agent/bootstrap.rs` -- `init_core_subsystems()`
- `src/core/agent/interfaces.rs` -- `attach_interfaces()`

## ReAct Loop

The brain is the central intelligence engine. All interfaces (Web, TUI, Telegram, Discord, Slack, WhatsApp) ultimately call the same function:

```
AutonomousBrain::execute_react_loop(prompt, origin, llm, memory, skills, container)
```

**Loop (max 10 iterations):**

1. **Build system prompt** with skill catalog (`SkillManager::get_skill_catalog()`) + agent persona (`persona.md`)
2. **Build messages**: system prompt + last 40 STM entries + swarm announcements + ephemeral loop context
3. **Call LLM**: `llm.generate_with_selected(&messages)`
4. **Parse response** for `<invoke name="skill_name">["arg1", "arg2"]</invoke>` XML tags
5. **Execute skill**: `SkillManager::prepare_skill()` -> `SkillExecution::execute()` (lock dropped before await)
6. **Feed result back** as ephemeral context: `"[Skill: {name}] Result:\n{result}"`
7. **Check for `[CONTINUE]`** tag -- if present, loop again for multi-step tasks
8. **Otherwise break** -- final response is persisted to STM

**Session isolation**: Non-human origins (webhooks, cron, delegation) get isolated STM sessions so they don't pollute the main conversation.

**Swarm broadcasting**: If response starts with `[ANNOUNCE]`, the fact is written to shared `swarm.db` readable by all agents.

**Key file:** `src/core/brain.rs`

## Skill Execution Pipeline

```
LLM output: <invoke name="host_shell">["ls -la"]</invoke>
  -> brain.rs regex captures name="host_shell", args=["ls -la"]
  -> SkillManager::prepare_skill("host_shell")
       -> returns (SkillManifest, SkillExecution::Native(executor))
  -> SkillExecution::execute(&manifest, &args)
       -> NativeExecutor::execute()
            -> Command::new("sh").arg("run.sh")
            -> inject env: AGENT_NAME, AGENT_HOME, AGENT_WORKSPACE,
                          MOXXY_API_BASE, MOXXY_INTERNAL_TOKEN
            -> if needs_env: inject all vault secrets
            -> pass args via stdin as JSON (or CLI if < 100KB)
            -> wait_with_output()
            -> return stdout
```

**Three execution paths** (SkillExecution enum):
- **Native** -- Shell scripts via `NativeExecutor` (most skills)
- **MCP** -- Model Context Protocol tool calls via `McpClient`
- **Openclaw** -- Documentation-only skills (LLM reads docs, uses `host_shell` for API calls)

**Key files:**
- `src/skills/mod.rs` -- `SkillManager`, `SkillManifest`, `SkillExecution`
- `src/skills/native_executor.rs` -- `NativeExecutor::execute()`

## Interface Architecture

All interfaces implement the `LifecycleComponent` trait:

```rust
#[async_trait]
pub trait LifecycleComponent {
    async fn on_init(&mut self) -> Result<()>   { Ok(()) }
    async fn on_start(&mut self) -> Result<()>  { Ok(()) }
    async fn on_shutdown(&mut self) -> Result<()> { Ok(()) }
}
```

**File:** `src/core/lifecycle/mod.rs`

The `LifecycleManager` holds a `Vec<Arc<Mutex<dyn LifecycleComponent>>>` and calls each phase sequentially: Init -> PluginsLoad -> ConnectChannels -> Ready -> Shutdown.

### Interface Registration Pattern

Every interface is:
1. Declared in `src/interfaces/mod.rs` as `pub mod <name>;`
2. Imported in `src/core/agent/interfaces.rs`
3. Constructed and attached via `lifecycle.attach(Arc::new(Mutex::new(Interface::new(...))))`

### Channel Interfaces (Telegram, Discord, Slack, WhatsApp)

These follow a common pattern:
- Hold `Arc<Mutex<>>` references to the agent's memory, skills, and LLM registries
- On `on_start()`: check vault for API token, if found start a listener (polling or webhook)
- On incoming message: spawn a tokio task that calls `AutonomousBrain::execute_react_loop()`
- Post the response back to the platform API

**Constructor signature pattern** (most channels):
```rust
pub fn new(
    agent_name: String,
    registry: MemoryRegistry,
    skill_registry: SkillRegistry,
    llm_registry: LlmRegistry,
) -> Self
```

**Key files:**
- `src/interfaces/telegram.rs`, `discord.rs`, `slack.rs`, `whatsapp.rs`
- `src/interfaces/desktop.rs`, `mobile.rs`
- `src/interfaces/web/` (Axum API + frontend)
- `src/interfaces/cli/` (Ratatui TUI)

## Web API Layer

The API server is an Axum application with shared state:

```rust
#[derive(Clone)]
pub(crate) struct AppState {
    pub registry: MemoryRegistry,           // HashMap<agent_name, Arc<Mutex<MemorySystem>>>
    pub skill_registry: SkillRegistry,      // HashMap<agent_name, Arc<Mutex<SkillManager>>>
    pub llm_registry: LlmRegistry,          // HashMap<agent_name, Arc<Mutex<LlmManager>>>
    pub container_registry: ContainerRegistry,
    pub scheduler_registry: SchedulerRegistry,
    pub scheduled_job_registry: ScheduledJobRegistry,
    pub log_tx: broadcast::Sender<String>,
    pub run_mode: RunMode,
    pub api_host: String,
    pub api_port: u16,
    pub internal_token: String,
}
```

### Handler Pattern

All handlers follow this structure:
```rust
pub async fn handler_name(
    Path(agent): Path<String>,           // agent name from URL
    State(state): State<AppState>,       // shared state
    Json(payload): Json<RequestType>,    // optional request body
) -> Json<serde_json::Value> {
    // 1. Lock registry, get agent's subsystem
    let mem_arc = {
        let reg = state.registry.lock().await;
        match reg.get(&agent) {
            Some(m) => m.clone(),
            None => return Json(json!({"success": false, "error": "Agent not found"}))
        }
    };
    // 2. Operate on subsystem (lock dropped after clone)
    let mem = mem_arc.lock().await;
    // 3. Return JSON with "success" field
    Json(json!({"success": true, "data": result}))
}
```

**Key files:**
- `src/interfaces/web/mod.rs` -- `AppState`, `ApiServer`, `WebServer`, SSE endpoint
- `src/interfaces/web/router.rs` -- All route definitions
- `src/interfaces/web/handlers/` -- Handler modules (agents, chat, memory, skills, vault, channels, schedules, webhooks, mcp, config, proxy, mobile)

## Global Registries

All agent subsystems are stored in thread-safe registries (type aliases in `src/core/agent/mod.rs`):

```rust
pub type MemoryRegistry    = Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>;
pub type SkillRegistry     = Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>;
pub type LlmRegistry       = Arc<Mutex<HashMap<String, Arc<Mutex<LlmManager>>>>>;
pub type ContainerRegistry = Arc<Mutex<HashMap<String, Arc<AgentContainer>>>>;
pub type SchedulerRegistry = Arc<Mutex<HashMap<String, Arc<Mutex<JobScheduler>>>>>;
pub type ScheduledJobRegistry = Arc<Mutex<HashMap<String, HashMap<String, Uuid>>>>;
```

**Pattern:** Lock the outer registry to get a clone of the agent's `Arc`, then drop the registry lock before locking the inner `Arc<Mutex<T>>`. This prevents deadlocks.

## Memory System

Each agent has a private SQLite database at `~/.moxxy/agents/<name>/memory.db`:

| Table | Purpose |
|-------|---------|
| **stm** | Short-term memory (conversation log) -- role, content, origin, timestamp |
| **ltm** | Long-term memory with `vec0` embeddings for semantic search |
| **scheduled_jobs** | Persisted cron jobs (name, cron, prompt, source) |
| **mcp_servers** | MCP server registrations (name, transport, url, command, args) |
| **webhook_events** | Webhook event log |
| **vault** | Encrypted key-value secrets |

**Swarm memory** lives in a shared `swarm.db` that all agents read from. Agents write to it via `[ANNOUNCE]` tags in their responses.

**Key files:** `src/core/memory/` (mod.rs, types.rs, stm.rs, ltm.rs, swarm.rs, schedule.rs, mcp.rs, webhook.rs)

## Frontend Architecture

React 19 SPA with Vite + Tailwind CSS.

**Layout:** `App.tsx` manages tab routing via `activeTab` state. The `Sidebar` component renders navigation. Each tab renders a panel component.

**Data flow:**
- `useApi` hook manages API base URL
- `useAgents` hook fetches agent list, manages active agent
- `usePolling` hook periodically fetches chat messages
- `useLogs` hook connects to SSE `/api/logs` endpoint
- Components fetch data via `fetch()` calls to `apiBase`

**Styling conventions:**
- Background: `bg-[#111927]/90`
- Borders: `border border-[#1e304f]`
- Headers: `text-[#00aaff]`, `tracking-widest`, `uppercase`, `text-sm`
- Success: `text-emerald-400`
- Warning: `text-amber-400`
- Error: `text-red-400`

**Key files:**
- `frontend/src/App.tsx` -- Layout, tab routing, state management
- `frontend/src/types/index.ts` -- TypeScript interfaces, `TabId` union type
- `frontend/src/components/` -- Panel components
- `frontend/src/hooks/` -- Custom hooks (useApi, useAgents, useLogs, usePolling)
- `frontend/src/components/Sidebar.tsx` -- Tab navigation

## Run Modes

```rust
pub enum RunMode {
    Web,              // API server + web dashboard + all interfaces
    Tui,              // Terminal UI only
    Daemon,           // API server + interfaces, no UI
    Dev,              // Like Web but enables evolve_core skill (self-modification)
    Headless(String), // Execute single prompt and exit
}
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `MOXXY_API_BASE` | API server base URL (default: `http://127.0.0.1:17890/api`) |
| `MOXXY_INTERNAL_TOKEN` | Auth token for internal API calls |
| `MOXXY_SOURCE_DIR` | Source directory (dev mode, for `evolve_core`) |
| `MOXXY_ARGS_MODE` | Set to `"stdin"` when skill args are passed via stdin |
| `AGENT_NAME` | Current agent's name |
| `AGENT_HOME` | Agent's home directory (`~/.moxxy/agents/<name>/`) |
| `AGENT_WORKSPACE` | Agent's workspace directory |
| `X-Moxxy-Internal-Token` | HTTP header for authenticated API calls |
