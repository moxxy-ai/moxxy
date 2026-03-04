use crate::pairing::PairingService;
use async_trait::async_trait;
use moxxy_storage::Database;
use moxxy_types::{ChannelError, RunStarter};
use moxxy_vault::SecretBackend;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Metadata for a single slash command = used for /help and platform registration.
#[derive(Debug, Clone)]
pub struct CommandDefinition {
    pub command: String,
    pub description: String,
}

/// Contextual data passed to every command handler invocation.
pub struct CommandContext<'a> {
    pub db: &'a Arc<Mutex<Database>>,
    pub vault_backend: &'a Arc<dyn SecretBackend + Send + Sync>,
    pub run_starter: &'a Arc<dyn RunStarter>,
    pub pairing_service: &'a Arc<PairingService>,
    pub agent_id: Option<String>,
    pub channel_id: &'a str,
    pub external_chat_id: &'a str,
    pub moxxy_home: &'a std::path::Path,
}

/// A handler for one or more slash commands.
#[async_trait]
pub trait CommandHandler: Send + Sync {
    /// The command definitions this handler responds to.
    fn definitions(&self) -> Vec<CommandDefinition>;

    /// Whether this command requires the chat to be bound to an agent.
    fn requires_binding(&self) -> bool {
        true
    }

    /// Execute the command. `args` is everything after the command name.
    async fn execute(&self, ctx: &CommandContext<'_>, args: &str) -> Result<String, ChannelError>;
}

/// Registry that maps command names to their handlers.
pub struct CommandRegistry {
    handlers: HashMap<String, Arc<dyn CommandHandler>>,
}

impl Default for CommandRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl CommandRegistry {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /// Register a handler. All commands from `definitions()` are mapped to this handler.
    pub fn register(&mut self, handler: Arc<dyn CommandHandler>) {
        for def in handler.definitions() {
            self.handlers.insert(def.command.clone(), handler.clone());
        }
    }

    /// Look up the handler for a command name (without the leading `/`).
    pub fn get(&self, command: &str) -> Option<&Arc<dyn CommandHandler>> {
        self.handlers.get(command)
    }

    /// Return all definitions, sorted by command name.
    pub fn all_definitions(&self) -> Vec<CommandDefinition> {
        let mut seen = HashMap::new();
        for handler in self.handlers.values() {
            for def in handler.definitions() {
                seen.entry(def.command.clone()).or_insert(def);
            }
        }
        let mut defs: Vec<CommandDefinition> = seen.into_values().collect();
        defs.sort_by(|a, b| a.command.cmp(&b.command));
        defs
    }
}

// ---------------------------------------------------------------------------
// Built-in handlers
// ---------------------------------------------------------------------------

/// `/start` = generate a pairing code. Does not require binding.
pub struct StartHandler;

#[async_trait]
impl CommandHandler for StartHandler {
    fn definitions(&self) -> Vec<CommandDefinition> {
        vec![CommandDefinition {
            command: "start".into(),
            description: "Get a pairing code".into(),
        }]
    }

    fn requires_binding(&self) -> bool {
        false
    }

    async fn execute(&self, ctx: &CommandContext<'_>, _args: &str) -> Result<String, ChannelError> {
        match ctx
            .pairing_service
            .generate_code(ctx.channel_id, ctx.external_chat_id)
        {
            Ok(code) => Ok(format!(
                "Your pairing code is: {}\n\nEnter this code in the Moxxy CLI within 5 minutes:\n  moxxy channel pair --code {} --agent <agent-id>",
                code, code
            )),
            Err(e) => Ok(format!("Failed to generate pairing code: {}", e)),
        }
    }
}

/// `/status` = show agent status and binding info.
pub struct StatusHandler;

#[async_trait]
impl CommandHandler for StatusHandler {
    fn definitions(&self) -> Vec<CommandDefinition> {
        vec![CommandDefinition {
            command: "status".into(),
            description: "Check agent status".into(),
        }]
    }

    async fn execute(&self, ctx: &CommandContext<'_>, _args: &str) -> Result<String, ChannelError> {
        let agent_id = match &ctx.agent_id {
            Some(id) => id,
            None => return Ok("This chat is not paired to an agent. Send /start to pair.".into()),
        };

        let status = ctx
            .run_starter
            .agent_status(agent_id)
            .ok()
            .flatten()
            .unwrap_or_else(|| "unknown".into());

        Ok(format!(
            "Agent: {}\nStatus: {}\nBinding: active",
            &agent_id[..8.min(agent_id.len())],
            status
        ))
    }
}

/// `/stop` = stop the current agent run.
pub struct StopHandler;

#[async_trait]
impl CommandHandler for StopHandler {
    fn definitions(&self) -> Vec<CommandDefinition> {
        vec![CommandDefinition {
            command: "stop".into(),
            description: "Stop current run".into(),
        }]
    }

    async fn execute(&self, ctx: &CommandContext<'_>, _args: &str) -> Result<String, ChannelError> {
        let agent_id = match &ctx.agent_id {
            Some(id) => id,
            None => return Ok("This chat is not paired to an agent.".into()),
        };

        match ctx.run_starter.stop_agent(agent_id).await {
            Ok(()) => Ok("Agent stopped.".into()),
            Err(e) => Ok(format!("Failed to stop agent: {}", e)),
        }
    }
}

/// `/help` = list all available commands. Does not require binding.
pub struct HelpHandler {
    definitions_list: Vec<CommandDefinition>,
}

impl HelpHandler {
    pub fn new(definitions: Vec<CommandDefinition>) -> Self {
        Self {
            definitions_list: definitions,
        }
    }
}

#[async_trait]
impl CommandHandler for HelpHandler {
    fn definitions(&self) -> Vec<CommandDefinition> {
        vec![CommandDefinition {
            command: "help".into(),
            description: "Show this help".into(),
        }]
    }

    fn requires_binding(&self) -> bool {
        false
    }

    async fn execute(
        &self,
        _ctx: &CommandContext<'_>,
        _args: &str,
    ) -> Result<String, ChannelError> {
        let mut lines = vec!["Available commands:".to_string()];
        for def in &self.definitions_list {
            lines.push(format!("/{} - {}", def.command, def.description));
        }
        Ok(lines.join("\n"))
    }
}

/// `/model` = view or change the agent's AI model.
pub struct ModelHandler;

#[async_trait]
impl CommandHandler for ModelHandler {
    fn definitions(&self) -> Vec<CommandDefinition> {
        vec![CommandDefinition {
            command: "model".into(),
            description: "View or change the AI model".into(),
        }]
    }

    async fn execute(&self, ctx: &CommandContext<'_>, args: &str) -> Result<String, ChannelError> {
        let agent_id = match &ctx.agent_id {
            Some(id) => id,
            None => return Ok("This chat is not paired to an agent.".into()),
        };

        let subcommand = args.split_whitespace().next().unwrap_or("get");

        match subcommand {
            "get" | "" => self.get_model(ctx, agent_id),
            "list" => self.list_models(ctx),
            "set" => {
                let parts: Vec<&str> = args.split_whitespace().collect();
                if parts.len() < 3 {
                    return Ok("Usage: /model set <provider_id> <model_id>".into());
                }
                self.set_model(ctx, agent_id, parts[1], parts[2]).await
            }
            _ => Ok("Usage: /model [get|list|set <provider_id> <model_id>]".into()),
        }
    }
}

impl ModelHandler {
    fn get_model(&self, ctx: &CommandContext<'_>, agent_id: &str) -> Result<String, ChannelError> {
        // Look up agent name from DB, then load config from YAML
        let db = ctx
            .db
            .lock()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;
        let agent = db
            .agents()
            .find_by_id(agent_id)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?
            .ok_or_else(|| ChannelError::StorageError("Agent not found".into()))?;
        let name = agent.name.as_deref().unwrap_or(agent_id);

        match moxxy_core::AgentStore::load(ctx.moxxy_home, name) {
            Ok(config) => Ok(format!(
                "Provider: {}\nModel: {}\nTemperature: {}",
                config.provider, config.model, config.temperature
            )),
            Err(e) => Ok(format!("Could not load agent config: {}", e)),
        }
    }

    fn list_models(&self, ctx: &CommandContext<'_>) -> Result<String, ChannelError> {
        let db = ctx
            .db
            .lock()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;
        let providers = db
            .providers()
            .list_all()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        if providers.is_empty() {
            return Ok("No providers registered.".into());
        }

        let mut lines = vec!["Available models:".to_string()];
        for provider in &providers {
            let models = db
                .providers()
                .list_models(&provider.id)
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;
            if models.is_empty() {
                lines.push(format!(
                    "  {} ({}): no models",
                    provider.display_name, provider.id
                ));
            } else {
                for model in &models {
                    lines.push(format!(
                        "  {} / {} ({})",
                        provider.id, model.model_id, model.display_name
                    ));
                }
            }
        }
        Ok(lines.join("\n"))
    }

    async fn set_model(
        &self,
        ctx: &CommandContext<'_>,
        agent_id: &str,
        provider_id: &str,
        model_id: &str,
    ) -> Result<String, ChannelError> {
        // Look up agent name from DB, then update YAML config
        let name = {
            let db = ctx
                .db
                .lock()
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;

            // Validate provider exists
            let provider = db
                .providers()
                .find_by_id(provider_id)
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;
            if provider.is_none() {
                return Ok(format!(
                    "Provider '{}' not found. Use /model list to see available providers.",
                    provider_id
                ));
            }

            let agent = db
                .agents()
                .find_by_id(agent_id)
                .map_err(|e| ChannelError::StorageError(e.to_string()))?
                .ok_or_else(|| ChannelError::StorageError("Agent not found".into()))?;
            agent.name.unwrap_or_else(|| agent_id.to_string())
        };

        let mut config = moxxy_core::AgentStore::load(ctx.moxxy_home, &name)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;
        config.provider = provider_id.to_string();
        config.model = model_id.to_string();
        moxxy_core::AgentStore::save(ctx.moxxy_home, &name, &config)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        Ok(format!(
            "Model updated to {} / {} (temperature: {})",
            provider_id, model_id, config.temperature
        ))
    }
}

/// `/vault` = manage agent secrets.
pub struct VaultHandler;

#[async_trait]
impl CommandHandler for VaultHandler {
    fn definitions(&self) -> Vec<CommandDefinition> {
        vec![CommandDefinition {
            command: "vault".into(),
            description: "Manage agent secrets".into(),
        }]
    }

    async fn execute(&self, ctx: &CommandContext<'_>, args: &str) -> Result<String, ChannelError> {
        let agent_id = match &ctx.agent_id {
            Some(id) => id,
            None => return Ok("This chat is not paired to an agent.".into()),
        };

        let parts: Vec<&str> = args.split_whitespace().collect();
        let subcommand = parts.first().copied().unwrap_or("help");

        match subcommand {
            "set" => {
                if parts.len() < 3 {
                    return Ok("Usage: /vault set <key> <value>".into());
                }
                let key = parts[1];
                let value = parts[2..].join(" ");
                self.set_secret(ctx, agent_id, key, &value)
            }
            "remove" => {
                if parts.len() < 2 {
                    return Ok("Usage: /vault remove <key>".into());
                }
                self.remove_secret(ctx, agent_id, parts[1])
            }
            "has" => {
                if parts.len() < 2 {
                    return Ok("Usage: /vault has <key>".into());
                }
                self.has_secret(ctx, agent_id, parts[1])
            }
            "list" => self.list_secrets(ctx, agent_id),
            _ => Ok("Usage: /vault [set <key> <value>|remove <key>|has <key>|list]".into()),
        }
    }
}

impl VaultHandler {
    fn set_secret(
        &self,
        ctx: &CommandContext<'_>,
        agent_id: &str,
        key: &str,
        value: &str,
    ) -> Result<String, ChannelError> {
        let backend_key = format!("agent:{}:{}", agent_id, key);
        let key_name = format!("agent:{}:{}", agent_id, key);

        // Store in backend
        ctx.vault_backend
            .set_secret(&backend_key, value)
            .map_err(|e| ChannelError::VaultError(e.to_string()))?;

        let db = ctx
            .db
            .lock()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        // Check if ref already exists = update backend, keep ref + grant
        let existing = db
            .vault_refs()
            .find_by_key_name(&key_name)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        let ref_id = if let Some(existing_ref) = existing {
            existing_ref.id
        } else {
            // Create vault_ref row
            let now = chrono::Utc::now().to_rfc3339();
            let ref_row = moxxy_storage::VaultSecretRefRow {
                id: uuid::Uuid::now_v7().to_string(),
                key_name,
                backend_key,
                policy_label: None,
                created_at: now.clone(),
                updated_at: now,
            };
            db.vault_refs()
                .insert(&ref_row)
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;
            ref_row.id
        };

        // Ensure grant exists (check for existing active grant first)
        let grants = db
            .vault_grants()
            .find_by_agent(agent_id)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;
        let has_active_grant = grants
            .iter()
            .any(|g| g.secret_ref_id == ref_id && g.revoked_at.is_none());

        if !has_active_grant {
            let now = chrono::Utc::now().to_rfc3339();
            let grant_row = moxxy_storage::VaultGrantRow {
                id: uuid::Uuid::now_v7().to_string(),
                agent_id: agent_id.to_string(),
                secret_ref_id: ref_id,
                created_at: now,
                revoked_at: None,
            };
            db.vault_grants()
                .insert(&grant_row)
                .map_err(|e| ChannelError::StorageError(e.to_string()))?;
        }

        Ok(format!("Secret '{}' stored.", key))
    }

    fn remove_secret(
        &self,
        ctx: &CommandContext<'_>,
        agent_id: &str,
        key: &str,
    ) -> Result<String, ChannelError> {
        let key_name = format!("agent:{}:{}", agent_id, key);

        let db = ctx
            .db
            .lock()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        let secret_ref = db
            .vault_refs()
            .find_by_key_name(&key_name)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        let Some(secret_ref) = secret_ref else {
            return Ok(format!("Secret '{}' not found.", key));
        };

        // Delete from backend (ignore not-found)
        let _ = ctx.vault_backend.delete_secret(&secret_ref.backend_key);

        // Revoke grants for this agent
        let grants = db
            .vault_grants()
            .find_by_agent(agent_id)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;
        for grant in &grants {
            if grant.secret_ref_id == secret_ref.id && grant.revoked_at.is_none() {
                let _ = db.vault_grants().revoke(&grant.id);
            }
        }

        // Delete the ref
        db.vault_refs()
            .delete(&secret_ref.id)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        Ok(format!("Secret '{}' removed.", key))
    }

    fn has_secret(
        &self,
        ctx: &CommandContext<'_>,
        agent_id: &str,
        key: &str,
    ) -> Result<String, ChannelError> {
        let key_name = format!("agent:{}:{}", agent_id, key);

        let db = ctx
            .db
            .lock()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        let secret_ref = db
            .vault_refs()
            .find_by_key_name(&key_name)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        match secret_ref {
            Some(_) => Ok(format!("Secret '{}' exists.", key)),
            None => Ok(format!("Secret '{}' not found.", key)),
        }
    }

    fn list_secrets(
        &self,
        ctx: &CommandContext<'_>,
        agent_id: &str,
    ) -> Result<String, ChannelError> {
        let db = ctx
            .db
            .lock()
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        let grants = db
            .vault_grants()
            .find_by_agent(agent_id)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;

        let active_grants: Vec<_> = grants.iter().filter(|g| g.revoked_at.is_none()).collect();

        if active_grants.is_empty() {
            return Ok("No secrets stored for this agent.".into());
        }

        let prefix = format!("agent:{}:", agent_id);
        let mut keys = Vec::new();
        for grant in &active_grants {
            if let Ok(Some(secret_ref)) = db.vault_refs().find_by_id(&grant.secret_ref_id) {
                // Strip the agent prefix to show just the key name
                let display_key = secret_ref
                    .key_name
                    .strip_prefix(&prefix)
                    .unwrap_or(&secret_ref.key_name);
                keys.push(display_key.to_string());
            }
        }

        if keys.is_empty() {
            return Ok("No secrets stored for this agent.".into());
        }

        keys.sort();
        let mut lines = vec![format!("Secrets ({}):", keys.len())];
        for key in &keys {
            lines.push(format!("  - {}", key));
        }
        Ok(lines.join("\n"))
    }
}

/// Build the default registry with all built-in commands.
pub fn build_default_registry() -> CommandRegistry {
    let mut registry = CommandRegistry::new();

    // Register all handlers except HelpHandler first to collect definitions
    let start = Arc::new(StartHandler);
    let status = Arc::new(StatusHandler);
    let stop = Arc::new(StopHandler);
    let model = Arc::new(ModelHandler);
    let vault = Arc::new(VaultHandler);

    registry.register(start);
    registry.register(status);
    registry.register(stop);
    registry.register(model);
    registry.register(vault);

    // Build help handler with all definitions (including its own)
    let mut all_defs = registry.all_definitions();
    all_defs.push(CommandDefinition {
        command: "help".into(),
        description: "Show this help".into(),
    });
    all_defs.sort_by(|a, b| a.command.cmp(&b.command));

    let help = Arc::new(HelpHandler::new(all_defs));
    registry.register(help);

    registry
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockRunStarter;

    #[async_trait]
    impl RunStarter for MockRunStarter {
        async fn start_run(&self, _agent_id: &str, _task: &str) -> Result<String, String> {
            Ok("run-123".into())
        }
        async fn stop_agent(&self, _agent_id: &str) -> Result<(), String> {
            Ok(())
        }
        fn agent_status(&self, _agent_id: &str) -> Result<Option<String>, String> {
            Ok(Some("idle".into()))
        }
        async fn spawn_child(
            &self,
            _: &str,
            _: &str,
            _: moxxy_types::SpawnOpts,
        ) -> Result<moxxy_types::SpawnResult, String> {
            unimplemented!()
        }
        fn list_children(&self, _: &str) -> Result<Vec<moxxy_types::ChildInfo>, String> {
            Ok(vec![])
        }
        fn dismiss_child(&self, _: &str, _: &str) -> Result<(), String> {
            Ok(())
        }
    }

    fn setup_db() -> Arc<Mutex<Database>> {
        let conn = rusqlite::Connection::open_in_memory().expect("Failed to open in-memory db");
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0002_channels.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0007_vault_secrets.sql"))
            .unwrap();
        conn.execute_batch(include_str!(
            "../../../migrations/0008_agent_name_persona.sql"
        ))
        .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0011_slim_agents.sql"))
            .unwrap();

        // Seed vault ref for channel FK
        conn.execute(
            "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
             VALUES ('secret-1', 'channel:ch1:bot_token', 'keyring://test', 'default', '2025-01-01', '2025-01-01')",
            [],
        )
        .unwrap();

        // Seed channel
        conn.execute(
            "INSERT INTO channels (id, channel_type, display_name, vault_secret_ref_id, status, created_at, updated_at)
             VALUES ('ch1', 'telegram', 'Test Bot', 'secret-1', 'active', '2025-01-01', '2025-01-01')",
            [],
        )
        .unwrap();

        // Seed provider
        conn.execute(
            "INSERT INTO providers (id, display_name, manifest_path, enabled, created_at) VALUES ('p1', 'Provider One', '/p1', 1, '2025-01-01')",
            [],
        )
        .unwrap();

        // Seed agent
        conn.execute(
            "INSERT INTO agents (id, name, workspace_root, status, depth, spawned_total, created_at, updated_at)
             VALUES ('agent-1', 'agent-1', '/tmp', 'idle', 0, 0, '2025-01-01', '2025-01-01')",
            [],
        )
        .unwrap();

        // Seed binding
        conn.execute(
            "INSERT INTO channel_bindings (id, channel_id, agent_id, external_chat_id, status, created_at, updated_at)
             VALUES ('bind-1', 'ch1', 'agent-1', '12345', 'active', '2025-01-01', '2025-01-01')",
            [],
        )
        .unwrap();

        Arc::new(Mutex::new(Database::new(conn)))
    }

    fn make_ctx<'a>(
        db: &'a Arc<Mutex<Database>>,
        vault: &'a Arc<dyn SecretBackend + Send + Sync>,
        run_starter: &'a Arc<dyn RunStarter>,
        pairing: &'a Arc<PairingService>,
        agent_id: Option<String>,
    ) -> CommandContext<'a> {
        CommandContext {
            db,
            vault_backend: vault,
            run_starter,
            pairing_service: pairing,
            agent_id,
            channel_id: "ch1",
            external_chat_id: "12345",
            moxxy_home: std::path::Path::new("/tmp/moxxy-test"),
        }
    }

    // --- Registry tests ---

    #[test]
    fn registry_dispatches_to_correct_handler() {
        let registry = build_default_registry();
        assert!(registry.get("start").is_some());
        assert!(registry.get("status").is_some());
        assert!(registry.get("stop").is_some());
        assert!(registry.get("help").is_some());
        assert!(registry.get("model").is_some());
        assert!(registry.get("vault").is_some());
        assert!(registry.get("nonexistent").is_none());
    }

    #[test]
    fn all_definitions_sorted() {
        let registry = build_default_registry();
        let defs = registry.all_definitions();
        assert!(defs.len() >= 6);
        for i in 1..defs.len() {
            assert!(defs[i - 1].command <= defs[i].command);
        }
    }

    // --- StartHandler tests ---

    #[tokio::test]
    async fn start_handler_generates_pairing_code() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, None);

        let handler = StartHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("pairing code"));
        assert!(!handler.requires_binding());
    }

    // --- StatusHandler tests ---

    #[tokio::test]
    async fn status_handler_shows_agent_status() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = StatusHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("agent-1"));
        assert!(result.contains("idle"));
    }

    #[tokio::test]
    async fn status_handler_unpaired() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, None);

        let handler = StatusHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("not paired"));
    }

    // --- StopHandler tests ---

    #[tokio::test]
    async fn stop_handler_stops_agent() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = StopHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert_eq!(result, "Agent stopped.");
    }

    // --- HelpHandler tests ---

    #[tokio::test]
    async fn help_handler_lists_all_commands() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, None);

        let registry = build_default_registry();
        let handler = registry.get("help").unwrap();
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("/start"));
        assert!(result.contains("/status"));
        assert!(result.contains("/stop"));
        assert!(result.contains("/help"));
        assert!(result.contains("/model"));
        assert!(result.contains("/vault"));
        assert!(!handler.requires_binding());
    }

    // --- ModelHandler tests ---

    fn setup_agent_yaml(moxxy_home: &std::path::Path) {
        let agent_dir = moxxy_home.join("agents").join("agent-1");
        std::fs::create_dir_all(&agent_dir).unwrap();
        let config = moxxy_types::AgentConfig {
            provider: "p1".into(),
            model: "gpt-4".into(),
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            policy_profile: None,
            core_mount: None,
        };
        config.save(&agent_dir.join("agent.yaml")).unwrap();
    }

    #[tokio::test]
    async fn model_get_shows_current_model() {
        let tmp = tempfile::tempdir().unwrap();
        setup_agent_yaml(tmp.path());
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = CommandContext {
            db: &db, vault_backend: &vault, run_starter: &run_starter,
            pairing_service: &pairing, agent_id: Some("agent-1".into()),
            channel_id: "ch1", external_chat_id: "12345", moxxy_home: tmp.path(),
        };

        let handler = ModelHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("p1"));
        assert!(result.contains("gpt-4"));
        assert!(result.contains("0.7"));
    }

    #[tokio::test]
    async fn model_get_explicit() {
        let tmp = tempfile::tempdir().unwrap();
        setup_agent_yaml(tmp.path());
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = CommandContext {
            db: &db, vault_backend: &vault, run_starter: &run_starter,
            pairing_service: &pairing, agent_id: Some("agent-1".into()),
            channel_id: "ch1", external_chat_id: "12345", moxxy_home: tmp.path(),
        };

        let handler = ModelHandler;
        let result = handler.execute(&ctx, "get").await.unwrap();
        assert!(result.contains("p1"));
        assert!(result.contains("gpt-4"));
    }

    #[tokio::test]
    async fn model_list_shows_providers() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = ModelHandler;
        let result = handler.execute(&ctx, "list").await.unwrap();
        assert!(result.contains("p1"));
    }

    #[tokio::test]
    async fn model_set_updates_config() {
        let tmp = tempfile::tempdir().unwrap();
        let moxxy_home = tmp.path();

        // Create agent directory + YAML
        let agent_dir = moxxy_home.join("agents").join("agent-1");
        std::fs::create_dir_all(&agent_dir).unwrap();
        let config = moxxy_types::AgentConfig {
            provider: "old-provider".into(),
            model: "old-model".into(),
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            policy_profile: None,
            core_mount: None,
        };
        config.save(&agent_dir.join("agent.yaml")).unwrap();

        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = CommandContext {
            db: &db,
            vault_backend: &vault,
            run_starter: &run_starter,
            pairing_service: &pairing,
            agent_id: Some("agent-1".into()),
            channel_id: "ch1",
            external_chat_id: "12345",
            moxxy_home,
        };

        let handler = ModelHandler;
        let result = handler.execute(&ctx, "set p1 gpt-3.5").await.unwrap();
        assert!(result.contains("Model updated"));
        assert!(result.contains("gpt-3.5"));

        // Verify in YAML
        let updated = moxxy_types::AgentConfig::load(&agent_dir.join("agent.yaml")).unwrap();
        assert_eq!(updated.model, "gpt-3.5");
        assert_eq!(updated.provider, "p1");
        assert!((updated.temperature - 0.7).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn model_set_rejects_unknown_provider() {
        let tmp = tempfile::tempdir().unwrap();
        setup_agent_yaml(tmp.path());
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = CommandContext {
            db: &db, vault_backend: &vault, run_starter: &run_starter,
            pairing_service: &pairing, agent_id: Some("agent-1".into()),
            channel_id: "ch1", external_chat_id: "12345", moxxy_home: tmp.path(),
        };

        let handler = ModelHandler;
        let result = handler
            .execute(&ctx, "set unknown-provider model-x")
            .await
            .unwrap();
        assert!(result.contains("not found"));
    }

    // --- VaultHandler tests ---

    #[tokio::test]
    async fn vault_set_and_has() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = VaultHandler;

        let result = handler
            .execute(&ctx, "set api-key sk-secret-123")
            .await
            .unwrap();
        assert!(result.contains("stored"));

        let result = handler.execute(&ctx, "has api-key").await.unwrap();
        assert!(result.contains("exists"));
    }

    #[tokio::test]
    async fn vault_set_and_list() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = VaultHandler;

        handler.execute(&ctx, "set my-key my-value").await.unwrap();
        handler
            .execute(&ctx, "set other-key other-value")
            .await
            .unwrap();

        let result = handler.execute(&ctx, "list").await.unwrap();
        assert!(result.contains("my-key"));
        assert!(result.contains("other-key"));
        assert!(result.contains("2"));
    }

    #[tokio::test]
    async fn vault_remove() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = VaultHandler;
        handler
            .execute(&ctx, "set temp-key temp-value")
            .await
            .unwrap();

        let result = handler.execute(&ctx, "remove temp-key").await.unwrap();
        assert!(result.contains("removed"));

        let result = handler.execute(&ctx, "has temp-key").await.unwrap();
        assert!(result.contains("not found"));
    }

    #[tokio::test]
    async fn vault_remove_nonexistent() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = VaultHandler;
        let result = handler.execute(&ctx, "remove nope").await.unwrap();
        assert!(result.contains("not found"));
    }

    #[tokio::test]
    async fn vault_list_empty() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = VaultHandler;
        let result = handler.execute(&ctx, "list").await.unwrap();
        assert!(result.contains("No secrets"));
    }

    #[tokio::test]
    async fn vault_requires_binding() {
        let handler = VaultHandler;
        assert!(handler.requires_binding());
    }

    #[tokio::test]
    async fn vault_set_with_multi_word_value() {
        let db = setup_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(db.clone()));
        let ctx = make_ctx(&db, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = VaultHandler;
        let result = handler
            .execute(&ctx, "set api-key sk-proj-abc def ghi")
            .await
            .unwrap();
        assert!(result.contains("stored"));

        // Verify the full value was stored
        let stored = vault.get_secret("agent:agent-1:api-key").unwrap();
        assert_eq!(stored, "sk-proj-abc def ghi");
    }

    // --- Binding enforcement (tested via requires_binding) ---

    #[test]
    fn binding_requirements_correct() {
        assert!(!StartHandler.requires_binding());
        assert!(StatusHandler.requires_binding());
        assert!(StopHandler.requires_binding());
        assert!(ModelHandler.requires_binding());
        assert!(VaultHandler.requires_binding());
    }
}
