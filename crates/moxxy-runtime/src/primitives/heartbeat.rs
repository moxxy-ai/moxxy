use async_trait::async_trait;
use moxxy_core::HeartbeatScheduler;
use moxxy_storage::{Database, HeartbeatRow};
use std::sync::{Arc, Mutex};

use crate::registry::{Primitive, PrimitiveError};

pub struct HeartbeatCreatePrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
}

impl HeartbeatCreatePrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self { db, agent_id }
    }
}

#[async_trait]
impl Primitive for HeartbeatCreatePrimitive {
    fn name(&self) -> &str {
        "heartbeat.create"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let action_type = params["action_type"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'action_type'".into()))?;

        let action_payload = params["action_payload"].as_str().map(|s| s.to_string());

        let interval_minutes = params["interval_minutes"].as_i64();
        let cron_expr = params["cron_expr"].as_str();
        let timezone = params["timezone"].as_str().unwrap_or("UTC").to_string();

        let now = chrono::Utc::now();

        let (interval, cron, next_run_at) = match (interval_minutes, cron_expr) {
            (Some(mins), None) => {
                if mins < 1 {
                    return Err(PrimitiveError::InvalidParams(
                        "interval_minutes must be >= 1".into(),
                    ));
                }
                let next = now + chrono::Duration::minutes(mins);
                (mins as i32, None, next.to_rfc3339())
            }
            (None, Some(expr)) => {
                HeartbeatScheduler::validate_cron_expr(expr).map_err(|e| {
                    PrimitiveError::InvalidParams(format!("invalid cron expression: {e}"))
                })?;
                HeartbeatScheduler::validate_timezone(&timezone)
                    .map_err(|e| PrimitiveError::InvalidParams(format!("invalid timezone: {e}")))?;
                let next_run = HeartbeatScheduler::compute_next_cron_run(expr, &timezone, now)
                    .map_err(|e| {
                        PrimitiveError::ExecutionFailed(format!("cron computation failed: {e}"))
                    })?;
                (1, Some(expr.to_string()), next_run)
            }
            _ => {
                return Err(PrimitiveError::InvalidParams(
                    "exactly one of 'interval_minutes' or 'cron_expr' must be provided".into(),
                ));
            }
        };

        let id = uuid::Uuid::now_v7().to_string();
        let row = HeartbeatRow {
            id: id.clone(),
            agent_id: self.agent_id.clone(),
            interval_minutes: interval,
            action_type: action_type.to_string(),
            action_payload,
            enabled: true,
            next_run_at: next_run_at.clone(),
            cron_expr: cron.clone(),
            timezone: timezone.clone(),
            created_at: now.to_rfc3339(),
            updated_at: now.to_rfc3339(),
        };

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {e}")))?;

        db.heartbeats().insert(&row).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("Failed to create heartbeat: {e}"))
        })?;

        Ok(serde_json::json!({
            "id": id,
            "agent_id": self.agent_id,
            "interval_minutes": interval,
            "cron_expr": cron,
            "timezone": timezone,
            "action_type": action_type,
            "next_run_at": next_run_at,
            "enabled": true,
            "status": "created",
        }))
    }
}

pub struct HeartbeatListPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
}

impl HeartbeatListPrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self { db, agent_id }
    }
}

#[async_trait]
impl Primitive for HeartbeatListPrimitive {
    fn name(&self) -> &str {
        "heartbeat.list"
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {e}")))?;

        let heartbeats = db
            .heartbeats()
            .find_by_agent(&self.agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let result: Vec<serde_json::Value> = heartbeats
            .iter()
            .filter(|h| h.enabled)
            .map(|h| {
                serde_json::json!({
                    "id": h.id,
                    "interval_minutes": h.interval_minutes,
                    "cron_expr": h.cron_expr,
                    "timezone": h.timezone,
                    "action_type": h.action_type,
                    "action_payload": h.action_payload,
                    "next_run_at": h.next_run_at,
                    "enabled": h.enabled,
                })
            })
            .collect();

        Ok(serde_json::json!({ "heartbeats": result }))
    }
}

pub struct HeartbeatDisablePrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
}

impl HeartbeatDisablePrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self { db, agent_id }
    }
}

#[async_trait]
impl Primitive for HeartbeatDisablePrimitive {
    fn name(&self) -> &str {
        "heartbeat.disable"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let heartbeat_id = params["heartbeat_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'heartbeat_id'".into()))?;

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {e}")))?;

        // Verify the heartbeat belongs to this agent
        let hb = db
            .heartbeats()
            .find_by_id(heartbeat_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
            .ok_or_else(|| PrimitiveError::ExecutionFailed("heartbeat not found".into()))?;

        if hb.agent_id != self.agent_id {
            return Err(PrimitiveError::ExecutionFailed(
                "heartbeat does not belong to this agent".into(),
            ));
        }

        db.heartbeats()
            .disable(heartbeat_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to disable: {e}")))?;

        Ok(serde_json::json!({
            "heartbeat_id": heartbeat_id,
            "status": "disabled",
        }))
    }
}

pub struct HeartbeatDeletePrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
}

impl HeartbeatDeletePrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self { db, agent_id }
    }
}

#[async_trait]
impl Primitive for HeartbeatDeletePrimitive {
    fn name(&self) -> &str {
        "heartbeat.delete"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let heartbeat_id = params["heartbeat_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'heartbeat_id'".into()))?;

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {e}")))?;

        // Verify the heartbeat belongs to this agent
        let hb = db
            .heartbeats()
            .find_by_id(heartbeat_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
            .ok_or_else(|| PrimitiveError::ExecutionFailed("heartbeat not found".into()))?;

        if hb.agent_id != self.agent_id {
            return Err(PrimitiveError::ExecutionFailed(
                "heartbeat does not belong to this agent".into(),
            ));
        }

        db.heartbeats()
            .delete(heartbeat_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to delete: {e}")))?;

        Ok(serde_json::json!({
            "heartbeat_id": heartbeat_id,
            "status": "deleted",
        }))
    }
}

pub struct HeartbeatUpdatePrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
}

impl HeartbeatUpdatePrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self { db, agent_id }
    }
}

#[async_trait]
impl Primitive for HeartbeatUpdatePrimitive {
    fn name(&self) -> &str {
        "heartbeat.update"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let heartbeat_id = params["heartbeat_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'heartbeat_id'".into()))?;

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("DB lock error: {e}")))?;

        let mut hb = db
            .heartbeats()
            .find_by_id(heartbeat_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
            .ok_or_else(|| PrimitiveError::ExecutionFailed("heartbeat not found".into()))?;

        if hb.agent_id != self.agent_id {
            return Err(PrimitiveError::ExecutionFailed(
                "heartbeat does not belong to this agent".into(),
            ));
        }

        let now = chrono::Utc::now();

        // Update action_type if provided
        if let Some(at) = params["action_type"].as_str() {
            hb.action_type = at.to_string();
        }
        if params.get("action_payload").is_some() {
            hb.action_payload = params["action_payload"].as_str().map(|s| s.to_string());
        }

        // Update schedule: switch between interval and cron, or update existing
        let new_interval = params["interval_minutes"].as_i64();
        let new_cron = params["cron_expr"].as_str();
        if let Some(tz) = params["timezone"].as_str() {
            hb.timezone = tz.to_string();
        }

        match (new_interval, new_cron) {
            (Some(mins), None) => {
                if mins < 1 {
                    return Err(PrimitiveError::InvalidParams(
                        "interval_minutes must be >= 1".into(),
                    ));
                }
                hb.interval_minutes = mins as i32;
                hb.cron_expr = None;
                hb.next_run_at = (now + chrono::Duration::minutes(mins)).to_rfc3339();
            }
            (None, Some(expr)) => {
                HeartbeatScheduler::validate_cron_expr(expr).map_err(|e| {
                    PrimitiveError::InvalidParams(format!("invalid cron expression: {e}"))
                })?;
                HeartbeatScheduler::validate_timezone(&hb.timezone)
                    .map_err(|e| PrimitiveError::InvalidParams(format!("invalid timezone: {e}")))?;
                let next_run = HeartbeatScheduler::compute_next_cron_run(expr, &hb.timezone, now)
                    .map_err(|e| {
                    PrimitiveError::ExecutionFailed(format!("cron computation failed: {e}"))
                })?;
                hb.interval_minutes = 1;
                hb.cron_expr = Some(expr.to_string());
                hb.next_run_at = next_run;
            }
            (Some(_), Some(_)) => {
                return Err(PrimitiveError::InvalidParams(
                    "cannot set both interval_minutes and cron_expr".into(),
                ));
            }
            (None, None) => {} // no schedule change
        }

        // Re-enable if explicitly requested
        if let Some(enabled) = params["enabled"].as_bool() {
            hb.enabled = enabled;
        }

        hb.updated_at = now.to_rfc3339();

        db.heartbeats()
            .update(&hb)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to update: {e}")))?;

        Ok(serde_json::json!({
            "heartbeat_id": hb.id,
            "interval_minutes": hb.interval_minutes,
            "cron_expr": hb.cron_expr,
            "timezone": hb.timezone,
            "action_type": hb.action_type,
            "action_payload": hb.action_payload,
            "next_run_at": hb.next_run_at,
            "enabled": hb.enabled,
            "status": "updated",
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn setup_db() -> (Arc<Mutex<Database>>, String) {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../../migrations/0002_channels.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../../migrations/0003_webhooks.sql"))
            .unwrap();
        conn.execute_batch(include_str!(
            "../../../../migrations/0004_conversation_log.sql"
        ))
        .unwrap();
        conn.execute_batch(include_str!(
            "../../../../migrations/0006_heartbeat_cron.sql"
        ))
        .unwrap();
        conn.execute(
            "INSERT INTO providers (id, display_name, manifest_path, enabled, created_at)
             VALUES ('prov-1', 'P1', '/p1', 1, '2025-01-01')",
            params![],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agents (id, provider_id, model_id, workspace_root, status, depth, spawned_total, temperature, max_subagent_depth, max_subagents_total, created_at, updated_at)
             VALUES ('agent-1', 'prov-1', 'gpt-4', '/tmp', 'idle', 0, 0, 0.7, 2, 8, '2025-01-01', '2025-01-01')",
            params![],
        )
        .unwrap();
        let db = Arc::new(Mutex::new(Database::new(conn)));
        (db, "agent-1".to_string())
    }

    #[tokio::test]
    async fn heartbeat_create_with_interval() {
        let (db, agent_id) = setup_db();
        let prim = HeartbeatCreatePrimitive::new(db.clone(), agent_id);
        let result = prim
            .invoke(serde_json::json!({
                "action_type": "execute_skill",
                "action_payload": "Run daily_newspaper skill",
                "interval_minutes": 60,
            }))
            .await
            .unwrap();

        assert_eq!(result["status"], "created");
        assert_eq!(result["interval_minutes"], 60);
        assert!(result["cron_expr"].is_null());
        assert!(result["id"].as_str().is_some());
    }

    #[tokio::test]
    async fn heartbeat_create_with_cron() {
        let (db, agent_id) = setup_db();
        let prim = HeartbeatCreatePrimitive::new(db.clone(), agent_id);
        let result = prim
            .invoke(serde_json::json!({
                "action_type": "execute_skill",
                "action_payload": "Run daily_newspaper skill",
                "cron_expr": "0 0 9 * * *",
                "timezone": "Europe/Warsaw",
            }))
            .await
            .unwrap();

        assert_eq!(result["status"], "created");
        assert_eq!(result["cron_expr"], "0 0 9 * * *");
        assert_eq!(result["timezone"], "Europe/Warsaw");
        assert!(result["next_run_at"].as_str().is_some());
    }

    #[tokio::test]
    async fn heartbeat_create_rejects_both_interval_and_cron() {
        let (db, agent_id) = setup_db();
        let prim = HeartbeatCreatePrimitive::new(db, agent_id);
        let result = prim
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "interval_minutes": 60,
                "cron_expr": "0 0 9 * * *",
            }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn heartbeat_create_rejects_invalid_cron() {
        let (db, agent_id) = setup_db();
        let prim = HeartbeatCreatePrimitive::new(db, agent_id);
        let result = prim
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "cron_expr": "bad cron",
            }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn heartbeat_list_returns_agent_heartbeats() {
        let (db, agent_id) = setup_db();
        let create = HeartbeatCreatePrimitive::new(db.clone(), agent_id.clone());
        create
            .invoke(serde_json::json!({
                "action_type": "execute_skill",
                "action_payload": "task A",
                "interval_minutes": 30,
            }))
            .await
            .unwrap();
        create
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "interval_minutes": 60,
            }))
            .await
            .unwrap();

        let list = HeartbeatListPrimitive::new(db, agent_id);
        let result = list.invoke(serde_json::json!({})).await.unwrap();
        let hbs = result["heartbeats"].as_array().unwrap();
        assert_eq!(hbs.len(), 2);
    }

    #[tokio::test]
    async fn heartbeat_disable_works() {
        let (db, agent_id) = setup_db();
        let create = HeartbeatCreatePrimitive::new(db.clone(), agent_id.clone());
        let created = create
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "interval_minutes": 10,
            }))
            .await
            .unwrap();
        let hb_id = created["id"].as_str().unwrap();

        let disable = HeartbeatDisablePrimitive::new(db.clone(), agent_id.clone());
        let result = disable
            .invoke(serde_json::json!({"heartbeat_id": hb_id}))
            .await
            .unwrap();
        assert_eq!(result["status"], "disabled");

        // List should now be empty (only enabled shown)
        let list = HeartbeatListPrimitive::new(db, agent_id);
        let result = list.invoke(serde_json::json!({})).await.unwrap();
        assert_eq!(result["heartbeats"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn heartbeat_disable_rejects_other_agents_heartbeat() {
        let (db, agent_id) = setup_db();
        let create = HeartbeatCreatePrimitive::new(db.clone(), agent_id);
        let created = create
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "interval_minutes": 10,
            }))
            .await
            .unwrap();
        let hb_id = created["id"].as_str().unwrap();

        // Different agent tries to disable
        let disable = HeartbeatDisablePrimitive::new(db, "other-agent".to_string());
        let result = disable
            .invoke(serde_json::json!({"heartbeat_id": hb_id}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn heartbeat_delete_removes_from_db() {
        let (db, agent_id) = setup_db();
        let create = HeartbeatCreatePrimitive::new(db.clone(), agent_id.clone());
        let created = create
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "interval_minutes": 10,
            }))
            .await
            .unwrap();
        let hb_id = created["id"].as_str().unwrap();

        let delete = HeartbeatDeletePrimitive::new(db.clone(), agent_id.clone());
        let result = delete
            .invoke(serde_json::json!({"heartbeat_id": hb_id}))
            .await
            .unwrap();
        assert_eq!(result["status"], "deleted");

        // Verify it's gone from DB entirely
        let db_lock = db.lock().unwrap();
        let found = db_lock.heartbeats().find_by_id(hb_id).unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn heartbeat_update_changes_schedule() {
        let (db, agent_id) = setup_db();
        let create = HeartbeatCreatePrimitive::new(db.clone(), agent_id.clone());
        let created = create
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "interval_minutes": 10,
            }))
            .await
            .unwrap();
        let hb_id = created["id"].as_str().unwrap();

        let update = HeartbeatUpdatePrimitive::new(db.clone(), agent_id);
        let result = update
            .invoke(serde_json::json!({
                "heartbeat_id": hb_id,
                "cron_expr": "0 0 9 * * *",
                "timezone": "Europe/Warsaw",
            }))
            .await
            .unwrap();
        assert_eq!(result["status"], "updated");
        assert_eq!(result["cron_expr"], "0 0 9 * * *");
        assert_eq!(result["timezone"], "Europe/Warsaw");
        assert_eq!(result["interval_minutes"], 1);
    }

    #[tokio::test]
    async fn heartbeat_update_changes_action_payload() {
        let (db, agent_id) = setup_db();
        let create = HeartbeatCreatePrimitive::new(db.clone(), agent_id.clone());
        let created = create
            .invoke(serde_json::json!({
                "action_type": "execute_skill",
                "action_payload": "old task",
                "interval_minutes": 60,
            }))
            .await
            .unwrap();
        let hb_id = created["id"].as_str().unwrap();

        let update = HeartbeatUpdatePrimitive::new(db, agent_id);
        let result = update
            .invoke(serde_json::json!({
                "heartbeat_id": hb_id,
                "action_payload": "new task",
            }))
            .await
            .unwrap();
        assert_eq!(result["action_payload"], "new task");
    }
}
