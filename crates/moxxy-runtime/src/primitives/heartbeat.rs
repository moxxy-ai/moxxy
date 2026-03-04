use std::path::PathBuf;

use async_trait::async_trait;
use moxxy_core::{HeartbeatEntry, HeartbeatScheduler, mutate_heartbeat_file, read_heartbeat_file};

use crate::registry::{Primitive, PrimitiveError};

pub struct HeartbeatCreatePrimitive {
    heartbeat_path: PathBuf,
    agent_id: String,
}

impl HeartbeatCreatePrimitive {
    pub fn new(heartbeat_path: PathBuf, agent_id: String) -> Self {
        Self {
            heartbeat_path,
            agent_id,
        }
    }
}

#[async_trait]
impl Primitive for HeartbeatCreatePrimitive {
    fn name(&self) -> &str {
        "heartbeat.create"
    }

    fn description(&self) -> &str {
        "Create a recurring heartbeat schedule. Use interval_minutes or cron_expr for scheduling."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action_type": {"type": "string", "description": "Action to perform: execute_skill, notify_cli, notify_webhook, memory_compact"},
                "action_payload": {"type": "string", "description": "Payload for the action (e.g., task text or webhook URL)"},
                "interval_minutes": {"type": "integer", "description": "Run every N minutes (mutually exclusive with cron_expr)"},
                "cron_expr": {"type": "string", "description": "Cron expression for scheduling (mutually exclusive with interval_minutes)"},
                "timezone": {"type": "string", "description": "Timezone for cron (default: UTC)"}
            },
            "required": ["action_type"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let action_type = params["action_type"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'action_type'".into()))?;

        let action_payload = params["action_payload"].as_str().map(|s| s.to_string());

        let interval_minutes = params["interval_minutes"].as_i64();
        let cron_expr = params["cron_expr"].as_str();
        let timezone = params["timezone"].as_str().unwrap_or("UTC").to_string();

        tracing::info!(
            agent_id = %self.agent_id,
            action_type,
            has_cron = cron_expr.is_some(),
            interval = ?interval_minutes,
            "Creating heartbeat"
        );

        let now = chrono::Utc::now();

        let (interval, cron, next_run_at) = match (interval_minutes, cron_expr) {
            (Some(mins), None) => {
                if mins < 1 {
                    return Err(PrimitiveError::InvalidParams(
                        "interval_minutes must be >= 1".into(),
                    ));
                }
                let next = now + chrono::Duration::minutes(mins);
                (Some(mins as i32), None, next.to_rfc3339())
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
                (None, Some(expr.to_string()), next_run)
            }
            _ => {
                return Err(PrimitiveError::InvalidParams(
                    "exactly one of 'interval_minutes' or 'cron_expr' must be provided".into(),
                ));
            }
        };

        let id = uuid::Uuid::now_v7().to_string();
        let entry = HeartbeatEntry {
            id: id.clone(),
            action_type: action_type.to_string(),
            action_payload,
            interval_minutes: interval,
            cron_expr: cron.clone(),
            timezone: timezone.clone(),
            enabled: true,
            next_run_at: next_run_at.clone(),
            created_at: now.to_rfc3339(),
            updated_at: now.to_rfc3339(),
        };

        mutate_heartbeat_file(&self.heartbeat_path, |f| {
            f.entries.push(entry);
        })
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to create heartbeat: {e}")))?;

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
    heartbeat_path: PathBuf,
    agent_id: String,
}

impl HeartbeatListPrimitive {
    pub fn new(heartbeat_path: PathBuf, agent_id: String) -> Self {
        Self {
            heartbeat_path,
            agent_id,
        }
    }
}

#[async_trait]
impl Primitive for HeartbeatListPrimitive {
    fn name(&self) -> &str {
        "heartbeat.list"
    }

    fn description(&self) -> &str {
        "List all active heartbeat schedules for this agent."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
        })
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        tracing::debug!(agent_id = %self.agent_id, "Listing heartbeats");

        let file = read_heartbeat_file(&self.heartbeat_path)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let result: Vec<serde_json::Value> = file
            .entries
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
    heartbeat_path: PathBuf,
    agent_id: String,
}

impl HeartbeatDisablePrimitive {
    pub fn new(heartbeat_path: PathBuf, agent_id: String) -> Self {
        Self {
            heartbeat_path,
            agent_id,
        }
    }
}

#[async_trait]
impl Primitive for HeartbeatDisablePrimitive {
    fn name(&self) -> &str {
        "heartbeat.disable"
    }

    fn description(&self) -> &str {
        "Disable an active heartbeat schedule."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "heartbeat_id": {"type": "string", "description": "ID of the heartbeat to disable"}
            },
            "required": ["heartbeat_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let heartbeat_id = params["heartbeat_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'heartbeat_id'".into()))?;

        tracing::info!(heartbeat_id, agent_id = %self.agent_id, "Disabling heartbeat");

        let file = mutate_heartbeat_file(&self.heartbeat_path, |f| {
            if let Some(entry) = f.entries.iter_mut().find(|e| e.id == heartbeat_id) {
                entry.enabled = false;
                entry.updated_at = chrono::Utc::now().to_rfc3339();
            }
        })
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to disable: {e}")))?;

        // Verify the heartbeat existed
        if !file.entries.iter().any(|e| e.id == heartbeat_id) {
            return Err(PrimitiveError::ExecutionFailed(
                "heartbeat not found".into(),
            ));
        }

        Ok(serde_json::json!({
            "heartbeat_id": heartbeat_id,
            "status": "disabled",
        }))
    }
}

pub struct HeartbeatDeletePrimitive {
    heartbeat_path: PathBuf,
    agent_id: String,
}

impl HeartbeatDeletePrimitive {
    pub fn new(heartbeat_path: PathBuf, agent_id: String) -> Self {
        Self {
            heartbeat_path,
            agent_id,
        }
    }
}

#[async_trait]
impl Primitive for HeartbeatDeletePrimitive {
    fn name(&self) -> &str {
        "heartbeat.delete"
    }

    fn description(&self) -> &str {
        "Permanently delete a heartbeat schedule."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "heartbeat_id": {"type": "string", "description": "ID of the heartbeat to delete"}
            },
            "required": ["heartbeat_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let heartbeat_id = params["heartbeat_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'heartbeat_id'".into()))?;

        tracing::info!(heartbeat_id, agent_id = %self.agent_id, "Deleting heartbeat");

        let file = mutate_heartbeat_file(&self.heartbeat_path, |f| {
            f.entries.retain(|e| e.id != heartbeat_id);
        })
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to delete: {e}")))?;

        // If the entry was there before mutation it's now gone; we can't easily check
        // pre-mutation state without reading first, but the operation is idempotent.
        let _ = file;

        Ok(serde_json::json!({
            "heartbeat_id": heartbeat_id,
            "status": "deleted",
        }))
    }
}

pub struct HeartbeatUpdatePrimitive {
    heartbeat_path: PathBuf,
    agent_id: String,
}

impl HeartbeatUpdatePrimitive {
    pub fn new(heartbeat_path: PathBuf, agent_id: String) -> Self {
        Self {
            heartbeat_path,
            agent_id,
        }
    }
}

#[async_trait]
impl Primitive for HeartbeatUpdatePrimitive {
    fn name(&self) -> &str {
        "heartbeat.update"
    }

    fn description(&self) -> &str {
        "Update a heartbeat schedule's action, interval, or cron expression."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "heartbeat_id": {"type": "string", "description": "ID of the heartbeat to update"},
                "action_type": {"type": "string", "description": "New action type"},
                "action_payload": {"type": "string", "description": "New action payload"},
                "interval_minutes": {"type": "integer", "description": "New interval in minutes"},
                "cron_expr": {"type": "string", "description": "New cron expression"},
                "timezone": {"type": "string", "description": "New timezone"},
                "enabled": {"type": "boolean", "description": "Enable or disable the heartbeat"}
            },
            "required": ["heartbeat_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let heartbeat_id = params["heartbeat_id"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'heartbeat_id'".into()))?
            .to_string();

        tracing::info!(heartbeat_id = %heartbeat_id, agent_id = %self.agent_id, "Updating heartbeat");

        let now = chrono::Utc::now();
        let params_clone = params.clone();

        let file = mutate_heartbeat_file(&self.heartbeat_path, |f| {
            let Some(hb) = f.entries.iter_mut().find(|e| e.id == heartbeat_id) else {
                return;
            };

            // Update action_type if provided
            if let Some(at) = params_clone["action_type"].as_str() {
                hb.action_type = at.to_string();
            }
            if params_clone.get("action_payload").is_some() {
                hb.action_payload = params_clone["action_payload"]
                    .as_str()
                    .map(|s| s.to_string());
            }

            // Update schedule
            let new_interval = params_clone["interval_minutes"].as_i64();
            let new_cron = params_clone["cron_expr"].as_str();
            if let Some(tz) = params_clone["timezone"].as_str() {
                hb.timezone = tz.to_string();
            }

            match (new_interval, new_cron) {
                (Some(mins), None) => {
                    if mins >= 1 {
                        hb.interval_minutes = Some(mins as i32);
                        hb.cron_expr = None;
                        hb.next_run_at = (now + chrono::Duration::minutes(mins)).to_rfc3339();
                    }
                }
                (None, Some(expr)) => {
                    if HeartbeatScheduler::validate_cron_expr(expr).is_ok()
                        && HeartbeatScheduler::validate_timezone(&hb.timezone).is_ok()
                        && let Ok(next_run) =
                            HeartbeatScheduler::compute_next_cron_run(expr, &hb.timezone, now)
                    {
                        hb.interval_minutes = None;
                        hb.cron_expr = Some(expr.to_string());
                        hb.next_run_at = next_run;
                    }
                }
                (Some(_), Some(_)) => {} // invalid, skip
                (None, None) => {}       // no schedule change
            }

            // Re-enable if explicitly requested
            if let Some(enabled) = params_clone["enabled"].as_bool() {
                hb.enabled = enabled;
            }

            hb.updated_at = now.to_rfc3339();
        })
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to update: {e}")))?;

        let hb = file
            .entries
            .iter()
            .find(|e| e.id == heartbeat_id)
            .ok_or_else(|| PrimitiveError::ExecutionFailed("heartbeat not found".into()))?;

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

    fn setup_path() -> (tempfile::TempDir, PathBuf, String) {
        let dir = tempfile::tempdir().unwrap();
        let agent_id = "agent-1".to_string();
        let path = dir
            .path()
            .join("agents")
            .join(&agent_id)
            .join("heartbeat.md");
        (dir, path, agent_id)
    }

    #[tokio::test]
    async fn heartbeat_create_with_interval() {
        let (_dir, path, agent_id) = setup_path();
        let prim = HeartbeatCreatePrimitive::new(path, agent_id);
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
        let (_dir, path, agent_id) = setup_path();
        let prim = HeartbeatCreatePrimitive::new(path, agent_id);
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
        let (_dir, path, agent_id) = setup_path();
        let prim = HeartbeatCreatePrimitive::new(path, agent_id);
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
        let (_dir, path, agent_id) = setup_path();
        let prim = HeartbeatCreatePrimitive::new(path, agent_id);
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
        let (_dir, path, agent_id) = setup_path();
        let create = HeartbeatCreatePrimitive::new(path.clone(), agent_id.clone());
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

        let list = HeartbeatListPrimitive::new(path, agent_id);
        let result = list.invoke(serde_json::json!({})).await.unwrap();
        let hbs = result["heartbeats"].as_array().unwrap();
        assert_eq!(hbs.len(), 2);
    }

    #[tokio::test]
    async fn heartbeat_disable_works() {
        let (_dir, path, agent_id) = setup_path();
        let create = HeartbeatCreatePrimitive::new(path.clone(), agent_id.clone());
        let created = create
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "interval_minutes": 10,
            }))
            .await
            .unwrap();
        let hb_id = created["id"].as_str().unwrap();

        let disable = HeartbeatDisablePrimitive::new(path.clone(), agent_id.clone());
        let result = disable
            .invoke(serde_json::json!({"heartbeat_id": hb_id}))
            .await
            .unwrap();
        assert_eq!(result["status"], "disabled");

        // List should now be empty (only enabled shown)
        let list = HeartbeatListPrimitive::new(path, agent_id);
        let result = list.invoke(serde_json::json!({})).await.unwrap();
        assert_eq!(result["heartbeats"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn heartbeat_disable_rejects_unknown_id() {
        let (_dir, path, agent_id) = setup_path();
        let disable = HeartbeatDisablePrimitive::new(path, agent_id);
        let result = disable
            .invoke(serde_json::json!({"heartbeat_id": "nonexistent"}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn heartbeat_delete_removes_entry() {
        let (_dir, path, agent_id) = setup_path();
        let create = HeartbeatCreatePrimitive::new(path.clone(), agent_id.clone());
        let created = create
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "interval_minutes": 10,
            }))
            .await
            .unwrap();
        let hb_id = created["id"].as_str().unwrap();

        let delete = HeartbeatDeletePrimitive::new(path.clone(), agent_id.clone());
        let result = delete
            .invoke(serde_json::json!({"heartbeat_id": hb_id}))
            .await
            .unwrap();
        assert_eq!(result["status"], "deleted");

        // Verify it's gone
        let file = read_heartbeat_file(&path).unwrap();
        assert!(file.entries.is_empty());
    }

    #[tokio::test]
    async fn heartbeat_update_changes_schedule() {
        let (_dir, path, agent_id) = setup_path();
        let create = HeartbeatCreatePrimitive::new(path.clone(), agent_id.clone());
        let created = create
            .invoke(serde_json::json!({
                "action_type": "notify_cli",
                "interval_minutes": 10,
            }))
            .await
            .unwrap();
        let hb_id = created["id"].as_str().unwrap();

        let update = HeartbeatUpdatePrimitive::new(path, agent_id);
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
        assert!(result["interval_minutes"].is_null());
    }

    #[tokio::test]
    async fn heartbeat_update_changes_action_payload() {
        let (_dir, path, agent_id) = setup_path();
        let create = HeartbeatCreatePrimitive::new(path.clone(), agent_id.clone());
        let created = create
            .invoke(serde_json::json!({
                "action_type": "execute_skill",
                "action_payload": "old task",
                "interval_minutes": 60,
            }))
            .await
            .unwrap();
        let hb_id = created["id"].as_str().unwrap();

        let update = HeartbeatUpdatePrimitive::new(path, agent_id);
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
