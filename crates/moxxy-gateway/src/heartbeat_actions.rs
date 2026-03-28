use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use moxxy_channel::{ChannelBridge, ChannelSender};
use moxxy_core::{
    CompactionConfig, EligibleEntry, EventBus, HeartbeatAction, HeartbeatActionContext,
    HeartbeatActionError, HeartbeatActionResult, MemoryCompactor,
};
use moxxy_storage::Database;
use moxxy_types::{EventEnvelope, EventType, MessageContent};

use crate::run_service::{QueuedRun, RunService, StartRunOutcome};

// ---------------------------------------------------------------------------
// execute_skill
// ---------------------------------------------------------------------------

pub struct ExecuteSkillAction {
    run_service: Arc<RunService>,
}

impl ExecuteSkillAction {
    pub fn new(run_service: Arc<RunService>) -> Self {
        Self { run_service }
    }
}

#[async_trait]
impl HeartbeatAction for ExecuteSkillAction {
    fn action_type(&self) -> &str {
        "execute_skill"
    }

    async fn execute(
        &self,
        ctx: &HeartbeatActionContext,
    ) -> Result<HeartbeatActionResult, HeartbeatActionError> {
        let payload = ctx
            .entry
            .action_payload
            .as_deref()
            .unwrap_or("run scheduled skill");
        // Wrap in a directive preamble so the agent calls tools immediately
        // instead of narrating what it plans to do.
        let task = format!(
            "[HEARTBEAT TRIGGERED - IMMEDIATE ACTION REQUIRED]\n\
             This run was triggered automatically by heartbeat '{}'.\n\
             Your task: {}\n\n\
             IMPORTANT: Begin executing tool calls immediately. \
             Do NOT describe what you will do - just do it.",
            ctx.entry.id, payload,
        );
        let outcome = self
            .run_service
            .start_or_queue_run(QueuedRun {
                agent_name: ctx.agent_id.clone(),
                task: task.clone(),
                source: "heartbeat".into(),
                metadata: serde_json::json!({ "heartbeat_id": ctx.entry.id }),
            })
            .await;

        match outcome {
            Ok(StartRunOutcome::Started { run_id }) => Ok(HeartbeatActionResult {
                payload: serde_json::json!({
                    "heartbeat_id": ctx.entry.id,
                    "run_id": run_id,
                    "message": "Scheduled run started",
                }),
            }),
            Ok(StartRunOutcome::Queued { position }) => Ok(HeartbeatActionResult {
                payload: serde_json::json!({
                    "heartbeat_id": ctx.entry.id,
                    "message": "Agent busy - run queued",
                    "queue_position": position,
                }),
            }),
            Ok(StartRunOutcome::QueueFull) => Err(HeartbeatActionError {
                message: format!(
                    "Heartbeat {} for agent {}: queue full, run dropped",
                    ctx.entry.id, ctx.agent_id
                ),
            }),
            Err(e) => Err(HeartbeatActionError {
                message: format!(
                    "Heartbeat {} failed to start run for agent {}: {}",
                    ctx.entry.id, ctx.agent_id, e
                ),
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// notify_cli
// ---------------------------------------------------------------------------

pub struct NotifyCliAction;

#[async_trait]
impl HeartbeatAction for NotifyCliAction {
    fn action_type(&self) -> &str {
        "notify_cli"
    }

    async fn execute(
        &self,
        ctx: &HeartbeatActionContext,
    ) -> Result<HeartbeatActionResult, HeartbeatActionError> {
        Ok(HeartbeatActionResult {
            payload: serde_json::json!({
                "heartbeat_id": ctx.entry.id,
                "message": ctx.entry.action_payload.as_deref().unwrap_or("Heartbeat check"),
            }),
        })
    }
}

// ---------------------------------------------------------------------------
// notify_channel
// ---------------------------------------------------------------------------

pub struct NotifyChannelAction {
    channel_bridge: Arc<Mutex<Option<Arc<ChannelBridge>>>>,
}

impl NotifyChannelAction {
    pub fn new(channel_bridge: Arc<Mutex<Option<Arc<ChannelBridge>>>>) -> Self {
        Self { channel_bridge }
    }
}

#[async_trait]
impl HeartbeatAction for NotifyChannelAction {
    fn action_type(&self) -> &str {
        "notify_channel"
    }

    async fn execute(
        &self,
        ctx: &HeartbeatActionContext,
    ) -> Result<HeartbeatActionResult, HeartbeatActionError> {
        let message = ctx
            .entry
            .action_payload
            .as_deref()
            .unwrap_or("Heartbeat notification");
        let bridge = self
            .channel_bridge
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .ok_or(HeartbeatActionError {
                message: format!(
                    "Heartbeat {} notify_channel: no channel bridge available",
                    ctx.entry.id
                ),
            })?;
        let content = MessageContent::Text(message.to_string());
        match bridge.send_to_agent_channels(&ctx.agent_id, content).await {
            Ok(count) => {
                tracing::info!(
                    agent=%ctx.agent_id,
                    heartbeat_id=%ctx.entry.id,
                    channels_notified=count,
                    "Heartbeat notify_channel sent"
                );
                Ok(HeartbeatActionResult {
                    payload: serde_json::json!({
                        "heartbeat_id": ctx.entry.id,
                        "message": message,
                        "channels_notified": count,
                    }),
                })
            }
            Err(e) => Err(HeartbeatActionError {
                message: format!(
                    "Heartbeat {} notify_channel failed for agent {}: {}",
                    ctx.entry.id, ctx.agent_id, e
                ),
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// notify_webhook
// ---------------------------------------------------------------------------

pub struct NotifyWebhookAction {
    event_bus: EventBus,
}

impl NotifyWebhookAction {
    pub fn new(event_bus: EventBus) -> Self {
        Self { event_bus }
    }
}

#[async_trait]
impl HeartbeatAction for NotifyWebhookAction {
    fn action_type(&self) -> &str {
        "notify_webhook"
    }

    async fn execute(
        &self,
        ctx: &HeartbeatActionContext,
    ) -> Result<HeartbeatActionResult, HeartbeatActionError> {
        let url = ctx
            .entry
            .action_payload
            .as_ref()
            .ok_or(HeartbeatActionError {
                message: format!(
                    "Heartbeat {} notify_webhook has no URL in action_payload",
                    ctx.entry.id
                ),
            })?;

        let agent_id = ctx.agent_id.clone();
        let heartbeat_id = ctx.entry.id.clone();
        let url = url.clone();
        let eb = self.event_bus.clone();

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

        // The webhook fires asynchronously; return a success result immediately.
        Ok(HeartbeatActionResult {
            payload: serde_json::json!({
                "heartbeat_id": ctx.entry.id,
                "webhook_url": ctx.entry.action_payload,
                "message": "Webhook dispatch started",
            }),
        })
    }
}

// ---------------------------------------------------------------------------
// memory_compact
// ---------------------------------------------------------------------------

pub struct MemoryCompactAction {
    db: Arc<Mutex<Database>>,
    event_bus: EventBus,
}

impl MemoryCompactAction {
    pub fn new(db: Arc<Mutex<Database>>, event_bus: EventBus) -> Self {
        Self { db, event_bus }
    }
}

#[async_trait]
impl HeartbeatAction for MemoryCompactAction {
    fn action_type(&self) -> &str {
        "memory_compact"
    }

    async fn execute(
        &self,
        ctx: &HeartbeatActionContext,
    ) -> Result<HeartbeatActionResult, HeartbeatActionError> {
        let agent_id = ctx.agent_id.clone();
        let heartbeat_id = ctx.entry.id.clone();
        let db_ref = self.db.clone();
        let eb = self.event_bus.clone();

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
                let eligible: Vec<EligibleEntry> = records
                    .iter()
                    .filter(|r| r.status == "active")
                    .map(|r| EligibleEntry {
                        id: r.id.clone(),
                        agent_id: r.agent_id.clone(),
                        markdown_path: r.markdown_path.clone(),
                        tags_json: r.tags_json.clone(),
                        created_at: r.created_at.clone(),
                        status: r.status.clone(),
                    })
                    .collect();
                let compactor = MemoryCompactor::new(CompactionConfig::default());
                let groups = compactor.find_eligible(&eligible, chrono::Utc::now());
                let mut compacted = 0usize;
                for (_tag, entries) in &groups {
                    if let Ok(result) = compactor
                        .compact_group(entries, _tag, &memory_dir, &archive_dir, None)
                        .await
                    {
                        compacted += result.entries_compacted;
                        let db = db_ref.lock().unwrap();
                        for entry in entries {
                            let _ = db.memory().update_status(&entry.id, "archived");
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

        // Memory compaction runs in a background task; return immediately.
        Ok(HeartbeatActionResult {
            payload: serde_json::json!({
                "heartbeat_id": ctx.entry.id,
                "message": "Memory compaction started",
            }),
        })
    }
}
