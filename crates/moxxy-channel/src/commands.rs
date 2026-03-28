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

/// `/new` = reset session and start fresh.
pub struct NewHandler;

#[async_trait]
impl CommandHandler for NewHandler {
    fn definitions(&self) -> Vec<CommandDefinition> {
        vec![CommandDefinition {
            command: "new".into(),
            description: "Reset session and start fresh".into(),
        }]
    }

    async fn execute(&self, ctx: &CommandContext<'_>, _args: &str) -> Result<String, ChannelError> {
        let agent_id = match &ctx.agent_id {
            Some(id) => id,
            None => return Ok("This chat is not paired to an agent.".into()),
        };

        // Stop any active run
        let _ = ctx.run_starter.stop_agent(agent_id).await;

        // Clear STM file
        let stm_path = ctx
            .moxxy_home
            .join("agents")
            .join(agent_id)
            .join("memory")
            .join("stm.yaml");
        if stm_path.exists() {
            let _ = std::fs::remove_file(&stm_path);
        }

        // Clear conversation history
        if let Ok(db) = ctx.db.lock() {
            let _ = db.conversations().delete_all_by_agent(agent_id);
        }

        Ok("Session reset. Starting fresh.".into())
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
        match moxxy_core::AgentStore::load(ctx.moxxy_home, agent_id) {
            Ok(config) => Ok(format!(
                "Provider: {}\nModel: {}\nTemperature: {}",
                config.provider, config.model, config.temperature
            )),
            Err(e) => Ok(format!("Could not load agent config: {}", e)),
        }
    }

    fn list_models(&self, ctx: &CommandContext<'_>) -> Result<String, ChannelError> {
        let loaded = moxxy_core::ProviderLoader::load_all(ctx.moxxy_home);

        if loaded.is_empty() {
            return Ok("No providers registered.".into());
        }

        let mut lines = vec!["Available models:".to_string()];
        for provider in &loaded {
            if provider.doc.models.is_empty() {
                lines.push(format!(
                    "  {} ({}): no models",
                    provider.doc.display_name, provider.doc.id
                ));
            } else {
                for model in &provider.doc.models {
                    lines.push(format!(
                        "  {} / {} ({})",
                        provider.doc.id, model.id, model.display_name
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
        // Validate provider exists on filesystem
        if moxxy_core::ProviderLoader::load(ctx.moxxy_home, provider_id).is_none() {
            return Ok(format!(
                "Provider '{}' not found. Use /model list to see available providers.",
                provider_id
            ));
        }

        let name = agent_id;

        let mut config = moxxy_core::AgentStore::load(ctx.moxxy_home, name)
            .map_err(|e| ChannelError::StorageError(e.to_string()))?;
        config.provider = provider_id.to_string();
        config.model = model_id.to_string();
        moxxy_core::AgentStore::save(ctx.moxxy_home, name, &config)
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
    let new = Arc::new(NewHandler);
    let model = Arc::new(ModelHandler);
    let vault = Arc::new(VaultHandler);

    registry.register(start);
    registry.register(status);
    registry.register(stop);
    registry.register(new);
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

    /// Test context that owns a tempdir, db, and all required refs.
    struct TestEnv {
        _tmp: tempfile::TempDir,
        moxxy_home: std::path::PathBuf,
        db: Arc<Mutex<Database>>,
    }

    fn setup_env() -> TestEnv {
        let tmp = tempfile::tempdir().unwrap();
        let moxxy_home = tmp.path().to_path_buf();

        // Create channel on disk
        let doc = moxxy_core::ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Test Bot".into(),
            vault_secret_ref_id: "secret-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        moxxy_core::ChannelStore::create(&moxxy_home, "ch1", &doc).unwrap();

        // Create binding on disk
        let mut bindings = moxxy_core::BindingsFile::default();
        bindings.0.insert(
            "12345".into(),
            moxxy_core::BindingEntry {
                agent_name: "agent-1".into(),
                status: "active".into(),
                created_at: "2025-01-01".into(),
            },
        );
        moxxy_core::ChannelStore::save_bindings(&moxxy_home, "ch1", &bindings).unwrap();

        // Create agent directory for config tests
        let agent_dir = moxxy_home.join("agents").join("agent-1");
        std::fs::create_dir_all(&agent_dir).unwrap();

        // DB is still needed for vault and conversations
        let conn = rusqlite::Connection::open_in_memory().expect("Failed to open in-memory db");
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();

        // Seed agent row (still needed for some legacy operations)
        conn.execute(
            "INSERT INTO agents (id, name, workspace_root, status, depth, spawned_total, created_at, updated_at)
             VALUES ('agent-1', 'agent-1', '/tmp', 'idle', 0, 0, '2025-01-01', '2025-01-01')",
            [],
        )
        .unwrap();

        let db = Arc::new(Mutex::new(Database::new(conn)));
        TestEnv { _tmp: tmp, moxxy_home, db }
    }

    fn make_ctx<'a>(
        env: &'a TestEnv,
        vault: &'a Arc<dyn SecretBackend + Send + Sync>,
        run_starter: &'a Arc<dyn RunStarter>,
        pairing: &'a Arc<PairingService>,
        agent_id: Option<String>,
    ) -> CommandContext<'a> {
        CommandContext {
            db: &env.db,
            vault_backend: vault,
            run_starter,
            pairing_service: pairing,
            agent_id,
            channel_id: "ch1",
            external_chat_id: "12345",
            moxxy_home: &env.moxxy_home,
        }
    }

    // --- Registry tests ---

    #[test]
    fn registry_dispatches_to_correct_handler() {
        let registry = build_default_registry();
        assert!(registry.get("start").is_some());
        assert!(registry.get("status").is_some());
        assert!(registry.get("stop").is_some());
        assert!(registry.get("new").is_some());
        assert!(registry.get("help").is_some());
        assert!(registry.get("model").is_some());
        assert!(registry.get("vault").is_some());
        assert!(registry.get("nonexistent").is_none());
    }

    #[test]
    fn all_definitions_sorted() {
        let registry = build_default_registry();
        let defs = registry.all_definitions();
        assert!(defs.len() >= 7);
        for i in 1..defs.len() {
            assert!(defs[i - 1].command <= defs[i].command);
        }
    }

    // --- StartHandler tests ---

    #[tokio::test]
    async fn start_handler_generates_pairing_code() {
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, None);

        let handler = StartHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("pairing code"));
        assert!(!handler.requires_binding());
    }

    // --- StatusHandler tests ---

    #[tokio::test]
    async fn status_handler_shows_agent_status() {
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = StatusHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("agent-1"));
        assert!(result.contains("idle"));
    }

    #[tokio::test]
    async fn status_handler_unpaired() {
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, None);

        let handler = StatusHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("not paired"));
    }

    // --- StopHandler tests ---

    #[tokio::test]
    async fn stop_handler_stops_agent() {
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = StopHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert_eq!(result, "Agent stopped.");
    }

    // --- NewHandler tests ---

    #[tokio::test]
    async fn new_handler_resets_session() {
        let env = setup_env();

        // Create STM file
        let stm_dir = env.moxxy_home.join("agents").join("agent-1").join("memory");
        std::fs::create_dir_all(&stm_dir).unwrap();
        std::fs::write(stm_dir.join("stm.yaml"), "test: data").unwrap();

        // Seed a conversation
        {
            let guard = env.db.lock().unwrap();
            guard
                .conn()
                .execute(
                    "INSERT INTO conversation_log (id, agent_id, run_id, sequence, role, content, created_at) VALUES ('c1', 'agent-1', 'run-1', 0, 'user', 'hello', '2025-01-01')",
                    [],
                )
                .unwrap();
        }

        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = CommandContext {
            db: &env.db,
            vault_backend: &vault,
            run_starter: &run_starter,
            pairing_service: &pairing,
            agent_id: Some("agent-1".into()),
            channel_id: "ch1",
            external_chat_id: "12345",
            moxxy_home: &env.moxxy_home,
        };

        let handler = NewHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("Session reset"));

        // STM file should be deleted
        assert!(!stm_dir.join("stm.yaml").exists());

        // Conversations should be cleared
        let guard = env.db.lock().unwrap();
        let count: i64 = guard
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM conversation_log WHERE agent_id = 'agent-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn new_handler_unpaired() {
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, None);

        let handler = NewHandler;
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("not paired"));
    }

    // --- HelpHandler tests ---

    #[tokio::test]
    async fn help_handler_lists_all_commands() {
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, None);

        let registry = build_default_registry();
        let handler = registry.get("help").unwrap();
        let result = handler.execute(&ctx, "").await.unwrap();
        assert!(result.contains("/start"));
        assert!(result.contains("/status"));
        assert!(result.contains("/stop"));
        assert!(result.contains("/new"));
        assert!(result.contains("/help"));
        assert!(result.contains("/model"));
        assert!(result.contains("/vault"));
        assert!(!handler.requires_binding());
    }

    // --- ModelHandler tests ---

    fn setup_provider_yaml(moxxy_home: &std::path::Path) {
        let doc = moxxy_core::ProviderDoc {
            id: "p1".into(),
            display_name: "Provider One".into(),
            enabled: true,
            secret_ref: None,
            api_base: None,
            models: vec![moxxy_core::ProviderModelEntry {
                id: "gpt-4".into(),
                display_name: "GPT-4".into(),
                api_base: Some("https://api.openai.com/v1".into()),
                chatgpt_account_id: None,
            }],
        };
        moxxy_core::ProviderStore::create(moxxy_home, &doc).unwrap();
    }

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
            template: None,
        };
        config.save(&agent_dir.join("agent.yaml")).unwrap();
    }

    fn make_db() -> Arc<Mutex<Database>> {
        let conn = rusqlite::Connection::open_in_memory().expect("Failed to open in-memory db");
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute(
            "INSERT INTO agents (id, name, workspace_root, status, depth, spawned_total, created_at, updated_at)
             VALUES ('agent-1', 'agent-1', '/tmp', 'idle', 0, 0, '2025-01-01', '2025-01-01')",
            [],
        ).unwrap();
        Arc::new(Mutex::new(Database::new(conn)))
    }

    #[tokio::test]
    async fn model_get_shows_current_model() {
        let tmp = tempfile::tempdir().unwrap();
        setup_agent_yaml(tmp.path());
        let db = make_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(tmp.path()));
        let ctx = CommandContext {
            db: &db,
            vault_backend: &vault,
            run_starter: &run_starter,
            pairing_service: &pairing,
            agent_id: Some("agent-1".into()),
            channel_id: "ch1",
            external_chat_id: "12345",
            moxxy_home: tmp.path(),
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
        let db = make_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(tmp.path()));
        let ctx = CommandContext {
            db: &db,
            vault_backend: &vault,
            run_starter: &run_starter,
            pairing_service: &pairing,
            agent_id: Some("agent-1".into()),
            channel_id: "ch1",
            external_chat_id: "12345",
            moxxy_home: tmp.path(),
        };

        let handler = ModelHandler;
        let result = handler.execute(&ctx, "get").await.unwrap();
        assert!(result.contains("p1"));
        assert!(result.contains("gpt-4"));
    }

    #[tokio::test]
    async fn model_list_shows_providers() {
        let tmp = tempfile::tempdir().unwrap();
        setup_provider_yaml(tmp.path());
        let db = make_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(tmp.path()));
        let ctx = CommandContext {
            db: &db,
            vault_backend: &vault,
            run_starter: &run_starter,
            pairing_service: &pairing,
            agent_id: Some("agent-1".into()),
            channel_id: "ch1",
            external_chat_id: "12345",
            moxxy_home: tmp.path(),
        };

        let handler = ModelHandler;
        let result = handler.execute(&ctx, "list").await.unwrap();
        assert!(result.contains("p1"));
    }

    #[tokio::test]
    async fn model_set_updates_config() {
        let tmp = tempfile::tempdir().unwrap();
        let moxxy_home = tmp.path();

        // Seed provider on filesystem
        setup_provider_yaml(moxxy_home);

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
            template: None,
        };
        config.save(&agent_dir.join("agent.yaml")).unwrap();

        let db = make_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(moxxy_home));
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
        let db = make_db();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(tmp.path()));
        let ctx = CommandContext {
            db: &db,
            vault_backend: &vault,
            run_starter: &run_starter,
            pairing_service: &pairing,
            agent_id: Some("agent-1".into()),
            channel_id: "ch1",
            external_chat_id: "12345",
            moxxy_home: tmp.path(),
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
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, Some("agent-1".into()));

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
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, Some("agent-1".into()));

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
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, Some("agent-1".into()));

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
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, Some("agent-1".into()));

        let handler = VaultHandler;
        let result = handler.execute(&ctx, "remove nope").await.unwrap();
        assert!(result.contains("not found"));
    }

    #[tokio::test]
    async fn vault_list_empty() {
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, Some("agent-1".into()));

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
        let env = setup_env();
        let vault: Arc<dyn SecretBackend + Send + Sync> =
            Arc::new(moxxy_vault::InMemoryBackend::new());
        let run_starter: Arc<dyn RunStarter> = Arc::new(MockRunStarter);
        let pairing = Arc::new(PairingService::new(&env.moxxy_home));
        let ctx = make_ctx(&env, &vault, &run_starter, &pairing, Some("agent-1".into()));

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
        assert!(NewHandler.requires_binding());
        assert!(ModelHandler.requires_binding());
        assert!(VaultHandler.requires_binding());
    }
}
