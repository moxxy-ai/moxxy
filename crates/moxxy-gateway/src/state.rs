use moxxy_channel::ChannelBridge;
use moxxy_core::{
    AgentRegistry, AgentStore, EventBus, HeartbeatActionContext, HeartbeatActionRegistry,
    HeartbeatScheduler, LoadedWebhook, RedactionEngine, WebhookLoader,
};
use moxxy_runtime::WebhookListenChannels;
use moxxy_storage::{Database, EventAuditRow};
use moxxy_types::{AgentRuntime, AgentStatus, AgentType, AuthMode, EventEnvelope, EventType};
use moxxy_vault::{SecretBackend, SqliteBackend};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use crate::heartbeat_actions::{
    ExecuteSkillAction, MemoryCompactAction, NotifyChannelAction, NotifyCliAction,
    NotifyWebhookAction,
};
use crate::run_service::{self, RunService};

/// Registers the sqlite-vec extension globally. Must be called before opening any connection.
#[allow(clippy::missing_transmute_annotations)]
pub fn register_sqlite_vec() {
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }
}

/// Tracks pairing brute-force attempts: channel_id → (count, window_start).
pub type PairingAttempts = Arc<Mutex<HashMap<String, (u32, chrono::DateTime<chrono::Utc>)>>>;

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub registry: AgentRegistry,
    pub event_bus: EventBus,
    pub run_service: Arc<RunService>,
    pub vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    pub channel_bridge: Arc<Mutex<Option<Arc<ChannelBridge>>>>,
    pub auth_mode: AuthMode,
    pub moxxy_home: PathBuf,
    pub base_url: String,
    /// In-memory index of webhook configs, keyed by token.
    pub webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    pub webhook_listen_channels: WebhookListenChannels,
    pub pairing_attempts: PairingAttempts,
    /// Drain receiver - must be consumed by `spawn_drain_loop` after the runtime starts.
    pub drain_rx: Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<String>>>,
}

impl AppState {
    pub fn new(
        conn: Connection,
        vault_key: [u8; 32],
        auth_mode: AuthMode,
        moxxy_home: PathBuf,
        base_url: String,
    ) -> Self {
        // Run PRAGMAs via query (not execute_batch, which chokes on result-returning PRAGMAs)
        let _: String = conn
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .unwrap_or_else(|_| "delete".to_string());
        conn.execute_batch("PRAGMA foreign_keys = ON")
            .expect("Failed to enable foreign keys");

        // Run DDL (skip PRAGMA lines = already applied above)
        let sql = include_str!("../../../migrations/0001_init.sql");
        let ddl: String = sql
            .lines()
            .filter(|l| !l.trim_start().starts_with("PRAGMA"))
            .collect::<Vec<_>>()
            .join("\n");
        conn.execute_batch(&ddl).expect("Migration failed");

        // Create vec0 virtual table (requires sqlite-vec extension)
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec0 USING vec0(memory_id TEXT, embedding float[384])",
        )
        .expect("Failed to create memory_vec0");

        // Open a second connection for the vault backend to avoid deadlocks
        // with the main Arc<Mutex<Database>>
        let db_path = conn.path().map(|p| p.to_string()).unwrap_or_default();
        let vault_conn = if db_path.is_empty() {
            // In-memory DB (tests) = use the same connection approach
            Connection::open_in_memory().expect("Failed to open in-memory vault connection")
        } else {
            Connection::open(&db_path).expect("Failed to open vault connection")
        };
        // Run vault_secrets DDL on the second connection too
        vault_conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS vault_secrets (
                    backend_key TEXT PRIMARY KEY,
                    secret_value TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )",
            )
            .expect("Vault migration on second connection failed");

        let db = Arc::new(Mutex::new(Database::new(conn)));
        let event_bus = EventBus::new(1024);

        // Build in-memory agent registry from YAML files on disk
        let registry = AgentRegistry::new();
        for name in AgentStore::list(&moxxy_home) {
            if let Ok(config) = AgentStore::load(&moxxy_home, &name) {
                let persona = AgentStore::load_persona(&moxxy_home, &name);
                let runtime = AgentRuntime {
                    name: name.clone(),
                    agent_type: AgentType::Agent,
                    config,
                    status: AgentStatus::Idle,
                    parent_name: None,
                    hive_role: None,
                    depth: 0,
                    spawned_count: 0,
                    persona,
                    last_result: None,
                };
                if let Err(e) = registry.register(runtime) {
                    tracing::warn!(agent = %name, error = %e, "Failed to register agent from YAML");
                }
            }
        }

        // Seed built-in templates (idempotent)
        moxxy_core::TemplateStore::seed_builtins(&moxxy_home);

        // Build in-memory webhook index from filesystem YAML files
        let all_webhooks = WebhookLoader::load_all(&moxxy_home);
        let mut wh_index = HashMap::new();
        for wh in all_webhooks {
            wh_index.insert(wh.doc.token.clone(), wh);
        }
        let webhook_index = Arc::new(RwLock::new(wh_index));

        let vault_backend: Arc<dyn SecretBackend + Send + Sync> = Arc::new(SqliteBackend::new(
            Arc::new(Mutex::new(vault_conn)),
            vault_key,
        ));
        let embedding_svc: Arc<dyn moxxy_core::EmbeddingService> =
            Arc::new(moxxy_core::MockEmbeddingService::new());

        // Build the agent kind registry with default kinds
        let kind_registry = {
            use moxxy_runtime::agent_kind::{
                AgentKindRegistry, EphemeralAgentKind, HiveWorkerAgentKind, StandardAgentKind,
            };
            let registry = AgentKindRegistry::new();
            registry
                .register(Box::new(StandardAgentKind))
                .expect("register standard kind");
            registry
                .register(Box::new(EphemeralAgentKind))
                .expect("register ephemeral kind");
            registry
                .register(Box::new(HiveWorkerAgentKind))
                .expect("register hive_worker kind");
            Arc::new(registry)
        };

        let (run_service_inner, drain_rx) = RunService::new_with_drain(
            db.clone(),
            registry.clone(),
            event_bus.clone(),
            vault_backend.clone(),
            moxxy_home.clone(),
            base_url.clone(),
            embedding_svc,
            kind_registry,
            webhook_index.clone(),
        );
        let run_service = Arc::new(run_service_inner);

        let webhook_listen_channels = run_service.webhook_listen_channels.clone();

        let channel_bridge: Arc<Mutex<Option<Arc<ChannelBridge>>>> = Arc::new(Mutex::new(None));

        Self {
            db,
            registry,
            event_bus,
            run_service,
            vault_backend,
            channel_bridge,
            auth_mode,
            moxxy_home,
            base_url,
            webhook_index,
            webhook_listen_channels,
            pairing_attempts: Arc::new(Mutex::new(HashMap::new())) as PairingAttempts,
            drain_rx: Mutex::new(Some(drain_rx)),
        }
    }

    /// Spawn the drain loop that processes queued runs when agents become idle.
    /// Must be called after the Tokio runtime is available.
    pub fn spawn_drain_loop(self: &Arc<Self>) {
        let drain_rx = self.drain_rx.lock().ok().and_then(|mut g| g.take());
        if let Some(rx) = drain_rx {
            run_service::spawn_drain_loop(self.run_service.clone(), rx);
        }
    }

    /// Spawns a background task that persists every EventBus event to the event_audit table,
    /// applying RedactionEngine before storage.
    pub fn spawn_event_persistence(&self) {
        let mut rx = self.event_bus.subscribe();
        let db = self.db.clone();
        let vault_backend = self.vault_backend.clone();

        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(envelope) => {
                        // Load secret values for the agent to redact from event payloads
                        let secrets: Vec<String> = {
                            let db_guard = db.lock().ok();
                            if let Some(ref db_ref) = db_guard {
                                let grants = db_ref
                                    .vault_grants()
                                    .find_by_agent(&envelope.agent_id)
                                    .unwrap_or_default();
                                let active_grants: Vec<_> =
                                    grants.iter().filter(|g| g.revoked_at.is_none()).collect();
                                active_grants
                                    .iter()
                                    .filter_map(|g| {
                                        db_ref
                                            .vault_refs()
                                            .find_by_id(&g.secret_ref_id)
                                            .ok()
                                            .flatten()
                                    })
                                    .filter_map(|r| vault_backend.get_secret(&r.backend_key).ok())
                                    .collect()
                            } else {
                                vec![]
                            }
                        };
                        let (redacted_payload, redacted_paths) =
                            RedactionEngine::redact(envelope.payload.clone(), &secrets);

                        let event_type_str =
                            serde_json::to_string(&envelope.event_type).unwrap_or_default();
                        // Strip surrounding quotes from serialized enum
                        let event_type_str = event_type_str.trim_matches('"').to_string();

                        let row = EventAuditRow {
                            event_id: envelope.event_id.clone(),
                            ts: envelope.ts,
                            agent_id: Some(envelope.agent_id.clone()),
                            run_id: envelope.run_id.clone(),
                            parent_run_id: envelope.parent_run_id.clone(),
                            sequence: envelope.sequence as i64,
                            event_type: event_type_str,
                            payload_json: Some(
                                serde_json::to_string(&redacted_payload).unwrap_or_default(),
                            ),
                            redactions_json: if redacted_paths.is_empty() {
                                None
                            } else {
                                Some(serde_json::to_string(&redacted_paths).unwrap_or_default())
                            },
                            sensitive: !redacted_paths.is_empty(),
                            created_at: chrono::Utc::now().to_rfc3339(),
                        };

                        if let Ok(db) = db.lock()
                            && let Err(e) = db.events().insert(&row)
                        {
                            tracing::warn!("Failed to persist event {}: {}", row.event_id, e);
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("Event persistence subscriber lagged by {} events", n);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    /// Spawns a background task that checks for stuck agents every 60 seconds.
    /// An agent is considered stuck if:
    /// - It is in "running" status but has no active cancel token (crashed)
    /// - It is in "running" status with a token but no event in 5 minutes
    pub fn spawn_health_check_loop(&self) {
        let db = self.db.clone();
        let registry = self.registry.clone();
        let event_bus = self.event_bus.clone();
        let run_tokens = self.run_service.run_tokens.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;

                let running_agents = registry.find_by_status(AgentStatus::Running);

                let now_ms = chrono::Utc::now().timestamp_millis();
                let stale_threshold_ms = 5 * 60 * 1000; // 5 minutes

                for agent in &running_agents {
                    let run_handle = run_tokens.lock().ok().and_then(|t| {
                        t.get(&agent.name)
                            .map(|h| (h.token.clone(), h.started_at_ms))
                    });

                    let Some((token, started_at_ms)) = run_handle else {
                        // Agent stuck from crash = no active executor
                        tracing::warn!(
                            agent_name = %agent.name,
                            "Health check: agent running with no cancel token = marking as error"
                        );
                        registry.update_status(&agent.name, AgentStatus::Error);
                        event_bus.emit(EventEnvelope::new(
                            agent.name.clone(),
                            None,
                            None,
                            0,
                            EventType::AgentStuck,
                            serde_json::json!({
                                "reason": "no_cancel_token",
                                "message": "Agent running with no active executor"
                            }),
                        ));
                        continue;
                    };

                    // Skip staleness check if the run hasn't been active
                    // long enough - it can't be stale yet and old events from
                    // a previous run would cause a false positive.
                    if now_ms - started_at_ms < stale_threshold_ms {
                        continue;
                    }

                    // Has token = check for event staleness
                    let latest_ts = {
                        let Ok(db) = db.lock() else { continue };
                        db.events()
                            .find_latest_ts_for_agent(&agent.name)
                            .unwrap_or(None)
                    };

                    if let Some(ts) = latest_ts
                        && now_ms - ts > stale_threshold_ms
                    {
                        tracing::warn!(
                            agent_name = %agent.name,
                            last_event_ms = ts,
                            "Health check: agent has no events in 5 minutes = cancelling"
                        );
                        token.cancel();
                        registry.update_status(&agent.name, AgentStatus::Error);
                        event_bus.emit(EventEnvelope::new(
                            agent.name.clone(),
                            None,
                            None,
                            0,
                            EventType::AgentStuck,
                            serde_json::json!({
                                "reason": "stale_events",
                                "last_event_ts": ts,
                                "message": "No events in 5 minutes"
                            }),
                        ));
                    }
                }
            }
        });
    }

    /// Spawns a background task that checks for due heartbeat rules every 30 seconds
    /// and dispatches the appropriate actions.
    ///
    /// Heartbeats are stored as per-agent markdown files on disk
    /// (`~/.moxxy/agents/{name}/heartbeat.md`).
    pub fn spawn_heartbeat_loop(&self) {
        let action_registry = self.build_heartbeat_action_registry();
        let event_bus = self.event_bus.clone();
        let moxxy_home = self.moxxy_home.clone();
        let agent_registry = self.registry.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            tracing::info!("Heartbeat loop started (30s tick)");
            loop {
                interval.tick().await;
                let now = chrono::Utc::now();

                // Collect due heartbeat entries from all registered agents' files
                let agent_names: Vec<String> = agent_registry
                    .list()
                    .iter()
                    .map(|a| a.name.clone())
                    .collect();

                // Collect (agent_id, entry) pairs for due entries
                let mut due_entries: Vec<(String, moxxy_core::HeartbeatEntry)> = Vec::new();
                let mut total_entries = 0usize;
                for agent_name in &agent_names {
                    let hb_path = moxxy_core::heartbeat_path(&moxxy_home, agent_name);
                    let file = match moxxy_core::read_heartbeat_file(&hb_path) {
                        Ok(f) => f,
                        Err(e) => {
                            tracing::debug!(agent=%agent_name, error=%e, "Failed to read heartbeat file");
                            continue;
                        }
                    };
                    for entry in &file.entries {
                        if !entry.enabled {
                            continue;
                        }
                        total_entries += 1;
                        // Parse next_run_at as DateTime for reliable comparison
                        let is_due = entry
                            .next_run_at
                            .parse::<chrono::DateTime<chrono::Utc>>()
                            .map(|next| next <= now)
                            .unwrap_or(false);
                        if is_due {
                            due_entries.push((agent_name.clone(), entry.clone()));
                        } else {
                            tracing::debug!(
                                agent=%agent_name, heartbeat_id=%entry.id,
                                next_run_at=%entry.next_run_at,
                                "Heartbeat not yet due"
                            );
                        }
                    }
                }

                if total_entries > 0 || !due_entries.is_empty() {
                    tracing::info!(
                        agents = agent_names.len(),
                        total_entries,
                        due = due_entries.len(),
                        "Heartbeat tick"
                    );
                }

                for (agent_id, entry) in &due_entries {
                    tracing::info!(
                        agent=%agent_id, heartbeat_id=%entry.id,
                        action_type=%entry.action_type,
                        next_run_at=%entry.next_run_at,
                        "Firing heartbeat"
                    );
                    // Emit heartbeat.triggered event
                    event_bus.emit(EventEnvelope::new(
                        agent_id.clone(),
                        None,
                        None,
                        0,
                        EventType::HeartbeatTriggered,
                        serde_json::json!({
                            "heartbeat_id": entry.id,
                            "action_type": entry.action_type,
                        }),
                    ));

                    // Dispatch via the action registry
                    let ctx = HeartbeatActionContext {
                        agent_id: agent_id.clone(),
                        entry: entry.clone(),
                    };
                    match action_registry.get(&entry.action_type) {
                        Some(action) => match action.execute(&ctx).await {
                            Ok(result) => {
                                event_bus.emit(EventEnvelope::new(
                                    agent_id.clone(),
                                    None,
                                    None,
                                    0,
                                    EventType::HeartbeatCompleted,
                                    result.payload,
                                ));
                            }
                            Err(e) => {
                                tracing::warn!("{}", e);
                                event_bus.emit(EventEnvelope::new(
                                    agent_id.clone(),
                                    None,
                                    None,
                                    0,
                                    EventType::HeartbeatFailed,
                                    serde_json::json!({
                                        "heartbeat_id": entry.id,
                                        "error": e.message,
                                    }),
                                ));
                            }
                        },
                        None => {
                            tracing::warn!("Unknown heartbeat action_type: {}", entry.action_type);
                        }
                    }

                    // Advance next_run_at in the heartbeat file
                    let interval_minutes = entry.interval_minutes.unwrap_or(1);
                    let new_next_run = if let Some(ref cron_expr) = entry.cron_expr {
                        HeartbeatScheduler::compute_next_cron_run(cron_expr, &entry.timezone, now)
                            .unwrap_or_else(|_| {
                                HeartbeatScheduler::advance_next_run(
                                    &entry.next_run_at,
                                    interval_minutes,
                                    now,
                                )
                            })
                    } else {
                        HeartbeatScheduler::advance_next_run(
                            &entry.next_run_at,
                            interval_minutes,
                            now,
                        )
                    };
                    let hb_path = moxxy_core::heartbeat_path(&moxxy_home, agent_id);
                    let entry_id = entry.id.clone();
                    tracing::info!(
                        agent=%agent_id, heartbeat_id=%entry_id,
                        new_next_run=%new_next_run,
                        "Advanced heartbeat next_run_at"
                    );
                    if let Err(e) = moxxy_core::mutate_heartbeat_file(&hb_path, |f| {
                        if let Some(e) = f.entries.iter_mut().find(|e| e.id == entry_id) {
                            e.next_run_at = new_next_run.clone();
                            e.updated_at = now.to_rfc3339();
                        }
                    }) {
                        tracing::warn!(
                            agent=%agent_id, heartbeat_id=%entry.id,
                            error=%e, "Failed to update heartbeat next_run_at"
                        );
                    }
                }
            }
        });
    }

    /// Builds the heartbeat action registry with all known action types.
    fn build_heartbeat_action_registry(&self) -> HeartbeatActionRegistry {
        let mut registry = HeartbeatActionRegistry::new();
        registry.register(Box::new(ExecuteSkillAction::new(self.run_service.clone())));
        registry.register(Box::new(NotifyCliAction));
        registry.register(Box::new(NotifyChannelAction::new(
            self.channel_bridge.clone(),
        )));
        registry.register(Box::new(NotifyWebhookAction::new(self.event_bus.clone())));
        registry.register(Box::new(MemoryCompactAction::new(
            self.db.clone(),
            self.event_bus.clone(),
        )));
        registry
    }
}
