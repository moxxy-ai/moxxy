Create a new messaging/channel interface for the moxxy agent framework.

Interface request: $ARGUMENTS

## Instructions

### 1. Understand the Request

Parse the interface name and description. The name should be snake_case (e.g., `matrix`, `signal`, `email`).

### 2. Read Reference Materials

Read these files to understand the patterns:

- `src/interfaces/slack.rs` -- Full channel interface example (simplest)
- `src/interfaces/whatsapp.rs` -- Webhook-based channel pattern
- `src/core/lifecycle/mod.rs` -- `LifecycleComponent` trait definition
- `src/core/agent/interfaces.rs` -- How interfaces are registered and attached
- `src/interfaces/mod.rs` -- Module declarations
- `docs/architecture.md` -- Interface architecture section

### 3. Create the Interface

Create `src/interfaces/<name>.rs` following this structure:

```rust
use anyhow::Result;
use async_trait::async_trait;
use axum::{Json, Router, extract::State, routing::post};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::core::agent::{LlmRegistry, MemoryRegistry, SkillRegistry};
use crate::core::lifecycle::LifecycleComponent;

pub struct <Name>Channel {
    agent_name: String,
    registry: MemoryRegistry,
    skill_registry: SkillRegistry,
    llm_registry: LlmRegistry,
}

impl <Name>Channel {
    pub fn new(
        agent_name: String,
        registry: MemoryRegistry,
        skill_registry: SkillRegistry,
        llm_registry: LlmRegistry,
    ) -> Self {
        Self {
            agent_name,
            registry,
            skill_registry,
            llm_registry,
        }
    }
}

#[async_trait]
impl LifecycleComponent for <Name>Channel {
    async fn on_init(&mut self) -> Result<()> {
        info!("[{}] <Name> channel initialized", self.agent_name);
        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        // Check vault for API token
        let token = {
            let reg = self.registry.lock().await;
            if let Some(mem_arc) = reg.get(&self.agent_name) {
                let mem = mem_arc.lock().await;
                // Read token from vault or config
                // mem.get_vault_secret("<name>_token").await
                None::<String> // Replace with actual token retrieval
            } else {
                None
            }
        };

        if let Some(_token) = token {
            info!("[{}] <Name> channel starting...", self.agent_name);

            // Set up webhook listener or polling loop
            // Clone registries for the async handler
            let agent = self.agent_name.clone();
            let registry = self.registry.clone();
            let skill_registry = self.skill_registry.clone();
            let llm_registry = self.llm_registry.clone();

            tokio::spawn(async move {
                // Webhook server or polling loop here
                // On incoming message:
                //   1. Extract message text
                //   2. Get agent's memory, skills, LLM from registries
                //   3. Call AutonomousBrain::execute_react_loop()
                //   4. Send response back to platform
                info!("[{}] <Name> channel listener running", agent);
            });
        } else {
            info!("[{}] <Name> channel: no token configured, skipping", self.agent_name);
        }

        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!("[{}] <Name> channel shutting down", self.agent_name);
        Ok(())
    }
}
```

**Key conventions from existing interfaces:**
- Constructor takes `agent_name`, `MemoryRegistry`, `SkillRegistry`, `LlmRegistry`
- `on_start()` checks vault for API token; silently skips if not configured
- Message handling spawns a tokio task with cloned registry references
- The handler calls `AutonomousBrain::execute_react_loop()` with the incoming message
- Response is posted back to the platform's API

### 4. Register in 3 Places

**a. Module declaration** -- Add to `src/interfaces/mod.rs`:
```rust
pub mod <name>;
```

**b. Import and attach** -- Add to `src/interfaces/../core/agent/interfaces.rs`:

Add the use statement at the top:
```rust
use crate::interfaces::<name>::<Name>Channel;
```

Add the attachment in `attach_interfaces()` function, following the existing pattern (e.g., after WhatsApp):
```rust
// <Name>
lifecycle.attach(Arc::new(Mutex::new(<Name>Channel::new(
    name.to_string(),
    swarm_registry.clone(),
    skill_registry.clone(),
    llm_registry.clone(),
))));
```

### 5. Optionally Create a Notification Skill

If the interface supports outbound messages, create a matching skill using `/create-skill`:

```
/create-skill <name>_notify - Send a proactive message via <Name> to the configured user
```

This skill should POST to an API endpoint like `/api/agents/{agent}/channels/<name>/send`.

### 6. Optionally Create Channel API Handlers

If the interface needs web dashboard configuration (token setup, pairing, etc.), use `/create-handler` to add endpoints under `/api/agents/{agent}/channels/<name>/`.

Then add a channel handler subdirectory:
- `src/interfaces/web/handlers/channels/<name>.rs`
- Register in `src/interfaces/web/handlers/channels/mod.rs`

### 7. Format and Build

Run `cargo fmt` to ensure proper formatting, then `cargo build --release`. Fix any compilation errors.

Common issues:
- Missing imports (check existing interfaces for the exact import paths)
- Lifetime issues with spawned tasks (clone all Arc references before the move)
- Missing `pub mod` declaration in `src/interfaces/mod.rs`
