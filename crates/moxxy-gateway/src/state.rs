use moxxy_channel::ChannelBridge;
use moxxy_core::{EventBus, HeartbeatScheduler, RedactionEngine};
use moxxy_runtime::{EchoProvider, Provider};
use moxxy_storage::{Database, EventAuditRow};
use moxxy_types::{EventEnvelope, EventType};
use moxxy_vault::InMemoryBackend;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::run_service::RunService;

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub event_bus: EventBus,
    pub run_service: Arc<RunService>,
    pub vault_backend: Arc<InMemoryBackend>,
    pub channel_bridge: Mutex<Option<Arc<ChannelBridge>>>,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        // Run PRAGMAs via query (not execute_batch, which chokes on result-returning PRAGMAs)
        let _: String = conn
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .unwrap_or_else(|_| "delete".to_string());
        conn.execute_batch("PRAGMA foreign_keys = ON")
            .expect("Failed to enable foreign keys");

        // Run DDL (skip PRAGMA lines — already applied above)
        let sql = include_str!("../../../migrations/0001_init.sql");
        let ddl: String = sql
            .lines()
            .filter(|l| !l.trim_start().starts_with("PRAGMA"))
            .collect::<Vec<_>>()
            .join("\n");
        conn.execute_batch(&ddl).expect("Migration 0001 failed");

        // Run channels migration
        let sql2 = include_str!("../../../migrations/0002_channels.sql");
        conn.execute_batch(sql2).expect("Migration 0002 failed");

        // Run webhooks migration
        let sql3 = include_str!("../../../migrations/0003_webhooks.sql");
        conn.execute_batch(sql3).expect("Migration 0003 failed");

        // Run conversation log migration
        let sql4 = include_str!("../../../migrations/0004_conversation_log.sql");
        conn.execute_batch(sql4).expect("Migration 0004 failed");

        let mut providers: HashMap<String, Arc<dyn Provider>> = HashMap::new();
        providers.insert("echo".into(), Arc::new(EchoProvider::new()));

        let db = Arc::new(Mutex::new(Database::new(conn)));
        let event_bus = EventBus::new(1024);

        let vault_backend = Arc::new(InMemoryBackend::new());
        let run_service = Arc::new(RunService::new(
            db.clone(),
            event_bus.clone(),
            providers,
            vault_backend.clone(),
        ));

        Self {
            db,
            event_bus,
            run_service,
            vault_backend,
            channel_bridge: Mutex::new(None),
        }
    }

    pub fn get_provider(&self, id: &str) -> Option<Arc<dyn Provider>> {
        self.run_service.get_provider(id)
    }

    pub fn register_provider(&mut self, id: String, provider: Arc<dyn Provider>) {
        Arc::get_mut(&mut self.run_service)
            .expect("Cannot modify run_service while shared")
            .register_provider(id, provider);
    }

    /// Spawns a background task that persists every EventBus event to the event_audit table,
    /// applying RedactionEngine before storage.
    pub fn spawn_event_persistence(&self) {
        let mut rx = self.event_bus.subscribe();
        let db = self.db.clone();

        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(envelope) => {
                        // Apply redaction (secrets list empty for now; future: load from vault)
                        let secrets: Vec<String> = vec![];
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

    /// Spawns a background task that checks for due heartbeat rules every 30 seconds
    /// and emits the appropriate events.
    pub fn spawn_heartbeat_loop(&self) {
        let db = self.db.clone();
        let event_bus = self.event_bus.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                let now = chrono::Utc::now();
                let now_str = now.to_rfc3339();

                let due_rules = {
                    let Ok(db) = db.lock() else { continue };
                    match db.heartbeats().find_due_rules(&now_str) {
                        Ok(rules) => rules,
                        Err(_) => continue,
                    }
                };

                for rule in &due_rules {
                    // Emit heartbeat.triggered event
                    event_bus.emit(EventEnvelope::new(
                        rule.agent_id.clone(),
                        None,
                        None,
                        0,
                        EventType::HeartbeatTriggered,
                        serde_json::json!({
                            "heartbeat_id": rule.id,
                            "action_type": rule.action_type,
                        }),
                    ));

                    // Emit completion event
                    event_bus.emit(EventEnvelope::new(
                        rule.agent_id.clone(),
                        None,
                        None,
                        0,
                        EventType::HeartbeatCompleted,
                        serde_json::json!({
                            "heartbeat_id": rule.id,
                            "message": rule.action_payload.as_deref().unwrap_or("Heartbeat check"),
                        }),
                    ));

                    // Advance next_run_at
                    let new_next_run = HeartbeatScheduler::advance_next_run(
                        &rule.next_run_at,
                        rule.interval_minutes,
                        now,
                    );
                    let mut updated = rule.clone();
                    updated.next_run_at = new_next_run;
                    updated.updated_at = now.to_rfc3339();
                    if let Ok(db) = db.lock() {
                        let _ = db.heartbeats().update(&updated);
                    }
                }
            }
        });
    }
}
