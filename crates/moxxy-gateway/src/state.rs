use moxxy_channel::ChannelBridge;
use moxxy_core::{EventBus, HeartbeatScheduler, RedactionEngine};
use moxxy_storage::{Database, EventAuditRow};
use moxxy_types::{AuthMode, EventEnvelope, EventType};
use moxxy_vault::{SecretBackend, SqliteBackend};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::run_service::RunService;

/// Registers the sqlite-vec extension globally. Must be called before opening any connection.
#[allow(clippy::missing_transmute_annotations)]
pub fn register_sqlite_vec() {
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }
}

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub event_bus: EventBus,
    pub run_service: Arc<RunService>,
    pub vault_backend: Arc<dyn SecretBackend + Send + Sync>,
    pub channel_bridge: Mutex<Option<Arc<ChannelBridge>>>,
    pub auth_mode: AuthMode,
    pub moxxy_home: PathBuf,
}

impl AppState {
    pub fn new(
        conn: Connection,
        vault_key: [u8; 32],
        auth_mode: AuthMode,
        moxxy_home: PathBuf,
    ) -> Self {
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

        // Run heartbeat cron migration (ALTER TABLE is not idempotent, check first)
        let has_cron: bool = conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='heartbeats'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, String>(0)))
            .map(|sql| sql.contains("cron_expr"))
            .unwrap_or(false);
        if !has_cron {
            let sql6 = include_str!("../../../migrations/0006_heartbeat_cron.sql");
            conn.execute_batch(sql6).expect("Migration 0006 failed");
        }

        // Run memory vec0 migration (ALTER TABLE is not idempotent, check first)
        let has_status: bool = conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_index'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, String>(0)))
            .map(|sql| sql.contains("status"))
            .unwrap_or(false);
        if !has_status {
            let sql5 = include_str!("../../../migrations/0005_memory_vec0.sql");
            conn.execute_batch(sql5).expect("Migration 0005 failed");
        }

        // Run vault secrets migration
        let sql7 = include_str!("../../../migrations/0007_vault_secrets.sql");
        conn.execute_batch(sql7).expect("Migration 0007 failed");

        // Run agent name/persona migration (ALTER TABLE is not idempotent, check first)
        let has_agent_name: bool = conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, String>(0)))
            .map(|sql| sql.contains("name"))
            .unwrap_or(false);
        if !has_agent_name {
            let sql8 = include_str!("../../../migrations/0008_agent_name_persona.sql");
            conn.execute_batch(sql8).expect("Migration 0008 failed");
        }

        // Run agent allowlists migration
        let sql9 = include_str!("../../../migrations/0009_agent_allowlists.sql");
        conn.execute_batch(sql9).expect("Migration 0009 failed");

        // Create vec0 virtual table (requires sqlite-vec extension)
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec0 USING vec0(memory_id TEXT, embedding float[384])",
        )
        .expect("Failed to create memory_vec0");

        // Open a second connection for the vault backend to avoid deadlocks
        // with the main Arc<Mutex<Database>>
        let db_path = conn.path().map(|p| p.to_string()).unwrap_or_default();
        let vault_conn = if db_path.is_empty() {
            // In-memory DB (tests) — use the same connection approach
            Connection::open_in_memory().expect("Failed to open in-memory vault connection")
        } else {
            Connection::open(&db_path).expect("Failed to open vault connection")
        };
        // Run vault migration on the second connection too
        vault_conn
            .execute_batch(sql7)
            .expect("Vault migration on second connection failed");

        let db = Arc::new(Mutex::new(Database::new(conn)));
        let event_bus = EventBus::new(1024);

        let vault_backend: Arc<dyn SecretBackend + Send + Sync> = Arc::new(SqliteBackend::new(
            Arc::new(Mutex::new(vault_conn)),
            vault_key,
        ));
        let run_service = Arc::new(RunService::new(
            db.clone(),
            event_bus.clone(),
            vault_backend.clone(),
            moxxy_home.clone(),
        ));

        Self {
            db,
            event_bus,
            run_service,
            vault_backend,
            channel_bridge: Mutex::new(None),
            auth_mode,
            moxxy_home,
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
        let event_bus = self.event_bus.clone();
        let run_tokens = self.run_service.run_tokens.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;

                let running_agents = {
                    let Ok(db) = db.lock() else { continue };
                    match db.agents().find_by_status("running") {
                        Ok(agents) => agents,
                        Err(_) => continue,
                    }
                };

                let now_ms = chrono::Utc::now().timestamp_millis();
                let stale_threshold_ms = 5 * 60 * 1000; // 5 minutes

                for agent in &running_agents {
                    let has_token = run_tokens
                        .lock()
                        .ok()
                        .is_some_and(|t| t.contains_key(&agent.id));

                    if !has_token {
                        // Agent stuck from crash — no active executor
                        tracing::warn!(
                            agent_id = %agent.id,
                            "Health check: agent running with no cancel token — marking as error"
                        );
                        if let Ok(db) = db.lock() {
                            let _ = db.agents().update_status(&agent.id, "error");
                        }
                        event_bus.emit(EventEnvelope::new(
                            agent.id.clone(),
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
                    }

                    // Has token — check for event staleness
                    let latest_ts = {
                        let Ok(db) = db.lock() else { continue };
                        db.events()
                            .find_latest_ts_for_agent(&agent.id)
                            .unwrap_or(None)
                    };

                    if let Some(ts) = latest_ts
                        && now_ms - ts > stale_threshold_ms
                    {
                        tracing::warn!(
                            agent_id = %agent.id,
                            last_event_ms = ts,
                            "Health check: agent has no events in 5 minutes — cancelling"
                        );
                        // Cancel the run
                        if let Ok(tokens) = run_tokens.lock()
                            && let Some(token) = tokens.get(&agent.id)
                        {
                            token.cancel();
                        }
                        if let Ok(db) = db.lock() {
                            let _ = db.agents().update_status(&agent.id, "error");
                        }
                        event_bus.emit(EventEnvelope::new(
                            agent.id.clone(),
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
    pub fn spawn_heartbeat_loop(&self) {
        let db = self.db.clone();
        let event_bus = self.event_bus.clone();
        let run_service = self.run_service.clone();

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

                    // Dispatch based on action_type
                    match rule.action_type.as_str() {
                        "execute_skill" => {
                            let task = rule
                                .action_payload
                                .as_deref()
                                .unwrap_or("run scheduled skill");
                            match run_service.do_start_run(&rule.agent_id, task).await {
                                Ok(run_id) => {
                                    event_bus.emit(EventEnvelope::new(
                                        rule.agent_id.clone(),
                                        Some(run_id.clone()),
                                        None,
                                        0,
                                        EventType::HeartbeatCompleted,
                                        serde_json::json!({
                                            "heartbeat_id": rule.id,
                                            "run_id": run_id,
                                            "message": "Scheduled run started",
                                        }),
                                    ));
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        "Heartbeat {} failed to start run for agent {}: {}",
                                        rule.id,
                                        rule.agent_id,
                                        e
                                    );
                                    event_bus.emit(EventEnvelope::new(
                                        rule.agent_id.clone(),
                                        None,
                                        None,
                                        0,
                                        EventType::HeartbeatFailed,
                                        serde_json::json!({
                                            "heartbeat_id": rule.id,
                                            "error": e,
                                        }),
                                    ));
                                }
                            }
                        }
                        "notify_cli" => {
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
                        }
                        "notify_webhook" => {
                            if let Some(url) = rule.action_payload.as_deref() {
                                let agent_id = rule.agent_id.clone();
                                let heartbeat_id = rule.id.clone();
                                let url = url.to_string();
                                let eb = event_bus.clone();
                                tokio::spawn(async move {
                                    let payload = serde_json::json!({
                                        "heartbeat_id": heartbeat_id,
                                        "agent_id": agent_id,
                                        "timestamp": chrono::Utc::now().to_rfc3339(),
                                    });
                                    let client = reqwest::Client::new();
                                    let result = client
                                        .post(&url)
                                        .json(&payload)
                                        .timeout(std::time::Duration::from_secs(10))
                                        .send()
                                        .await;
                                    match result {
                                        Ok(resp) => {
                                            let status_code = resp.status().as_u16();
                                            eb.emit(EventEnvelope::new(
                                                agent_id,
                                                None,
                                                None,
                                                0,
                                                EventType::HeartbeatCompleted,
                                                serde_json::json!({
                                                    "heartbeat_id": heartbeat_id,
                                                    "webhook_url": url,
                                                    "status": status_code,
                                                }),
                                            ));
                                        }
                                        Err(e) => {
                                            let err_msg = e.to_string();
                                            tracing::warn!(
                                                "Heartbeat {} webhook POST to {} failed: {}",
                                                heartbeat_id,
                                                url,
                                                err_msg
                                            );
                                            eb.emit(EventEnvelope::new(
                                                agent_id,
                                                None,
                                                None,
                                                0,
                                                EventType::HeartbeatFailed,
                                                serde_json::json!({
                                                    "heartbeat_id": heartbeat_id,
                                                    "error": err_msg,
                                                }),
                                            ));
                                        }
                                    }
                                });
                            } else {
                                tracing::warn!(
                                    "Heartbeat {} notify_webhook has no URL in action_payload",
                                    rule.id
                                );
                            }
                        }
                        "memory_compact" => {
                            let agent_id = rule.agent_id.clone();
                            let heartbeat_id = rule.id.clone();
                            let db_ref = db.clone();
                            let eb = event_bus.clone();
                            eb.emit(EventEnvelope::new(
                                agent_id.clone(),
                                None,
                                None,
                                0,
                                EventType::MemoryCompactStarted,
                                serde_json::json!({
                                    "heartbeat_id": heartbeat_id,
                                    "message": "Memory compaction triggered by heartbeat",
                                }),
                            ));
                            tokio::spawn(async move {
                                let workspace_root = {
                                    let db = db_ref.lock().unwrap();
                                    db.agents()
                                        .find_by_id(&agent_id)
                                        .ok()
                                        .flatten()
                                        .map(|a| a.workspace_root)
                                };
                                if let Some(root) = workspace_root {
                                    let workspace = std::path::PathBuf::from(&root);
                                    let memory_dir = workspace.join(".moxxy").join("memory");
                                    let archive_dir = workspace.join(".moxxy").join("archive");
                                    let records = {
                                        let db = db_ref.lock().unwrap();
                                        db.memory().find_by_agent(&agent_id).unwrap_or_default()
                                    };
                                    let eligible: Vec<moxxy_core::EligibleEntry> = records
                                        .iter()
                                        .filter(|r| r.status == "active")
                                        .map(|r| moxxy_core::EligibleEntry {
                                            id: r.id.clone(),
                                            agent_id: r.agent_id.clone(),
                                            markdown_path: r.markdown_path.clone(),
                                            tags_json: r.tags_json.clone(),
                                            created_at: r.created_at.clone(),
                                            status: r.status.clone(),
                                        })
                                        .collect();
                                    let compactor = moxxy_core::MemoryCompactor::new(
                                        moxxy_core::CompactionConfig::default(),
                                    );
                                    let groups =
                                        compactor.find_eligible(&eligible, chrono::Utc::now());
                                    let mut compacted = 0usize;
                                    for (_tag, entries) in &groups {
                                        if let Ok(result) = compactor
                                            .compact_group(
                                                entries,
                                                _tag,
                                                &memory_dir,
                                                &archive_dir,
                                                None,
                                            )
                                            .await
                                        {
                                            compacted += result.entries_compacted;
                                            let db = db_ref.lock().unwrap();
                                            for entry in entries {
                                                let _ = db
                                                    .memory()
                                                    .update_status(&entry.id, "archived");
                                            }
                                        }
                                    }
                                    eb.emit(EventEnvelope::new(
                                        agent_id,
                                        None,
                                        None,
                                        0,
                                        EventType::MemoryCompactCompleted,
                                        serde_json::json!({
                                            "heartbeat_id": heartbeat_id,
                                            "entries_compacted": compacted,
                                        }),
                                    ));
                                }
                            });
                        }
                        _ => {
                            tracing::warn!("Unknown heartbeat action_type: {}", rule.action_type);
                        }
                    }

                    // Advance next_run_at (prefer cron if set, else interval)
                    let new_next_run = if let Some(cron_expr) = &rule.cron_expr {
                        HeartbeatScheduler::compute_next_cron_run(cron_expr, &rule.timezone, now)
                            .unwrap_or_else(|_| {
                                HeartbeatScheduler::advance_next_run(
                                    &rule.next_run_at,
                                    rule.interval_minutes,
                                    now,
                                )
                            })
                    } else {
                        HeartbeatScheduler::advance_next_run(
                            &rule.next_run_at,
                            rule.interval_minutes,
                            now,
                        )
                    };
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
