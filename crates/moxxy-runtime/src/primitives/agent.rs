use async_trait::async_trait;
use moxxy_core::{AgentLineage, EventBus};
use moxxy_storage::Database;
use moxxy_types::{EventEnvelope, EventType, RunStarter};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::ask::AskChannels;
use crate::registry::{Primitive, PrimitiveError};

/// Primitive that lets an agent spawn a sub-agent for a task.
pub struct AgentSpawnPrimitive {
    db: Arc<Mutex<Database>>,
    parent_agent_id: String,
    run_starter: Arc<dyn RunStarter>,
    event_bus: EventBus,
    moxxy_home: PathBuf,
}

impl AgentSpawnPrimitive {
    pub fn new(
        db: Arc<Mutex<Database>>,
        parent_agent_id: String,
        run_starter: Arc<dyn RunStarter>,
        event_bus: EventBus,
        moxxy_home: PathBuf,
    ) -> Self {
        Self {
            db,
            parent_agent_id,
            run_starter,
            event_bus,
            moxxy_home,
        }
    }
}

#[async_trait]
impl Primitive for AgentSpawnPrimitive {
    fn name(&self) -> &str {
        "agent.spawn"
    }

    fn description(&self) -> &str {
        "Spawn a sub-agent to work on a subtask. The sub-agent inherits the parent's provider, model, and workspace. Optionally provide repo_path to give the sub-agent a git worktree for isolated branch work."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "The task for the sub-agent to accomplish"
                },
                "model_id": {
                    "type": "string",
                    "description": "Optional model override for the sub-agent"
                },
                "repo_path": {
                    "type": "string",
                    "description": "Absolute path to a git repo to create a worktree from. The worktree is placed in the sub-agent's workspace under the repo name."
                },
                "branch": {
                    "type": "string",
                    "description": "Branch name for the worktree. Auto-generated as 'sub-<id>' if omitted."
                }
            },
            "required": ["task"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let task = params
            .get("task")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'task'".into()))?
            .to_string();

        tracing::info!(parent_agent_id = %self.parent_agent_id, task_len = task.len(), "Spawning sub-agent");

        let parent = {
            let db = self
                .db
                .lock()
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            db.agents()
                .find_by_id(&self.parent_agent_id)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
                .ok_or_else(|| {
                    PrimitiveError::NotFound(format!("parent agent '{}'", self.parent_agent_id))
                })?
        };

        // Enforce lineage limits
        let lineage = AgentLineage {
            root_agent_id: parent
                .parent_agent_id
                .clone()
                .unwrap_or_else(|| parent.id.clone()),
            current_depth: parent.depth as u32,
            max_depth: parent.max_subagent_depth as u32,
            spawned_total: parent.spawned_total as u32,
            max_total: parent.max_subagents_total as u32,
        };

        if !lineage.can_spawn() {
            tracing::warn!(
                parent_agent_id = %self.parent_agent_id,
                depth = lineage.current_depth,
                max_depth = lineage.max_depth,
                spawned = lineage.spawned_total,
                max_total = lineage.max_total,
                "Sub-agent spawn limit reached"
            );
            return Err(PrimitiveError::AccessDenied(format!(
                "spawn limit reached: depth={}/{}, total={}/{}",
                lineage.current_depth, lineage.max_depth, lineage.spawned_total, lineage.max_total
            )));
        }

        let model_id = params
            .get("model_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(&parent.model_id)
            .to_string();

        let now = chrono::Utc::now().to_rfc3339();
        let child_id = uuid::Uuid::now_v7().to_string();

        let parent_name = parent.name.as_deref().unwrap_or(&parent.id);
        let short_id = &child_id[child_id.len() - 8..]; // last 8 hex chars (random portion of UUIDv7)
        let auto_name = format!("{}-sub-{}", parent_name, short_id);
        let auto_name_for_event = auto_name.clone();

        // Child gets its own directory keyed by its ID
        let child_dir = self.moxxy_home.join("agents").join(&child_id);
        let child_workspace = child_dir.join("workspace");
        let child_memory = child_dir.join("memory");
        std::fs::create_dir_all(&child_workspace).ok();
        std::fs::create_dir_all(&child_memory).ok();

        // If repo_path is provided, try to create a git worktree in the child workspace.
        // This is best-effort: if the path isn't a git repo or git fails, the sub-agent
        // still spawns and can do other work (e.g. news fetching, research).
        if let Some(repo_path) = params.get("repo_path").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            let repo = std::path::Path::new(repo_path);
            let repo_name = repo
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("repo");
            let branch = params
                .get("branch")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from)
                .unwrap_or_else(|| format!("sub-{}", short_id));

            let worktree_dest = child_workspace.join(repo_name);
            let git = super::git::git_binary();
            let aug_path = super::git::augmented_path();

            // Prune stale worktrees first (e.g. from previous agents whose dirs were deleted).
            // This prevents "already checked out at ..." errors for branches that point to
            // non-existent worktree directories.
            let _ = tokio::process::Command::new(git)
                .args(["worktree", "prune"])
                .current_dir(repo_path)
                .env("PATH", aug_path)
                .output()
                .await;

            // Try creating a new branch first; if it already exists, use it as-is
            match tokio::process::Command::new(git)
                .args(["worktree", "add", "-b", &branch])
                .arg(&worktree_dest)
                .current_dir(repo_path)
                .env("PATH", aug_path)
                .output()
                .await
            {
                Ok(output) if output.status.success() => {
                    tracing::info!(
                        repo_path,
                        branch = %branch,
                        dest = %worktree_dest.display(),
                        "Created git worktree for sub-agent"
                    );
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if stderr.contains("already exists") || stderr.contains("already checked out") {
                        // Branch exists from a previous run — try reusing it
                        match tokio::process::Command::new(git)
                            .args(["worktree", "add"])
                            .arg(&worktree_dest)
                            .arg(&branch)
                            .current_dir(repo_path)
                            .env("PATH", aug_path)
                            .output()
                            .await
                        {
                            Ok(retry) if retry.status.success() => {
                                tracing::info!(
                                    repo_path,
                                    branch = %branch,
                                    dest = %worktree_dest.display(),
                                    "Reused existing branch for sub-agent worktree"
                                );
                            }
                            Ok(retry) => {
                                let retry_stderr = String::from_utf8_lossy(&retry.stderr);
                                tracing::warn!(
                                    repo_path,
                                    branch = %branch,
                                    error = %retry_stderr,
                                    "Failed to create git worktree (retry), sub-agent will work without it"
                                );
                            }
                            Err(e) => {
                                tracing::warn!(
                                    repo_path,
                                    branch = %branch,
                                    error = %e,
                                    "Failed to run git for worktree (retry), sub-agent will work without it"
                                );
                            }
                        }
                    } else {
                        tracing::warn!(
                            repo_path,
                            branch = %branch,
                            error = %stderr,
                            "Failed to create git worktree, sub-agent will work without it"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        repo_path,
                        error = %e,
                        "Git not available or repo_path invalid, sub-agent will work without worktree"
                    );
                }
            }
        }

        let child = moxxy_storage::AgentRow {
            id: child_id.clone(),
            parent_agent_id: Some(self.parent_agent_id.clone()),
            provider_id: parent.provider_id.clone(),
            model_id: model_id.clone(),
            workspace_root: child_dir.to_string_lossy().to_string(),
            core_mount: None,
            policy_profile: parent.policy_profile.clone(),
            temperature: parent.temperature,
            max_subagent_depth: parent.max_subagent_depth,
            max_subagents_total: parent.max_subagents_total,
            status: "idle".into(),
            depth: parent.depth + 1,
            spawned_total: 0,
            created_at: now.clone(),
            updated_at: now,
            name: Some(auto_name),
            persona: None,
        };

        {
            let db = self
                .db
                .lock()
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            db.agents()
                .insert(&child)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            db.agents()
                .increment_spawned_total(&self.parent_agent_id)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            // Inherit parent's allowlists and vault grants
            db.allowlists()
                .copy_from_agent(&self.parent_agent_id, &child_id)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            db.vault_grants()
                .copy_from_agent(&self.parent_agent_id, &child_id)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        }

        // Emit spawn event
        self.event_bus.emit(EventEnvelope::new(
            self.parent_agent_id.clone(),
            None,
            None,
            0,
            EventType::SubagentSpawned,
            serde_json::json!({
                "sub_agent_id": child_id,
                "name": auto_name_for_event,
                "task": task,
            }),
        ));

        // Start the run
        let run_id = self
            .run_starter
            .start_run(&child_id, &task)
            .await
            .map_err(PrimitiveError::ExecutionFailed)?;

        Ok(serde_json::json!({
            "sub_agent_id": child_id,
            "run_id": run_id,
        }))
    }
}

/// Primitive that lets a parent agent check the status of a sub-agent.
pub struct AgentStatusPrimitive {
    db: Arc<Mutex<Database>>,
    parent_agent_id: String,
    ask_channels: AskChannels,
}

impl AgentStatusPrimitive {
    pub fn new(
        db: Arc<Mutex<Database>>,
        parent_agent_id: String,
        ask_channels: AskChannels,
    ) -> Self {
        Self {
            db,
            parent_agent_id,
            ask_channels,
        }
    }
}

#[async_trait]
impl Primitive for AgentStatusPrimitive {
    fn name(&self) -> &str {
        "agent.status"
    }

    fn description(&self) -> &str {
        "Check the status of a sub-agent, including any pending questions."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "sub_agent_id": {
                    "type": "string",
                    "description": "The ID of the sub-agent to check"
                }
            },
            "required": ["sub_agent_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let sub_agent_id = params
            .get("sub_agent_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'sub_agent_id'".into()))?;

        tracing::debug!(sub_agent_id, parent_agent_id = %self.parent_agent_id, "Checking sub-agent status");

        let agent = {
            let db = self
                .db
                .lock()
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            db.agents()
                .find_by_id(sub_agent_id)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
                .ok_or_else(|| PrimitiveError::NotFound(format!("sub-agent '{sub_agent_id}'")))?
        };

        // Security: verify this is actually a child of the requesting agent
        if agent.parent_agent_id.as_deref() != Some(&self.parent_agent_id) {
            tracing::warn!(sub_agent_id, parent_agent_id = %self.parent_agent_id, "Ownership check failed for sub-agent status");
            return Err(PrimitiveError::AccessDenied(format!(
                "agent '{sub_agent_id}' is not a child of '{}'",
                self.parent_agent_id
            )));
        }

        // Check for pending questions in ask_channels
        let has_pending_question = self
            .ask_channels
            .lock()
            .ok()
            .map(|channels| !channels.is_empty())
            .unwrap_or(false);

        Ok(serde_json::json!({
            "sub_agent_id": sub_agent_id,
            "status": agent.status,
            "has_pending_question": has_pending_question,
        }))
    }
}

/// Primitive that lists all sub-agents of the current agent.
pub struct AgentListPrimitive {
    db: Arc<Mutex<Database>>,
    parent_agent_id: String,
}

impl AgentListPrimitive {
    pub fn new(db: Arc<Mutex<Database>>, parent_agent_id: String) -> Self {
        Self {
            db,
            parent_agent_id,
        }
    }
}

#[async_trait]
impl Primitive for AgentListPrimitive {
    fn name(&self) -> &str {
        "agent.list"
    }

    fn description(&self) -> &str {
        "List all sub-agents spawned by the current agent."
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
        tracing::debug!(parent_agent_id = %self.parent_agent_id, "Listing sub-agents");

        let children = {
            let db = self
                .db
                .lock()
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            db.agents()
                .find_by_parent(&self.parent_agent_id)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
        };

        let agents: Vec<serde_json::Value> = children
            .iter()
            .map(|a| {
                serde_json::json!({
                    "id": a.id,
                    "status": a.status,
                    "depth": a.depth,
                    "created_at": a.created_at,
                })
            })
            .collect();

        Ok(serde_json::json!({
            "agents": agents,
            "count": agents.len(),
        }))
    }
}

/// Primitive that lets a parent agent stop a sub-agent.
pub struct AgentStopPrimitive {
    db: Arc<Mutex<Database>>,
    parent_agent_id: String,
    run_starter: Arc<dyn RunStarter>,
}

impl AgentStopPrimitive {
    pub fn new(
        db: Arc<Mutex<Database>>,
        parent_agent_id: String,
        run_starter: Arc<dyn RunStarter>,
    ) -> Self {
        Self {
            db,
            parent_agent_id,
            run_starter,
        }
    }
}

#[async_trait]
impl Primitive for AgentStopPrimitive {
    fn name(&self) -> &str {
        "agent.stop"
    }

    fn description(&self) -> &str {
        "Stop a running sub-agent."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "sub_agent_id": {
                    "type": "string",
                    "description": "The ID of the sub-agent to stop"
                }
            },
            "required": ["sub_agent_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let sub_agent_id = params
            .get("sub_agent_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'sub_agent_id'".into()))?;

        tracing::info!(sub_agent_id, parent_agent_id = %self.parent_agent_id, "Stopping sub-agent");

        // Verify ownership
        let agent = {
            let db = self
                .db
                .lock()
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
            db.agents()
                .find_by_id(sub_agent_id)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
                .ok_or_else(|| PrimitiveError::NotFound(format!("sub-agent '{sub_agent_id}'")))?
        };

        if agent.parent_agent_id.as_deref() != Some(&self.parent_agent_id) {
            tracing::warn!(sub_agent_id, parent_agent_id = %self.parent_agent_id, "Ownership check failed for sub-agent stop");
            return Err(PrimitiveError::AccessDenied(format!(
                "agent '{sub_agent_id}' is not a child of '{}'",
                self.parent_agent_id
            )));
        }

        self.run_starter
            .stop_agent(sub_agent_id)
            .await
            .map_err(PrimitiveError::ExecutionFailed)?;

        Ok(serde_json::json!({
            "sub_agent_id": sub_agent_id,
            "status": "stopped",
        }))
    }
}

/// Primitive that lets a parent agent dismiss (delete) a completed sub-agent.
/// The orchestrator calls this after confirming the sub-agent's work is done.
pub struct AgentDismissPrimitive {
    db: Arc<Mutex<Database>>,
    parent_agent_id: String,
}

impl AgentDismissPrimitive {
    pub fn new(db: Arc<Mutex<Database>>, parent_agent_id: String) -> Self {
        Self {
            db,
            parent_agent_id,
        }
    }
}

#[async_trait]
impl Primitive for AgentDismissPrimitive {
    fn name(&self) -> &str {
        "agent.dismiss"
    }

    fn description(&self) -> &str {
        "Dismiss a completed sub-agent, removing it permanently. Use after confirming the sub-agent's work is done."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "sub_agent_id": {
                    "type": "string",
                    "description": "The ID of the sub-agent to dismiss"
                }
            },
            "required": ["sub_agent_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let sub_agent_id = params
            .get("sub_agent_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'sub_agent_id'".into()))?;

        tracing::info!(sub_agent_id, parent_agent_id = %self.parent_agent_id, "Dismissing sub-agent");

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let agent = db
            .agents()
            .find_by_id(sub_agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?
            .ok_or_else(|| PrimitiveError::NotFound(format!("sub-agent '{sub_agent_id}'")))?;

        // Security: verify this is actually a child of the requesting agent
        if agent.parent_agent_id.as_deref() != Some(&self.parent_agent_id) {
            return Err(PrimitiveError::AccessDenied(format!(
                "agent '{sub_agent_id}' is not a child of '{}'",
                self.parent_agent_id
            )));
        }

        // Refuse to dismiss a running agent
        if agent.status == "running" {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "sub-agent '{sub_agent_id}' is still running; stop it first"
            )));
        }

        db.agents()
            .delete(sub_agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        db.agents()
            .decrement_spawned_total(&self.parent_agent_id)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        Ok(serde_json::json!({
            "sub_agent_id": sub_agent_id,
            "status": "dismissed",
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_storage::AgentRow;
    use moxxy_test_utils::TestDb;

    fn test_database() -> Database {
        let test_db = TestDb::new();
        let db = Database::new(test_db.into_conn());
        // Insert a provider to satisfy FK constraints
        db.providers()
            .insert(&moxxy_storage::ProviderRow {
                id: "openai".into(),
                display_name: "OpenAI".into(),
                manifest_path: "/tmp/openai.yaml".into(),
                signature: None,
                enabled: true,
                created_at: chrono::Utc::now().to_rfc3339(),
            })
            .unwrap();
        db
    }
    use std::sync::atomic::{AtomicBool, Ordering};

    struct MockRunStarter {
        started: AtomicBool,
        stopped: AtomicBool,
    }

    impl MockRunStarter {
        fn new() -> Self {
            Self {
                started: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
            }
        }
    }

    #[async_trait]
    impl RunStarter for MockRunStarter {
        async fn start_run(&self, _agent_id: &str, _task: &str) -> Result<String, String> {
            self.started.store(true, Ordering::SeqCst);
            Ok("run-123".into())
        }
        async fn stop_agent(&self, _agent_id: &str) -> Result<(), String> {
            self.stopped.store(true, Ordering::SeqCst);
            Ok(())
        }
        fn agent_status(&self, _agent_id: &str) -> Result<Option<String>, String> {
            Ok(Some("idle".into()))
        }
    }

    fn insert_parent(db: &Database) -> AgentRow {
        let now = chrono::Utc::now().to_rfc3339();
        let row = AgentRow {
            id: "parent-1".into(),
            parent_agent_id: None,
            provider_id: "openai".into(),
            model_id: "gpt-4".into(),
            workspace_root: "/tmp/test".into(),
            core_mount: None,
            policy_profile: None,
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            status: "running".into(),
            depth: 0,
            spawned_total: 0,
            created_at: now.clone(),
            updated_at: now,
            name: Some("parent-1".into()),
            persona: None,
        };
        db.agents().insert(&row).unwrap();
        row
    }

    fn insert_child(db: &Database, child_id: &str, parent_id: &str) -> AgentRow {
        let now = chrono::Utc::now().to_rfc3339();
        let row = AgentRow {
            id: child_id.into(),
            parent_agent_id: Some(parent_id.into()),
            provider_id: "openai".into(),
            model_id: "gpt-4".into(),
            workspace_root: "/tmp/test".into(),
            core_mount: None,
            policy_profile: None,
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            status: "running".into(),
            depth: 1,
            spawned_total: 0,
            created_at: now.clone(),
            updated_at: now,
            name: None,
            persona: None,
        };
        db.agents().insert(&row).unwrap();
        row
    }

    #[tokio::test]
    async fn agent_spawn_creates_child_and_starts_run() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
        }

        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        let prim = AgentSpawnPrimitive::new(
            db.clone(),
            "parent-1".into(),
            run_starter.clone(),
            bus,
            "/tmp/moxxy".into(),
        );

        let result = prim
            .invoke(serde_json::json!({
                "task": "research something",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert!(val["sub_agent_id"].is_string());
        assert_eq!(val["run_id"], "run-123");
        assert!(run_starter.started.load(Ordering::SeqCst));

        // Verify child exists in DB
        let d = db.lock().unwrap();
        let children = d.agents().find_by_parent("parent-1").unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].depth, 1);
    }

    #[tokio::test]
    async fn agent_spawn_respects_lineage_limits() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            let row = AgentRow {
                id: "parent-limited".into(),
                parent_agent_id: None,
                provider_id: "openai".into(),
                model_id: "gpt-4".into(),
                workspace_root: "/tmp/test".into(),
                core_mount: None,
                policy_profile: None,
                temperature: 0.7,
                max_subagent_depth: 0,
                max_subagents_total: 0,
                status: "running".into(),
                depth: 0,
                spawned_total: 0,
                created_at: now.clone(),
                updated_at: now,
                name: Some("parent-limited".into()),
                persona: None,
            };
            d.agents().insert(&row).unwrap();
        }

        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        let prim = AgentSpawnPrimitive::new(
            db,
            "parent-limited".into(),
            run_starter,
            bus,
            "/tmp/moxxy".into(),
        );

        let result = prim
            .invoke(serde_json::json!({
                "task": "should fail",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn agent_status_returns_status_for_child() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
            insert_child(&d, "child-1", "parent-1");
        }

        let channels = super::super::ask::new_ask_channels();
        let prim = AgentStatusPrimitive::new(db, "parent-1".into(), channels);

        let result = prim
            .invoke(serde_json::json!({
                "sub_agent_id": "child-1",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["sub_agent_id"], "child-1");
        assert_eq!(val["status"], "running");
    }

    #[tokio::test]
    async fn agent_status_rejects_non_child() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
            // Insert an agent with no parent (so it's not a child of parent-1)
            let now = chrono::Utc::now().to_rfc3339();
            let other = AgentRow {
                id: "other-agent".into(),
                parent_agent_id: None,
                provider_id: "openai".into(),
                model_id: "gpt-4".into(),
                workspace_root: "/tmp".into(),
                core_mount: None,
                policy_profile: None,
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                status: "idle".into(),
                depth: 1,
                spawned_total: 0,
                created_at: now.clone(),
                updated_at: now,
                name: None,
                persona: None,
            };
            d.agents().insert(&other).unwrap();
        }

        let channels = super::super::ask::new_ask_channels();
        let prim = AgentStatusPrimitive::new(db, "parent-1".into(), channels);

        let result = prim
            .invoke(serde_json::json!({
                "sub_agent_id": "other-agent",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn agent_list_returns_children() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
            insert_child(&d, "child-1", "parent-1");
            insert_child(&d, "child-2", "parent-1");
        }

        let prim = AgentListPrimitive::new(db, "parent-1".into());

        let result = prim.invoke(serde_json::json!({})).await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["count"], 2);
        assert_eq!(val["agents"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn agent_stop_delegates_to_run_starter() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
            insert_child(&d, "child-1", "parent-1");
        }

        let run_starter = Arc::new(MockRunStarter::new());
        let prim = AgentStopPrimitive::new(db, "parent-1".into(), run_starter.clone());

        let result = prim
            .invoke(serde_json::json!({
                "sub_agent_id": "child-1",
            }))
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap()["status"], "stopped");
        assert!(run_starter.stopped.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn agent_dismiss_deletes_idle_child() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
            insert_child(&d, "child-1", "parent-1");
            // Mark child as idle (completed)
            d.agents().update_status("child-1", "idle").unwrap();
            d.agents().increment_spawned_total("parent-1").unwrap();
        }

        let prim = AgentDismissPrimitive::new(db.clone(), "parent-1".into());

        let result = prim
            .invoke(serde_json::json!({
                "sub_agent_id": "child-1",
            }))
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap()["status"], "dismissed");

        // Verify child is deleted
        let d = db.lock().unwrap();
        let found = d.agents().find_by_id("child-1").unwrap();
        assert!(found.is_none());
        // spawned_total decremented
        let parent = d.agents().find_by_id("parent-1").unwrap().unwrap();
        assert_eq!(parent.spawned_total, 0);
    }

    #[tokio::test]
    async fn agent_dismiss_rejects_running_child() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
            insert_child(&d, "child-1", "parent-1");
            // child-1 is "running" by default from insert_child
        }

        let prim = AgentDismissPrimitive::new(db, "parent-1".into());

        let result = prim
            .invoke(serde_json::json!({
                "sub_agent_id": "child-1",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::ExecutionFailed(_)
        ));
    }

    #[tokio::test]
    async fn agent_dismiss_rejects_non_child() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
            let now = chrono::Utc::now().to_rfc3339();
            let other = AgentRow {
                id: "not-my-child".into(),
                parent_agent_id: None,
                provider_id: "openai".into(),
                model_id: "gpt-4".into(),
                workspace_root: "/tmp".into(),
                core_mount: None,
                policy_profile: None,
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                created_at: now.clone(),
                updated_at: now,
                name: Some("not-my-child".into()),
                persona: None,
            };
            d.agents().insert(&other).unwrap();
        }

        let prim = AgentDismissPrimitive::new(db, "parent-1".into());

        let result = prim
            .invoke(serde_json::json!({
                "sub_agent_id": "not-my-child",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn agent_stop_rejects_non_child() {
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
            let now = chrono::Utc::now().to_rfc3339();
            let other = AgentRow {
                id: "not-my-child".into(),
                parent_agent_id: None,
                provider_id: "openai".into(),
                model_id: "gpt-4".into(),
                workspace_root: "/tmp".into(),
                core_mount: None,
                policy_profile: None,
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                created_at: now.clone(),
                updated_at: now,
                name: None,
                persona: None,
            };
            d.agents().insert(&other).unwrap();
        }

        let run_starter = Arc::new(MockRunStarter::new());
        let prim = AgentStopPrimitive::new(db, "parent-1".into(), run_starter);

        let result = prim
            .invoke(serde_json::json!({
                "sub_agent_id": "not-my-child",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn agent_spawn_empty_model_id_inherits_parent() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
        }

        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        let prim = AgentSpawnPrimitive::new(
            db.clone(),
            "parent-1".into(),
            run_starter,
            bus,
            tmp.path().to_path_buf(),
        );

        let result = prim
            .invoke(serde_json::json!({
                "task": "test task",
                "model_id": "",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        let child_id = val["sub_agent_id"].as_str().unwrap();

        // Verify child inherited parent's model_id, not empty string
        let d = db.lock().unwrap();
        let child = d.agents().find_by_id(child_id).unwrap().unwrap();
        assert_eq!(child.model_id, "gpt-4");
    }

    #[tokio::test]
    async fn agent_spawn_creates_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let moxxy_home = tmp.path().join("moxxy");

        // Create a git repo to use as the source
        let repo_dir = tmp.path().join("my-repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        let init_output = std::process::Command::new("git")
            .args(["init"])
            .current_dir(&repo_dir)
            .output()
            .unwrap();
        assert!(init_output.status.success(), "git init failed");

        // Need at least one commit for worktree to work
        std::fs::write(repo_dir.join("README.md"), "# Test").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_dir)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args([
                "-c", "user.name=test",
                "-c", "user.email=test@test.com",
                "commit", "-m", "init",
            ])
            .current_dir(&repo_dir)
            .output()
            .unwrap();

        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
        }

        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        let prim = AgentSpawnPrimitive::new(
            db.clone(),
            "parent-1".into(),
            run_starter,
            bus,
            moxxy_home,
        );

        let result = prim
            .invoke(serde_json::json!({
                "task": "work on feature",
                "repo_path": repo_dir.to_str().unwrap(),
                "branch": "feature-test",
            }))
            .await;

        assert!(result.is_ok(), "spawn failed: {:?}", result.err());
        let val = result.unwrap();
        let child_id = val["sub_agent_id"].as_str().unwrap();

        // Verify worktree was created in child workspace
        let child_workspace = tmp
            .path()
            .join("moxxy/agents")
            .join(child_id)
            .join("workspace/my-repo");
        assert!(child_workspace.exists(), "worktree directory should exist");
        assert!(
            child_workspace.join(".git").is_file(),
            ".git should be a file (worktree marker)"
        );
        assert!(
            child_workspace.join("README.md").exists(),
            "README.md should be present from main branch"
        );

        // Clean up worktree
        let _ = std::process::Command::new("git")
            .args(["worktree", "remove", "--force"])
            .arg(&child_workspace)
            .current_dir(&repo_dir)
            .output();
    }

    #[tokio::test]
    async fn agent_spawn_succeeds_with_invalid_repo_path() {
        let tmp = tempfile::tempdir().unwrap();
        let moxxy_home = tmp.path().join("moxxy");

        // Point repo_path to a plain directory (not a git repo)
        let not_a_repo = tmp.path().join("not-a-repo");
        std::fs::create_dir_all(&not_a_repo).unwrap();

        let db = Arc::new(Mutex::new(test_database()));
        {
            let d = db.lock().unwrap();
            insert_parent(&d);
        }

        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        let prim = AgentSpawnPrimitive::new(
            db.clone(),
            "parent-1".into(),
            run_starter.clone(),
            bus,
            moxxy_home,
        );

        let result = prim
            .invoke(serde_json::json!({
                "task": "fetch news",
                "repo_path": not_a_repo.to_str().unwrap(),
            }))
            .await;

        // Should succeed — worktree failure is non-fatal
        assert!(result.is_ok(), "spawn should not fail when repo_path is invalid: {:?}", result.err());
        let val = result.unwrap();
        assert!(val["sub_agent_id"].is_string());
        assert!(run_starter.started.load(Ordering::SeqCst));
    }
}
