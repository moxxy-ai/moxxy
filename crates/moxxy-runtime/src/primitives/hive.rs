use async_trait::async_trait;
use moxxy_core::EventBus;
use moxxy_types::{EventEnvelope, EventType, RunStarter};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;

use crate::registry::{Primitive, PrimitiveError};

// ──────────────────────────── Data Types ────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HiveManifest {
    pub id: String,
    pub queen_agent_id: String,
    pub name: String,
    pub status: String,
    pub strategy: String,
    pub members: Vec<HiveMember>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HiveMember {
    pub agent_id: String,
    pub role: String,
    pub specialty: Option<String>,
    pub status: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HiveMembership {
    pub hive_id: String,
    pub hive_path: String,
    pub role: String,
    pub specialty: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HiveSignal {
    pub id: String,
    pub author_agent_id: String,
    pub signal_type: String,
    pub content: String,
    pub quality_score: f64,
    pub tags: Vec<String>,
    pub parent_signal_id: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HiveTask {
    pub id: String,
    pub assigned_agent_id: Option<String>,
    pub title: String,
    pub description: String,
    pub task_type: String,
    pub priority: i32,
    pub status: String,
    pub depends_on: Option<Vec<String>>,
    pub result_summary: Option<String>,
    #[serde(default)]
    pub attempt_count: u32,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default)]
    pub failure_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn default_max_retries() -> u32 {
    3
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HiveProposal {
    pub id: String,
    pub proposer_agent_id: String,
    pub title: String,
    pub description: String,
    pub proposal_type: String,
    pub status: String,
    pub quorum_required: i32,
    pub expires_at: Option<String>,
    pub resolution: Option<String>,
    pub votes: Vec<HiveVote>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HiveVote {
    pub voter_agent_id: String,
    pub vote: String,
    pub confidence: f64,
    pub reasoning: Option<String>,
    pub created_at: String,
}

// ──────────────────────────── HiveStore ────────────────────────────

pub struct HiveStore {
    pub hive_path: PathBuf,
}

impl HiveStore {
    pub fn new(hive_path: PathBuf) -> Self {
        Self { hive_path }
    }

    pub fn read_manifest(&self) -> Result<HiveManifest, PrimitiveError> {
        let path = self.hive_path.join("hive.yaml");
        let data = std::fs::read_to_string(&path)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("read manifest: {e}")))?;
        serde_yaml::from_str(&data)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("parse manifest: {e}")))
    }

    pub fn write_manifest(&self, manifest: &HiveManifest) -> Result<(), PrimitiveError> {
        let path = self.hive_path.join("hive.yaml");
        let data = serde_yaml::to_string(manifest)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("serialize manifest: {e}")))?;
        std::fs::write(&path, data)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("write manifest: {e}")))
    }

    pub fn add_signal(&self, signal: &HiveSignal) -> Result<(), PrimitiveError> {
        let dir = self.hive_path.join("board");
        std::fs::create_dir_all(&dir)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("create board dir: {e}")))?;
        let path = dir.join(format!("{}.yaml", signal.id));
        let data = serde_yaml::to_string(signal)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("serialize signal: {e}")))?;
        std::fs::write(&path, data)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("write signal: {e}")))
    }

    pub fn read_signals(
        &self,
        signal_type: Option<&str>,
        tag: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<HiveSignal>, PrimitiveError> {
        let dir = self.hive_path.join("board");
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut signals = Vec::new();
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("read board dir: {e}")))?;
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let data = std::fs::read_to_string(entry.path())
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("read signal: {e}")))?;
            let signal: HiveSignal = serde_yaml::from_str(&data)
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("parse signal: {e}")))?;
            if let Some(st) = signal_type
                && signal.signal_type != st
            {
                continue;
            }
            if let Some(t) = tag
                && !signal.tags.iter().any(|s| s == t)
            {
                continue;
            }
            signals.push(signal);
        }
        signals.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        if let Some(lim) = limit {
            signals.truncate(lim);
        }
        Ok(signals)
    }

    pub fn add_task(&self, task: &HiveTask) -> Result<(), PrimitiveError> {
        let dir = self.hive_path.join("tasks");
        std::fs::create_dir_all(&dir)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("create tasks dir: {e}")))?;
        let path = dir.join(format!("{}.yaml", task.id));
        let data = serde_yaml::to_string(task)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("serialize task: {e}")))?;
        std::fs::write(&path, data)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("write task: {e}")))
    }

    pub fn read_task(&self, task_id: &str) -> Result<HiveTask, PrimitiveError> {
        let path = self.hive_path.join("tasks").join(format!("{task_id}.yaml"));
        let data = std::fs::read_to_string(&path)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("read task: {e}")))?;
        serde_yaml::from_str(&data)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("parse task: {e}")))
    }

    pub fn write_task(&self, task: &HiveTask) -> Result<(), PrimitiveError> {
        self.add_task(task)
    }

    pub fn list_tasks(&self, status: Option<&str>) -> Result<Vec<HiveTask>, PrimitiveError> {
        let dir = self.hive_path.join("tasks");
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut tasks = Vec::new();
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("read tasks dir: {e}")))?;
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let data = std::fs::read_to_string(entry.path())
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("read task: {e}")))?;
            let task: HiveTask = serde_yaml::from_str(&data)
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("parse task: {e}")))?;
            if let Some(s) = status
                && task.status != s
            {
                continue;
            }
            tasks.push(task);
        }
        tasks.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(tasks)
    }

    pub fn add_proposal(&self, proposal: &HiveProposal) -> Result<(), PrimitiveError> {
        let dir = self.hive_path.join("proposals");
        std::fs::create_dir_all(&dir)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("create proposals dir: {e}")))?;
        let path = dir.join(format!("{}.yaml", proposal.id));
        let data = serde_yaml::to_string(proposal)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("serialize proposal: {e}")))?;
        std::fs::write(&path, data)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("write proposal: {e}")))
    }

    pub fn read_proposal(&self, proposal_id: &str) -> Result<HiveProposal, PrimitiveError> {
        let path = self
            .hive_path
            .join("proposals")
            .join(format!("{proposal_id}.yaml"));
        let data = std::fs::read_to_string(&path)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("read proposal: {e}")))?;
        serde_yaml::from_str(&data)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("parse proposal: {e}")))
    }

    pub fn write_proposal(&self, proposal: &HiveProposal) -> Result<(), PrimitiveError> {
        self.add_proposal(proposal)
    }

    pub fn list_proposals(
        &self,
        status: Option<&str>,
    ) -> Result<Vec<HiveProposal>, PrimitiveError> {
        let dir = self.hive_path.join("proposals");
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut proposals = Vec::new();
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("read proposals dir: {e}")))?;
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let data = std::fs::read_to_string(entry.path())
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("read proposal: {e}")))?;
            let proposal: HiveProposal = serde_yaml::from_str(&data)
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("parse proposal: {e}")))?;
            if let Some(s) = status
                && proposal.status != s
            {
                continue;
            }
            proposals.push(proposal);
        }
        proposals.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(proposals)
    }
}

// ──────────────────────────── Primitives ────────────────────────────

/// hive.create - Creates a new hive with the calling agent as queen.
pub struct HiveCreatePrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    event_bus: EventBus,
}

impl HiveCreatePrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf, event_bus: EventBus) -> Self {
        Self {
            agent_id,
            workspace_dir,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveCreatePrimitive {
    fn name(&self) -> &str {
        "hive.create"
    }

    fn description(&self) -> &str {
        "Create a new hive swarm. You become the queen who coordinates workers."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name for the hive"
                },
                "strategy": {
                    "type": "string",
                    "description": "Coordination strategy: 'consensus', 'dictator', or 'swarm'",
                    "enum": ["consensus", "dictator", "swarm"]
                }
            },
            "required": ["name", "strategy"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let name = params
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'name'".into()))?;
        let strategy = params
            .get("strategy")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'strategy'".into()))?;

        let hive_dir = self.workspace_dir.join(".hive");
        if hive_dir.join("hive.yaml").exists() {
            return Err(PrimitiveError::ExecutionFailed(
                "this agent already has a hive".into(),
            ));
        }

        std::fs::create_dir_all(&hive_dir)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("create .hive dir: {e}")))?;

        let hive_id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let manifest = HiveManifest {
            id: hive_id.clone(),
            queen_agent_id: self.agent_id.clone(),
            name: name.to_string(),
            status: "active".into(),
            strategy: strategy.to_string(),
            members: vec![HiveMember {
                agent_id: self.agent_id.clone(),
                role: "queen".into(),
                specialty: None,
                status: "active".into(),
            }],
            created_at: now,
        };

        let store = HiveStore::new(hive_dir.clone());
        store.write_manifest(&manifest)?;

        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::HiveCreated,
            serde_json::json!({
                "hive_id": hive_id,
                "name": name,
                "strategy": strategy,
            }),
        ));

        Ok(serde_json::json!({
            "hive_id": hive_id,
            "hive_path": hive_dir.display().to_string(),
            "status": "created",
        }))
    }
}

/// hive.recruit - Queen spawns a worker via RunStarter::spawn_child.
pub struct HiveRecruitPrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    run_starter: Arc<dyn RunStarter>,
    event_bus: EventBus,
}

impl HiveRecruitPrimitive {
    pub fn new(
        agent_id: String,
        workspace_dir: PathBuf,
        run_starter: Arc<dyn RunStarter>,
        event_bus: EventBus,
    ) -> Self {
        Self {
            agent_id,
            workspace_dir,
            run_starter,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveRecruitPrimitive {
    fn name(&self) -> &str {
        "hive.recruit"
    }

    fn description(&self) -> &str {
        "Recruit a new worker agent into the hive. Spawns a sub-agent and writes its membership file."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "The task for the recruited worker"
                },
                "role": {
                    "type": "string",
                    "description": "Role in the hive: 'worker' or 'scout'",
                    "enum": ["worker", "scout"]
                },
                "specialty": {
                    "type": "string",
                    "description": "Optional specialty description (e.g. 'code-review', 'testing')"
                },
                "model_id": {
                    "type": "string",
                    "description": "Optional model override"
                }
            },
            "required": ["task", "role"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let task = params
            .get("task")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'task'".into()))?
            .to_string();
        let role = params
            .get("role")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'role'".into()))?
            .to_string();
        let specialty = params
            .get("specialty")
            .and_then(|v| v.as_str())
            .map(String::from);

        let hive_dir = self.workspace_dir.join(".hive");
        let store = HiveStore::new(hive_dir.clone());
        let mut manifest = store.read_manifest()?;

        if manifest.queen_agent_id != self.agent_id {
            return Err(PrimitiveError::AccessDenied(
                "only the queen can recruit".into(),
            ));
        }

        let model_id = params
            .get("model_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from);

        let hive_role = match role.as_str() {
            "scout" => moxxy_types::HiveRole::Scout,
            _ => moxxy_types::HiveRole::Worker,
        };

        // Build contextualized task with hive instructions and workspace context
        let specialty_note = specialty
            .as_deref()
            .map(|s| format!(" Specialty: {s}."))
            .unwrap_or_default();

        // List workspace root to give workers initial context
        let workspace_listing = std::fs::read_dir(&self.workspace_dir)
            .ok()
            .map(|entries| {
                let items: Vec<String> = entries
                    .flatten()
                    .filter_map(|e| e.file_name().into_string().ok())
                    .take(20)
                    .collect();
                if items.is_empty() {
                    String::new()
                } else {
                    format!("\nWorkspace contents: {}\n", items.join(", "))
                }
            })
            .unwrap_or_default();

        let contextualized_task = format!(
            "[Hive Worker] You are a hive {role} agent.{specialty_note}\n\
             Workflow: hive.task_list → pick a non-blocked pending task → hive.task_claim → do work → hive.task_complete.\n\
             If a task is blocked (dependencies not yet completed), pick another task or wait.\n\
             After completing a task, ALWAYS check hive.task_list for more unclaimed tasks - keep working until no tasks remain.\n\
             Use your workspace for all file operations - it is already set up for you.\n\
             {workspace_listing}\n\
             Task from queen: {task}"
        );

        // Spawn via RunStarter
        let result = self
            .run_starter
            .spawn_child(
                &self.agent_id,
                &contextualized_task,
                moxxy_types::SpawnOpts {
                    agent_type: moxxy_types::AgentType::HiveWorker,
                    model_id,
                    hive_role: Some(hive_role),
                    plan_mode: false,
                    isolation: moxxy_types::WorkspaceIsolation::Shared,
                },
            )
            .await
            .map_err(PrimitiveError::ExecutionFailed)?;

        // Update manifest with new member
        manifest.members.push(HiveMember {
            agent_id: result.child_name.clone(),
            role: role.clone(),
            specialty: specialty.clone(),
            status: "active".into(),
        });
        store.write_manifest(&manifest)?;

        // Emit hive-specific event (no generic SubagentSpawned to avoid TUI duplication)
        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::HiveMemberJoined,
            serde_json::json!({
                "hive_id": manifest.id,
                "child_name": result.child_name,
                "role": role,
            }),
        ));

        Ok(serde_json::json!({
            "child_name": result.child_name,
            "run_id": result.run_id,
            "role": role,
        }))
    }
}

/// hive.task_create - Queen creates a task file.
pub struct HiveTaskCreatePrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    event_bus: EventBus,
}

impl HiveTaskCreatePrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf, event_bus: EventBus) -> Self {
        Self {
            agent_id,
            workspace_dir,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveTaskCreatePrimitive {
    fn name(&self) -> &str {
        "hive.task_create"
    }

    fn description(&self) -> &str {
        "Create a new task in the hive task board."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Short human-readable ID for this task (e.g. 'create-data', 'build-frontend'). Use this ID in depends_on of other tasks." },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "task_type": { "type": "string", "description": "e.g. 'work', 'review', 'research'" },
                "priority": { "type": "integer", "description": "1-10, higher = more urgent" },
                "depends_on": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "IDs of tasks this depends on (use the same id you gave those tasks)"
                },
                "max_retries": { "type": "integer", "description": "Max retry attempts before permanent failure (default 3)" }
            },
            "required": ["title", "description", "task_type", "priority"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let title = params
            .get("title")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'title'".into()))?;
        let description = params
            .get("description")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'description'".into()))?;
        let task_type = params
            .get("task_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'task_type'".into()))?;
        let priority = params
            .get("priority")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'priority'".into()))?
            as i32;
        let depends_on = params
            .get("depends_on")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            });
        let max_retries = params
            .get("max_retries")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(default_max_retries());

        let hive_dir = self.workspace_dir.join(".hive");
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;

        if manifest.queen_agent_id != self.agent_id {
            return Err(PrimitiveError::AccessDenied(
                "only the queen can create tasks".into(),
            ));
        }

        let now = chrono::Utc::now().to_rfc3339();
        // Use the caller-supplied id if provided; fall back to UUID.
        let task_id = params
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from)
            .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());

        let task = HiveTask {
            id: task_id.clone(),
            assigned_agent_id: None,
            title: title.to_string(),
            description: description.to_string(),
            task_type: task_type.to_string(),
            priority,
            status: "pending".into(),
            depends_on,
            result_summary: None,
            attempt_count: 0,
            max_retries,
            failure_reason: None,
            created_at: now.clone(),
            updated_at: now,
        };

        store.add_task(&task)?;

        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::HiveTaskCreated,
            serde_json::json!({
                "hive_id": manifest.id,
                "task_id": task_id,
                "title": title,
                "priority": priority,
            }),
        ));

        Ok(serde_json::json!({
            "task_id": task_id,
            "status": "created",
        }))
    }
}

/// hive.assign - Queen assigns a task to a specific member.
pub struct HiveAssignPrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
}

impl HiveAssignPrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf) -> Self {
        Self {
            agent_id,
            workspace_dir,
        }
    }
}

#[async_trait]
impl Primitive for HiveAssignPrimitive {
    fn name(&self) -> &str {
        "hive.assign"
    }

    fn description(&self) -> &str {
        "Assign a task to a specific hive member."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "agent_id": { "type": "string", "description": "The member to assign the task to" }
            },
            "required": ["task_id", "agent_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let task_id = params
            .get("task_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'task_id'".into()))?;
        let assignee_id = params
            .get("agent_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'agent_id'".into()))?;

        let hive_dir = self.workspace_dir.join(".hive");
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;

        if manifest.queen_agent_id != self.agent_id {
            return Err(PrimitiveError::AccessDenied(
                "only the queen can assign tasks".into(),
            ));
        }

        if !manifest.members.iter().any(|m| m.agent_id == assignee_id) {
            return Err(PrimitiveError::InvalidParams(
                "agent is not a hive member".into(),
            ));
        }

        let mut task = store.read_task(task_id)?;
        task.assigned_agent_id = Some(assignee_id.to_string());
        task.status = "assigned".into();
        task.updated_at = chrono::Utc::now().to_rfc3339();
        store.write_task(&task)?;

        Ok(serde_json::json!({
            "task_id": task_id,
            "assigned_to": assignee_id,
            "status": "assigned",
        }))
    }
}

/// hive.aggregate - Queen reads all state (tasks, signals, proposals) as a snapshot.
pub struct HiveAggregatePrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
}

impl HiveAggregatePrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf) -> Self {
        Self {
            agent_id,
            workspace_dir,
        }
    }
}

#[async_trait]
impl Primitive for HiveAggregatePrimitive {
    fn name(&self) -> &str {
        "hive.aggregate"
    }

    fn description(&self) -> &str {
        "Get a complete snapshot of the hive: manifest, all tasks, signals, and proposals."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
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
        let hive_dir = self.workspace_dir.join(".hive");
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;

        if manifest.queen_agent_id != self.agent_id {
            return Err(PrimitiveError::AccessDenied(
                "only the queen can aggregate".into(),
            ));
        }

        let tasks = store.list_tasks(None)?;
        let signals = store.read_signals(None, None, None)?;
        let proposals = store.list_proposals(None)?;

        Ok(serde_json::json!({
            "manifest": manifest,
            "tasks": tasks,
            "signals": signals,
            "proposals": proposals,
        }))
    }
}

/// hive.resolve_proposal - Queen resolves an open proposal.
pub struct HiveResolveProposalPrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    event_bus: EventBus,
}

impl HiveResolveProposalPrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf, event_bus: EventBus) -> Self {
        Self {
            agent_id,
            workspace_dir,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveResolveProposalPrimitive {
    fn name(&self) -> &str {
        "hive.resolve_proposal"
    }

    fn description(&self) -> &str {
        "Resolve an open proposal with a decision."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "proposal_id": { "type": "string" },
                "status": {
                    "type": "string",
                    "enum": ["approved", "rejected"],
                    "description": "Resolution status"
                },
                "resolution": { "type": "string", "description": "Explanation of the decision" }
            },
            "required": ["proposal_id", "status", "resolution"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let proposal_id = params
            .get("proposal_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'proposal_id'".into()))?;
        let status = params
            .get("status")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'status'".into()))?;
        let resolution = params
            .get("resolution")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'resolution'".into()))?;

        let hive_dir = self.workspace_dir.join(".hive");
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;

        if manifest.queen_agent_id != self.agent_id {
            return Err(PrimitiveError::AccessDenied(
                "only the queen can resolve proposals".into(),
            ));
        }

        let mut proposal = store.read_proposal(proposal_id)?;
        proposal.status = status.to_string();
        proposal.resolution = Some(resolution.to_string());
        proposal.updated_at = chrono::Utc::now().to_rfc3339();
        store.write_proposal(&proposal)?;

        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::HiveProposalResolved,
            serde_json::json!({
                "hive_id": manifest.id,
                "proposal_id": proposal_id,
                "status": status,
            }),
        ));

        Ok(serde_json::json!({
            "proposal_id": proposal_id,
            "status": status,
            "resolution": resolution,
        }))
    }
}

/// hive.disband - Queen disbands the hive, stopping all workers.
pub struct HiveDisbandPrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    run_starter: Arc<dyn RunStarter>,
    event_bus: EventBus,
}

impl HiveDisbandPrimitive {
    pub fn new(
        agent_id: String,
        workspace_dir: PathBuf,
        run_starter: Arc<dyn RunStarter>,
        event_bus: EventBus,
    ) -> Self {
        Self {
            agent_id,
            workspace_dir,
            run_starter,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveDisbandPrimitive {
    fn name(&self) -> &str {
        "hive.disband"
    }

    fn description(&self) -> &str {
        "Disband the hive, stopping all worker agents."
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
        let hive_dir = self.workspace_dir.join(".hive");
        let store = HiveStore::new(hive_dir);
        let mut manifest = store.read_manifest()?;

        if manifest.queen_agent_id != self.agent_id {
            return Err(PrimitiveError::AccessDenied(
                "only the queen can disband".into(),
            ));
        }

        // Stop all non-queen members
        for member in &mut manifest.members {
            if member.agent_id != self.agent_id && member.status == "active" {
                let _ = self.run_starter.stop_agent(&member.agent_id).await;
                member.status = "disbanded".into();
            }
        }

        manifest.status = "disbanded".into();
        store.write_manifest(&manifest)?;

        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::HiveDisbanded,
            serde_json::json!({
                "hive_id": manifest.id,
            }),
        ));

        Ok(serde_json::json!({
            "hive_id": manifest.id,
            "status": "disbanded",
        }))
    }
}

// ──────────────────── Member Primitives (all members) ────────────────────

/// Helper to resolve the hive path from the workspace's `.hive/` directory.
/// Both queen and worker agents share the same workspace, so both resolve to the same `.hive/` dir.
fn resolve_hive_dir(workspace_dir: &std::path::Path) -> Result<PathBuf, PrimitiveError> {
    let hive_dir = workspace_dir.join(".hive");
    if hive_dir.join("hive.yaml").exists() {
        return Ok(hive_dir);
    }
    Err(PrimitiveError::ExecutionFailed(
        "agent is not part of a hive".into(),
    ))
}

/// hive.signal - Post a signal to the hive board.
pub struct HiveSignalPrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    event_bus: EventBus,
}

impl HiveSignalPrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf, event_bus: EventBus) -> Self {
        Self {
            agent_id,
            workspace_dir,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveSignalPrimitive {
    fn name(&self) -> &str {
        "hive.signal"
    }

    fn description(&self) -> &str {
        "Post a signal (finding, question, status update) to the hive board."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "signal_type": {
                    "type": "string",
                    "description": "Type: 'finding', 'question', 'status', 'alert', 'result'"
                },
                "content": { "type": "string" },
                "quality_score": {
                    "type": "number",
                    "description": "Self-assessed quality 0.0-1.0"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" }
                },
                "parent_signal_id": {
                    "type": "string",
                    "description": "ID of signal this replies to"
                }
            },
            "required": ["signal_type", "content"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let signal_type = params
            .get("signal_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'signal_type'".into()))?;
        let content = params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content'".into()))?;
        let quality_score = params
            .get("quality_score")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        let tags: Vec<String> = params
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let parent_signal_id = params
            .get("parent_signal_id")
            .and_then(|v| v.as_str())
            .map(String::from);

        let hive_dir = resolve_hive_dir(&self.workspace_dir)?;
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;

        let signal_id = uuid::Uuid::now_v7().to_string();
        let signal = HiveSignal {
            id: signal_id.clone(),
            author_agent_id: self.agent_id.clone(),
            signal_type: signal_type.to_string(),
            content: content.to_string(),
            quality_score,
            tags,
            parent_signal_id,
            status: "active".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        store.add_signal(&signal)?;

        self.event_bus.emit(EventEnvelope::new(
            manifest.queen_agent_id.clone(),
            None,
            None,
            0,
            EventType::HiveSignalPosted,
            serde_json::json!({
                "hive_id": manifest.id,
                "signal_id": signal_id,
                "author": self.agent_id,
                "signal_type": signal_type,
            }),
        ));

        Ok(serde_json::json!({
            "signal_id": signal_id,
            "status": "posted",
        }))
    }
}

/// hive.board_read - Read signals from the hive board.
pub struct HiveBoardReadPrimitive {
    workspace_dir: PathBuf,
}

impl HiveBoardReadPrimitive {
    pub fn new(workspace_dir: PathBuf) -> Self {
        Self { workspace_dir }
    }
}

#[async_trait]
impl Primitive for HiveBoardReadPrimitive {
    fn name(&self) -> &str {
        "hive.board_read"
    }

    fn description(&self) -> &str {
        "Read signals from the hive board, optionally filtering by type or tag."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "signal_type": { "type": "string", "description": "Filter by signal type" },
                "tag": { "type": "string", "description": "Filter by tag" },
                "limit": { "type": "integer", "description": "Max signals to return" }
            }
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let signal_type = params.get("signal_type").and_then(|v| v.as_str());
        let tag = params.get("tag").and_then(|v| v.as_str());
        let limit = params
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize);

        let hive_dir = resolve_hive_dir(&self.workspace_dir)?;
        let store = HiveStore::new(hive_dir);
        let signals = store.read_signals(signal_type, tag, limit)?;

        Ok(serde_json::json!({
            "signals": signals,
            "count": signals.len(),
        }))
    }
}

/// hive.task_list - List tasks from the hive.
pub struct HiveTaskListPrimitive {
    workspace_dir: PathBuf,
}

impl HiveTaskListPrimitive {
    pub fn new(workspace_dir: PathBuf) -> Self {
        Self { workspace_dir }
    }
}

#[async_trait]
impl Primitive for HiveTaskListPrimitive {
    fn name(&self) -> &str {
        "hive.task_list"
    }

    fn description(&self) -> &str {
        "List tasks in the hive, optionally filtering by status."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "status": { "type": "string", "description": "Filter by status: 'pending', 'assigned', 'in_progress', 'completed'" }
            }
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let status = params.get("status").and_then(|v| v.as_str());

        let hive_dir = resolve_hive_dir(&self.workspace_dir)?;
        let store = HiveStore::new(hive_dir);
        let tasks = store.list_tasks(status)?;

        // Build set of completed task IDs to compute blocked status
        let all_tasks = store.list_tasks(None)?;
        let completed_ids: std::collections::HashSet<&str> = all_tasks
            .iter()
            .filter(|t| t.status == "completed")
            .map(|t| t.id.as_str())
            .collect();

        let enriched: Vec<serde_json::Value> = tasks
            .iter()
            .map(|t| {
                let blocked = t
                    .depends_on
                    .as_ref()
                    .is_some_and(|deps| deps.iter().any(|d| !completed_ids.contains(d.as_str())));
                let mut val = serde_json::to_value(t).unwrap();
                val.as_object_mut()
                    .unwrap()
                    .insert("blocked".into(), blocked.into());
                val
            })
            .collect();
        let claimable_count = enriched
            .iter()
            .filter(|v| v["status"] == "pending" && v["blocked"] == false)
            .count();

        Ok(serde_json::json!({
            "tasks": enriched,
            "count": enriched.len(),
            "claimable_count": claimable_count,
        }))
    }
}

/// hive.task_claim - A member claims an unassigned task.
pub struct HiveTaskClaimPrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    event_bus: EventBus,
}

impl HiveTaskClaimPrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf, event_bus: EventBus) -> Self {
        Self {
            agent_id,
            workspace_dir,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveTaskClaimPrimitive {
    fn name(&self) -> &str {
        "hive.task_claim"
    }

    fn description(&self) -> &str {
        "Claim an unassigned task to work on."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" }
            },
            "required": ["task_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let task_id = params
            .get("task_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'task_id'".into()))?;

        let hive_dir = resolve_hive_dir(&self.workspace_dir)?;
        let store = HiveStore::new(hive_dir);
        let mut task = store.read_task(task_id)?;

        if task.status != "pending" {
            return Err(PrimitiveError::ExecutionFailed(
                format!("task cannot be claimed (status: {})", task.status),
            ));
        }

        // Enforce dependency ordering: all depends_on tasks must be completed
        if let Some(deps) = &task.depends_on {
            let mut blockers = Vec::new();
            for dep_id in deps {
                match store.read_task(dep_id) {
                    Ok(dep_task) if dep_task.status != "completed" => {
                        blockers.push(format!("{dep_id} ({})", dep_task.status));
                    }
                    Err(_) => {
                        blockers.push(format!("{dep_id} (not found)"));
                    }
                    _ => {} // completed - OK
                }
            }
            if !blockers.is_empty() {
                return Err(PrimitiveError::ExecutionFailed(format!(
                    "task blocked by incomplete dependencies: {}",
                    blockers.join(", ")
                )));
            }
        }

        task.assigned_agent_id = Some(self.agent_id.clone());
        task.status = "in_progress".into();
        task.attempt_count += 1;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        store.write_task(&task)?;

        let manifest = store.read_manifest()?;
        self.event_bus.emit(EventEnvelope::new(
            manifest.queen_agent_id,
            None,
            None,
            0,
            EventType::HiveTaskClaimed,
            serde_json::json!({
                "hive_id": manifest.id,
                "task_id": task_id,
                "agent_id": self.agent_id,
            }),
        ));

        Ok(serde_json::json!({
            "task_id": task_id,
            "status": "in_progress",
            "assigned_to": self.agent_id,
        }))
    }
}

/// hive.task_complete - Mark a task as completed with a result summary.
pub struct HiveTaskCompletePrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    event_bus: EventBus,
}

impl HiveTaskCompletePrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf, event_bus: EventBus) -> Self {
        Self {
            agent_id,
            workspace_dir,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveTaskCompletePrimitive {
    fn name(&self) -> &str {
        "hive.task_complete"
    }

    fn description(&self) -> &str {
        "Mark a task as completed with a result summary."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "result_summary": { "type": "string", "description": "Summary of what was accomplished" }
            },
            "required": ["task_id", "result_summary"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let task_id = params
            .get("task_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'task_id'".into()))?;
        let result_summary = params
            .get("result_summary")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'result_summary'".into()))?;

        let hive_dir = resolve_hive_dir(&self.workspace_dir)?;
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;
        let mut task = store.read_task(task_id)?;

        if task.assigned_agent_id.as_deref() != Some(&self.agent_id) {
            return Err(PrimitiveError::AccessDenied(
                format!("only the assigned agent can complete this task (assigned: {:?}, you: {})",
                    task.assigned_agent_id, self.agent_id),
            ));
        }

        task.status = "completed".into();
        task.result_summary = Some(result_summary.to_string());
        task.updated_at = chrono::Utc::now().to_rfc3339();
        store.write_task(&task)?;

        self.event_bus.emit(EventEnvelope::new(
            manifest.queen_agent_id,
            None,
            None,
            0,
            EventType::HiveTaskCompleted,
            serde_json::json!({
                "hive_id": manifest.id,
                "task_id": task_id,
                "agent_id": self.agent_id,
            }),
        ));

        Ok(serde_json::json!({
            "task_id": task_id,
            "status": "completed",
        }))
    }
}

/// hive.task_fail - Worker explicitly marks a task as failed.
/// If retries remain (attempt_count < max_retries), resets to "pending" so another worker can try.
/// Otherwise marks the task as permanently "failed".
pub struct HiveTaskFailPrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    event_bus: EventBus,
}

impl HiveTaskFailPrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf, event_bus: EventBus) -> Self {
        Self {
            agent_id,
            workspace_dir,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveTaskFailPrimitive {
    fn name(&self) -> &str {
        "hive.task_fail"
    }

    fn description(&self) -> &str {
        "Mark a task as failed. If retries remain, the task returns to pending for another worker."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "reason": { "type": "string", "description": "Why the task failed" }
            },
            "required": ["task_id", "reason"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let task_id = params
            .get("task_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'task_id'".into()))?;
        let reason = params
            .get("reason")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'reason'".into()))?;

        let hive_dir = resolve_hive_dir(&self.workspace_dir)?;
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;
        let mut task = store.read_task(task_id)?;

        if task.assigned_agent_id.as_deref() != Some(&self.agent_id) {
            return Err(PrimitiveError::AccessDenied(
                format!("only the assigned agent can fail this task (assigned: {:?}, you: {})",
                    task.assigned_agent_id, self.agent_id),
            ));
        }

        task.failure_reason = Some(reason.to_string());
        task.assigned_agent_id = None;
        task.updated_at = chrono::Utc::now().to_rfc3339();

        let retries_exhausted = task.attempt_count >= task.max_retries;
        if retries_exhausted {
            task.status = "failed".into();
        } else {
            task.status = "pending".into();
        }
        store.write_task(&task)?;

        self.event_bus.emit(EventEnvelope::new(
            manifest.queen_agent_id,
            None,
            None,
            0,
            EventType::HiveTaskFailed,
            serde_json::json!({
                "hive_id": manifest.id,
                "task_id": task_id,
                "agent_id": self.agent_id,
                "reason": reason,
                "attempt_count": task.attempt_count,
                "max_retries": task.max_retries,
                "retries_exhausted": retries_exhausted,
            }),
        ));

        Ok(serde_json::json!({
            "task_id": task_id,
            "status": task.status,
            "attempt_count": task.attempt_count,
            "max_retries": task.max_retries,
            "retries_exhausted": retries_exhausted,
        }))
    }
}

/// hive.task_review - Queen reviews a completed task's details and result.
pub struct HiveTaskReviewPrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
}

impl HiveTaskReviewPrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf) -> Self {
        Self {
            agent_id,
            workspace_dir,
        }
    }
}

#[async_trait]
impl Primitive for HiveTaskReviewPrimitive {
    fn name(&self) -> &str {
        "hive.task_review"
    }

    fn description(&self) -> &str {
        "Review a completed task's details, result summary, and assigned worker."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string", "description": "The task ID to review" }
            },
            "required": ["task_id"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let task_id = params
            .get("task_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'task_id'".into()))?;

        let hive_dir = self.workspace_dir.join(".hive");
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;

        if manifest.queen_agent_id != self.agent_id {
            return Err(PrimitiveError::AccessDenied(
                "only the queen can review tasks".into(),
            ));
        }

        let task = store.read_task(task_id)?;

        Ok(serde_json::json!({
            "task_id": task.id,
            "title": task.title,
            "description": task.description,
            "task_type": task.task_type,
            "priority": task.priority,
            "status": task.status,
            "assigned_agent_id": task.assigned_agent_id,
            "result_summary": task.result_summary,
            "depends_on": task.depends_on,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
        }))
    }
}

/// hive.propose - Create a proposal for the hive to vote on.
pub struct HiveProposePrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    event_bus: EventBus,
}

impl HiveProposePrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf, event_bus: EventBus) -> Self {
        Self {
            agent_id,
            workspace_dir,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveProposePrimitive {
    fn name(&self) -> &str {
        "hive.propose"
    }

    fn description(&self) -> &str {
        "Create a proposal for the hive to vote on."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "title": { "type": "string" },
                "description": { "type": "string" },
                "proposal_type": { "type": "string", "description": "e.g. 'decision', 'change', 'resource'" },
                "quorum_required": { "type": "integer", "description": "Minimum votes needed" }
            },
            "required": ["title", "description", "proposal_type", "quorum_required"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let title = params
            .get("title")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'title'".into()))?;
        let description = params
            .get("description")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'description'".into()))?;
        let proposal_type = params
            .get("proposal_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'proposal_type'".into()))?;
        let quorum_required = params
            .get("quorum_required")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'quorum_required'".into()))?
            as i32;

        let hive_dir = resolve_hive_dir(&self.workspace_dir)?;
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;

        let now = chrono::Utc::now().to_rfc3339();
        let proposal_id = uuid::Uuid::now_v7().to_string();

        let proposal = HiveProposal {
            id: proposal_id.clone(),
            proposer_agent_id: self.agent_id.clone(),
            title: title.to_string(),
            description: description.to_string(),
            proposal_type: proposal_type.to_string(),
            status: "open".into(),
            quorum_required,
            expires_at: None,
            resolution: None,
            votes: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        };

        store.add_proposal(&proposal)?;

        self.event_bus.emit(EventEnvelope::new(
            manifest.queen_agent_id,
            None,
            None,
            0,
            EventType::HiveProposalCreated,
            serde_json::json!({
                "hive_id": manifest.id,
                "proposal_id": proposal_id,
                "proposer": self.agent_id,
                "title": title,
            }),
        ));

        Ok(serde_json::json!({
            "proposal_id": proposal_id,
            "status": "open",
        }))
    }
}

/// hive.vote - Cast a vote on a proposal.
pub struct HiveVotePrimitive {
    agent_id: String,
    workspace_dir: PathBuf,
    event_bus: EventBus,
}

impl HiveVotePrimitive {
    pub fn new(agent_id: String, workspace_dir: PathBuf, event_bus: EventBus) -> Self {
        Self {
            agent_id,
            workspace_dir,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for HiveVotePrimitive {
    fn name(&self) -> &str {
        "hive.vote"
    }

    fn description(&self) -> &str {
        "Cast a vote on an open proposal."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "proposal_id": { "type": "string" },
                "vote": {
                    "type": "string",
                    "enum": ["approve", "reject", "abstain"]
                },
                "confidence": {
                    "type": "number",
                    "description": "Confidence level 0.0-1.0"
                },
                "reasoning": { "type": "string" }
            },
            "required": ["proposal_id", "vote", "confidence"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let proposal_id = params
            .get("proposal_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'proposal_id'".into()))?;
        let vote = params
            .get("vote")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'vote'".into()))?;
        let confidence = params
            .get("confidence")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'confidence'".into()))?;
        let reasoning = params
            .get("reasoning")
            .and_then(|v| v.as_str())
            .map(String::from);

        let hive_dir = resolve_hive_dir(&self.workspace_dir)?;
        let store = HiveStore::new(hive_dir);
        let manifest = store.read_manifest()?;
        let mut proposal = store.read_proposal(proposal_id)?;

        if proposal.status != "open" {
            return Err(PrimitiveError::ExecutionFailed(
                "proposal is not open for voting".into(),
            ));
        }

        if proposal
            .votes
            .iter()
            .any(|v| v.voter_agent_id == self.agent_id)
        {
            return Err(PrimitiveError::ExecutionFailed(
                "already voted on this proposal".into(),
            ));
        }

        let hive_vote = HiveVote {
            voter_agent_id: self.agent_id.clone(),
            vote: vote.to_string(),
            confidence,
            reasoning,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        proposal.votes.push(hive_vote);
        proposal.updated_at = chrono::Utc::now().to_rfc3339();
        store.write_proposal(&proposal)?;

        self.event_bus.emit(EventEnvelope::new(
            manifest.queen_agent_id,
            None,
            None,
            0,
            EventType::HiveVoteCast,
            serde_json::json!({
                "hive_id": manifest.id,
                "proposal_id": proposal_id,
                "voter": self.agent_id,
                "vote": vote,
            }),
        ));

        Ok(serde_json::json!({
            "proposal_id": proposal_id,
            "vote": vote,
            "total_votes": proposal.votes.len(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_core::EventBus;
    use moxxy_types::{ChildInfo, SpawnOpts, SpawnResult};

    struct MockRunStarter {
        captured_task: Arc<std::sync::Mutex<Option<String>>>,
    }

    impl MockRunStarter {
        fn new() -> Self {
            Self {
                captured_task: Arc::new(std::sync::Mutex::new(None)),
            }
        }
    }

    #[async_trait]
    impl RunStarter for MockRunStarter {
        async fn start_run(&self, _agent_id: &str, task: &str) -> Result<String, String> {
            *self.captured_task.lock().unwrap() = Some(task.to_string());
            Ok("run-mock".into())
        }
        async fn stop_agent(&self, _agent_id: &str) -> Result<(), String> {
            Ok(())
        }
        fn agent_status(&self, _agent_id: &str) -> Result<Option<String>, String> {
            Ok(Some("idle".into()))
        }
        async fn spawn_child(
            &self,
            _parent_name: &str,
            task: &str,
            _opts: SpawnOpts,
        ) -> Result<SpawnResult, String> {
            *self.captured_task.lock().unwrap() = Some(task.to_string());
            Ok(SpawnResult {
                child_name: "queen-1-worker-abc12345".into(),
                run_id: "run-mock".into(),
            })
        }
        fn list_children(&self, _parent_name: &str) -> Result<Vec<ChildInfo>, String> {
            Ok(Vec::new())
        }
        fn dismiss_child(&self, _parent_name: &str, _child_name: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn hive_create_creates_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        let prim = HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus);
        let result = prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert!(val["hive_id"].is_string());
        assert_eq!(val["status"], "created");

        // Verify manifest exists
        let store = HiveStore::new(agent_dir.join(".hive"));
        let manifest = store.read_manifest().unwrap();
        assert_eq!(manifest.name, "test-hive");
        assert_eq!(manifest.strategy, "consensus");
        assert_eq!(manifest.queen_agent_id, "queen-1");
        assert_eq!(manifest.members.len(), 1);
        assert_eq!(manifest.members[0].role, "queen");
    }

    #[tokio::test]
    async fn hive_create_rejects_duplicate() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        let prim = HiveCreatePrimitive::new("queen-1".into(), agent_dir, bus);
        prim.invoke(serde_json::json!({
            "name": "hive-1",
            "strategy": "consensus"
        }))
        .await
        .unwrap();

        let result = prim
            .invoke(serde_json::json!({
                "name": "hive-2",
                "strategy": "consensus"
            }))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn hive_recruit_spawns_worker_and_updates_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let queen_dir = tmp.path().to_path_buf();

        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        // First create a hive
        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), queen_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        // Now recruit
        let recruit_prim =
            HiveRecruitPrimitive::new("queen-1".into(), queen_dir.clone(), run_starter, bus);

        let result = recruit_prim
            .invoke(serde_json::json!({
                "task": "research something",
                "role": "worker",
                "specialty": "research"
            }))
            .await;

        assert!(result.is_ok(), "recruit failed: {:?}", result.err());
        let val = result.unwrap();
        assert!(val["child_name"].is_string());
        assert_eq!(val["run_id"], "run-mock");
        assert_eq!(val["role"], "worker");

        // Verify manifest updated with the new member
        let store = HiveStore::new(queen_dir.join(".hive"));
        let manifest = store.read_manifest().unwrap();
        assert_eq!(manifest.members.len(), 2);
        assert_eq!(manifest.members[1].role, "worker");
        assert_eq!(manifest.members[1].specialty.as_deref(), Some("research"));
    }

    #[tokio::test]
    async fn hive_recruit_prepends_context_to_task() {
        let tmp = tempfile::tempdir().unwrap();
        let queen_dir = tmp.path().to_path_buf();

        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());
        let captured = run_starter.captured_task.clone();

        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), queen_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        let recruit_prim =
            HiveRecruitPrimitive::new("queen-1".into(), queen_dir.clone(), run_starter, bus);

        recruit_prim
            .invoke(serde_json::json!({
                "task": "research AI papers",
                "role": "scout",
                "specialty": "research"
            }))
            .await
            .unwrap();

        let task_sent = captured
            .lock()
            .unwrap()
            .clone()
            .expect("task should be captured");
        assert!(
            task_sent.contains("[Hive Worker]"),
            "task should have hive context prefix: {task_sent}"
        );
        assert!(
            task_sent.contains("hive scout agent"),
            "task should mention role: {task_sent}"
        );
        assert!(
            task_sent.contains("Specialty: research"),
            "task should mention specialty: {task_sent}"
        );
        assert!(
            task_sent.contains("research AI papers"),
            "task should contain original task: {task_sent}"
        );
    }

    #[tokio::test]
    async fn hive_task_lifecycle() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        // Create hive
        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        // Create task
        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let result = task_create
            .invoke(serde_json::json!({
                "title": "Implement feature X",
                "description": "Build the feature",
                "task_type": "work",
                "priority": 8
            }))
            .await;
        assert!(result.is_ok());
        let task_id = result.unwrap()["task_id"].as_str().unwrap().to_string();

        // List tasks
        let task_list = HiveTaskListPrimitive::new(agent_dir.clone());
        let listed = task_list.invoke(serde_json::json!({})).await.unwrap();
        assert_eq!(listed["count"], 1);

        // Claim task
        let task_claim =
            HiveTaskClaimPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        let claimed = task_claim
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await;
        assert!(claimed.is_ok());
        assert_eq!(claimed.unwrap()["status"], "in_progress");

        // Complete task
        let task_complete =
            HiveTaskCompletePrimitive::new("worker-1".into(), agent_dir.clone(), bus);
        let completed = task_complete
            .invoke(serde_json::json!({
                "task_id": task_id,
                "result_summary": "Feature X implemented"
            }))
            .await;
        assert!(completed.is_ok());
        assert_eq!(completed.unwrap()["status"], "completed");

        // Verify final state
        let store = HiveStore::new(agent_dir.join(".hive"));
        let task = store.read_task(&task_id).unwrap();
        assert_eq!(task.status, "completed");
        assert_eq!(
            task.result_summary.as_deref(),
            Some("Feature X implemented")
        );
    }

    #[tokio::test]
    async fn hive_assign_task() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        // Create hive with a member
        let hive_dir = agent_dir.join(".hive");
        std::fs::create_dir_all(&hive_dir).unwrap();
        let manifest = HiveManifest {
            id: "hive-1".into(),
            queen_agent_id: "queen-1".into(),
            name: "test".into(),
            status: "active".into(),
            strategy: "consensus".into(),
            members: vec![
                HiveMember {
                    agent_id: "queen-1".into(),
                    role: "queen".into(),
                    specialty: None,
                    status: "active".into(),
                },
                HiveMember {
                    agent_id: "worker-1".into(),
                    role: "worker".into(),
                    specialty: None,
                    status: "active".into(),
                },
            ],
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let store = HiveStore::new(hive_dir);
        store.write_manifest(&manifest).unwrap();

        // Create task
        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let task_result = task_create
            .invoke(serde_json::json!({
                "title": "Do work",
                "description": "Work",
                "task_type": "work",
                "priority": 5
            }))
            .await
            .unwrap();
        let task_id = task_result["task_id"].as_str().unwrap().to_string();

        // Assign
        let assign = HiveAssignPrimitive::new("queen-1".into(), agent_dir.clone());
        let result = assign
            .invoke(serde_json::json!({
                "task_id": task_id,
                "agent_id": "worker-1"
            }))
            .await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["status"], "assigned");

        // Assign to non-member should fail
        let result = assign
            .invoke(serde_json::json!({
                "task_id": task_id,
                "agent_id": "nobody"
            }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn hive_signal_and_board_read() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        // Create hive
        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        // Post signal
        let signal_prim = HiveSignalPrimitive::new("queen-1".into(), agent_dir.clone(), bus);
        let result = signal_prim
            .invoke(serde_json::json!({
                "signal_type": "finding",
                "content": "Found a bug",
                "quality_score": 0.9,
                "tags": ["bug", "critical"]
            }))
            .await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["status"], "posted");

        // Read board
        let board_read = HiveBoardReadPrimitive::new(agent_dir.clone());
        let signals = board_read.invoke(serde_json::json!({})).await.unwrap();
        assert_eq!(signals["count"], 1);

        // Filter by type
        let filtered = board_read
            .invoke(serde_json::json!({ "signal_type": "finding" }))
            .await
            .unwrap();
        assert_eq!(filtered["count"], 1);

        let none = board_read
            .invoke(serde_json::json!({ "signal_type": "question" }))
            .await
            .unwrap();
        assert_eq!(none["count"], 0);

        // Filter by tag
        let tagged = board_read
            .invoke(serde_json::json!({ "tag": "bug" }))
            .await
            .unwrap();
        assert_eq!(tagged["count"], 1);
    }

    #[tokio::test]
    async fn hive_proposal_and_vote_lifecycle() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        // Create hive
        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        // Create proposal
        let propose = HiveProposePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let result = propose
            .invoke(serde_json::json!({
                "title": "Adopt new approach",
                "description": "Should we refactor?",
                "proposal_type": "decision",
                "quorum_required": 2
            }))
            .await;
        assert!(result.is_ok());
        let proposal_id = result.unwrap()["proposal_id"].as_str().unwrap().to_string();

        // Vote
        let vote = HiveVotePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let vote_result = vote
            .invoke(serde_json::json!({
                "proposal_id": proposal_id,
                "vote": "approve",
                "confidence": 0.9,
                "reasoning": "Looks good"
            }))
            .await;
        assert!(vote_result.is_ok());
        assert_eq!(vote_result.unwrap()["total_votes"], 1);

        // Duplicate vote should fail
        let dup = vote
            .invoke(serde_json::json!({
                "proposal_id": proposal_id,
                "vote": "reject",
                "confidence": 0.5
            }))
            .await;
        assert!(dup.is_err());

        // Resolve proposal
        let resolve = HiveResolveProposalPrimitive::new("queen-1".into(), agent_dir.clone(), bus);
        let resolved = resolve
            .invoke(serde_json::json!({
                "proposal_id": proposal_id,
                "status": "approved",
                "resolution": "Majority agrees"
            }))
            .await;
        assert!(resolved.is_ok());
        assert_eq!(resolved.unwrap()["status"], "approved");

        // Vote on resolved proposal should fail
        let vote2 = HiveVotePrimitive::new("worker-1".into(), agent_dir, EventBus::new(100));
        let late_vote = vote2
            .invoke(serde_json::json!({
                "proposal_id": proposal_id,
                "vote": "reject",
                "confidence": 0.5
            }))
            .await;
        assert!(late_vote.is_err());
    }

    #[tokio::test]
    async fn hive_aggregate_returns_full_snapshot() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        // Create hive
        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        // Add some data
        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        task_create
            .invoke(serde_json::json!({
                "title": "Task 1",
                "description": "Do stuff",
                "task_type": "work",
                "priority": 5
            }))
            .await
            .unwrap();

        let signal_prim =
            HiveSignalPrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        signal_prim
            .invoke(serde_json::json!({
                "signal_type": "finding",
                "content": "Found something"
            }))
            .await
            .unwrap();

        // Aggregate
        let aggregate = HiveAggregatePrimitive::new("queen-1".into(), agent_dir);
        let snapshot = aggregate.invoke(serde_json::json!({})).await.unwrap();

        assert!(snapshot["manifest"]["id"].is_string());
        assert_eq!(snapshot["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["signals"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["proposals"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn hive_disband_stops_members() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        // Create hive with a worker
        let hive_dir = agent_dir.join(".hive");
        std::fs::create_dir_all(&hive_dir).unwrap();
        let manifest = HiveManifest {
            id: "hive-1".into(),
            queen_agent_id: "queen-1".into(),
            name: "test".into(),
            status: "active".into(),
            strategy: "consensus".into(),
            members: vec![
                HiveMember {
                    agent_id: "queen-1".into(),
                    role: "queen".into(),
                    specialty: None,
                    status: "active".into(),
                },
                HiveMember {
                    agent_id: "worker-1".into(),
                    role: "worker".into(),
                    specialty: None,
                    status: "active".into(),
                },
            ],
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let store = HiveStore::new(hive_dir.clone());
        store.write_manifest(&manifest).unwrap();

        let disband = HiveDisbandPrimitive::new("queen-1".into(), agent_dir, run_starter, bus);

        let result = disband.invoke(serde_json::json!({})).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["status"], "disbanded");

        // Verify manifest updated
        let updated = store.read_manifest().unwrap();
        assert_eq!(updated.status, "disbanded");
        assert_eq!(updated.members[1].status, "disbanded");
    }

    #[tokio::test]
    async fn hive_store_signals_filter_by_tag() {
        let tmp = tempfile::tempdir().unwrap();
        let hive_dir = tmp.path().to_path_buf();
        std::fs::create_dir_all(&hive_dir).unwrap();

        let store = HiveStore::new(hive_dir);

        let s1 = HiveSignal {
            id: "sig-1".into(),
            author_agent_id: "agent-1".into(),
            signal_type: "finding".into(),
            content: "Finding A".into(),
            quality_score: 0.8,
            tags: vec!["rust".into(), "bug".into()],
            parent_signal_id: None,
            status: "active".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
        };
        let s2 = HiveSignal {
            id: "sig-2".into(),
            author_agent_id: "agent-1".into(),
            signal_type: "question".into(),
            content: "Question B".into(),
            quality_score: 0.5,
            tags: vec!["python".into()],
            parent_signal_id: None,
            status: "active".into(),
            created_at: "2026-01-02T00:00:00Z".into(),
        };

        store.add_signal(&s1).unwrap();
        store.add_signal(&s2).unwrap();

        // Filter by tag
        let rust_signals = store.read_signals(None, Some("rust"), None).unwrap();
        assert_eq!(rust_signals.len(), 1);
        assert_eq!(rust_signals[0].id, "sig-1");

        // Filter by type
        let questions = store.read_signals(Some("question"), None, None).unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].id, "sig-2");

        // With limit
        let limited = store.read_signals(None, None, Some(1)).unwrap();
        assert_eq!(limited.len(), 1);
    }

    #[tokio::test]
    async fn hive_task_claim_rejects_already_assigned() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        // Create hive and task
        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let task_result = task_create
            .invoke(serde_json::json!({
                "title": "Task",
                "description": "D",
                "task_type": "work",
                "priority": 5
            }))
            .await
            .unwrap();
        let task_id = task_result["task_id"].as_str().unwrap().to_string();

        // First claim succeeds
        let claim1 = HiveTaskClaimPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        claim1
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await
            .unwrap();

        // Second claim fails
        let claim2 = HiveTaskClaimPrimitive::new("worker-2".into(), agent_dir, bus);
        let result = claim2
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn resolve_hive_dir_from_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_path_buf();

        // Create .hive directory inside the workspace (shared by queen and workers)
        let hive_dir = workspace.join(".hive");
        std::fs::create_dir_all(&hive_dir).unwrap();

        let manifest = HiveManifest {
            id: "hive-1".into(),
            queen_agent_id: "queen-1".into(),
            name: "test".into(),
            status: "active".into(),
            strategy: "consensus".into(),
            members: vec![],
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let store = HiveStore::new(hive_dir.clone());
        store.write_manifest(&manifest).unwrap();

        // Workers resolve .hive from the same workspace directory
        let resolved = resolve_hive_dir(&workspace).unwrap();
        assert_eq!(resolved, hive_dir);
    }

    #[tokio::test]
    async fn queen_only_primitives_reject_non_queen() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();

        // Create hive as queen-1
        let hive_dir = agent_dir.join(".hive");
        std::fs::create_dir_all(&hive_dir).unwrap();
        let manifest = HiveManifest {
            id: "hive-1".into(),
            queen_agent_id: "queen-1".into(),
            name: "test".into(),
            status: "active".into(),
            strategy: "consensus".into(),
            members: vec![],
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        HiveStore::new(hive_dir).write_manifest(&manifest).unwrap();
        let bus = EventBus::new(10);

        // task_create as non-queen
        let task_create =
            HiveTaskCreatePrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        let result = task_create
            .invoke(serde_json::json!({
                "title": "T",
                "description": "D",
                "task_type": "work",
                "priority": 1
            }))
            .await;
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));

        // assign as non-queen
        let assign = HiveAssignPrimitive::new("worker-1".into(), agent_dir.clone());
        let result = assign
            .invoke(serde_json::json!({
                "task_id": "t-1",
                "agent_id": "someone"
            }))
            .await;
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));

        // aggregate as non-queen
        let aggregate = HiveAggregatePrimitive::new("worker-1".into(), agent_dir.clone());
        let result = aggregate.invoke(serde_json::json!({})).await;
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));

        // resolve_proposal as non-queen
        let resolve = HiveResolveProposalPrimitive::new(
            "worker-1".into(),
            agent_dir.clone(),
            EventBus::new(10),
        );
        let result = resolve
            .invoke(serde_json::json!({
                "proposal_id": "p-1",
                "status": "approved",
                "resolution": "ok"
            }))
            .await;
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));

        // disband as non-queen
        let disband = HiveDisbandPrimitive::new(
            "worker-1".into(),
            agent_dir,
            Arc::new(MockRunStarter::new()),
            EventBus::new(10),
        );
        let result = disband.invoke(serde_json::json!({})).await;
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn hive_task_claim_rejects_blocked_task() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        // Create hive
        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        // Create task A (foundation)
        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let a_result = task_create
            .invoke(serde_json::json!({
                "title": "Set up project",
                "description": "Foundation task",
                "task_type": "work",
                "priority": 10
            }))
            .await
            .unwrap();
        let task_a_id = a_result["task_id"].as_str().unwrap().to_string();

        // Create task B depending on A
        let b_result = task_create
            .invoke(serde_json::json!({
                "title": "Build auth module",
                "description": "Depends on foundation",
                "task_type": "work",
                "priority": 8,
                "depends_on": [task_a_id]
            }))
            .await
            .unwrap();
        let task_b_id = b_result["task_id"].as_str().unwrap().to_string();

        // Claiming B should fail because A is not completed
        let claim = HiveTaskClaimPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        let result = claim
            .invoke(serde_json::json!({ "task_id": task_b_id }))
            .await;
        assert!(result.is_err());
        let err_msg = format!("{:?}", result.unwrap_err());
        assert!(
            err_msg.contains("blocked by incomplete dependencies"),
            "error should mention blocked deps: {err_msg}"
        );
        assert!(
            err_msg.contains(&task_a_id),
            "error should list the blocking task ID: {err_msg}"
        );
    }

    #[tokio::test]
    async fn hive_task_claim_allows_after_deps_completed() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        // Create hive
        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());

        // Create A, then B depending on A
        let a_result = task_create
            .invoke(serde_json::json!({
                "title": "Foundation",
                "description": "Do first",
                "task_type": "work",
                "priority": 10
            }))
            .await
            .unwrap();
        let task_a_id = a_result["task_id"].as_str().unwrap().to_string();

        let b_result = task_create
            .invoke(serde_json::json!({
                "title": "Dependent",
                "description": "Needs A",
                "task_type": "work",
                "priority": 8,
                "depends_on": [task_a_id]
            }))
            .await
            .unwrap();
        let task_b_id = b_result["task_id"].as_str().unwrap().to_string();

        // Claim and complete A
        let claim_a =
            HiveTaskClaimPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        claim_a
            .invoke(serde_json::json!({ "task_id": task_a_id }))
            .await
            .unwrap();
        let complete_a =
            HiveTaskCompletePrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        complete_a
            .invoke(serde_json::json!({
                "task_id": task_a_id,
                "result_summary": "Done"
            }))
            .await
            .unwrap();

        // Now claiming B should succeed
        let claim_b = HiveTaskClaimPrimitive::new("worker-2".into(), agent_dir, bus);
        let result = claim_b
            .invoke(serde_json::json!({ "task_id": task_b_id }))
            .await;
        assert!(result.is_ok(), "claim B should succeed after A completed");
        assert_eq!(result.unwrap()["status"], "in_progress");
    }

    #[tokio::test]
    async fn hive_task_list_shows_blocked_status() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        // Create hive
        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());

        // Create independent task (no deps)
        task_create
            .invoke(serde_json::json!({
                "title": "Independent",
                "description": "No deps",
                "task_type": "work",
                "priority": 5
            }))
            .await
            .unwrap();

        // Create A
        let a_result = task_create
            .invoke(serde_json::json!({
                "title": "Foundation",
                "description": "Do first",
                "task_type": "work",
                "priority": 10
            }))
            .await
            .unwrap();
        let task_a_id = a_result["task_id"].as_str().unwrap().to_string();

        // Create B depending on A
        task_create
            .invoke(serde_json::json!({
                "title": "Blocked task",
                "description": "Needs A",
                "task_type": "work",
                "priority": 8,
                "depends_on": [task_a_id]
            }))
            .await
            .unwrap();

        // List all tasks
        let task_list = HiveTaskListPrimitive::new(agent_dir);
        let listed = task_list.invoke(serde_json::json!({})).await.unwrap();

        assert_eq!(listed["count"], 3);
        // claimable_count should be 2 (independent + foundation, not blocked one)
        assert_eq!(listed["claimable_count"], 2);

        let tasks = listed["tasks"].as_array().unwrap();
        // Find the blocked task and verify its blocked field
        let blocked_task = tasks.iter().find(|t| t["title"] == "Blocked task").unwrap();
        assert_eq!(blocked_task["blocked"], true);

        let independent = tasks.iter().find(|t| t["title"] == "Independent").unwrap();
        assert_eq!(independent["blocked"], false);

        let foundation = tasks.iter().find(|t| t["title"] == "Foundation").unwrap();
        assert_eq!(foundation["blocked"], false);
    }

    #[tokio::test]
    async fn hive_task_claim_rejects_completed_task() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let task_result = task_create
            .invoke(serde_json::json!({
                "title": "Task",
                "description": "D",
                "task_type": "work",
                "priority": 5
            }))
            .await
            .unwrap();
        let task_id = task_result["task_id"].as_str().unwrap().to_string();

        // Claim and complete the task
        let claim = HiveTaskClaimPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        claim
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await
            .unwrap();

        let complete =
            HiveTaskCompletePrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        complete
            .invoke(serde_json::json!({ "task_id": task_id, "result_summary": "done" }))
            .await
            .unwrap();

        // Re-claiming a completed task should fail
        let claim2 = HiveTaskClaimPrimitive::new("worker-2".into(), agent_dir, bus);
        let result = claim2
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await;
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(err_msg.contains("cannot be claimed"), "expected 'cannot be claimed', got: {err_msg}");
    }

    #[tokio::test]
    async fn hive_task_complete_rejects_non_owner() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let task_result = task_create
            .invoke(serde_json::json!({
                "title": "Task",
                "description": "D",
                "task_type": "work",
                "priority": 5
            }))
            .await
            .unwrap();
        let task_id = task_result["task_id"].as_str().unwrap().to_string();

        // Claim as worker-1
        let claim = HiveTaskClaimPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        claim
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await
            .unwrap();

        // Try to complete as worker-2 - should fail with AccessDenied
        let complete =
            HiveTaskCompletePrimitive::new("worker-2".into(), agent_dir, bus);
        let result = complete
            .invoke(serde_json::json!({ "task_id": task_id, "result_summary": "done" }))
            .await;
        assert!(matches!(result, Err(PrimitiveError::AccessDenied(_))));
    }

    #[tokio::test]
    async fn hive_task_complete_rejects_unclaimed_task() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let task_result = task_create
            .invoke(serde_json::json!({
                "title": "Task",
                "description": "D",
                "task_type": "work",
                "priority": 5
            }))
            .await
            .unwrap();
        let task_id = task_result["task_id"].as_str().unwrap().to_string();

        // Try to complete a pending (unclaimed) task - should fail with AccessDenied
        let complete =
            HiveTaskCompletePrimitive::new("worker-1".into(), agent_dir, bus);
        let result = complete
            .invoke(serde_json::json!({ "task_id": task_id, "result_summary": "done" }))
            .await;
        assert!(matches!(result, Err(PrimitiveError::AccessDenied(_))));
    }

    #[tokio::test]
    async fn hive_task_fail_retries_then_permanent_failure() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        // Create task with max_retries=2
        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let task_result = task_create
            .invoke(serde_json::json!({
                "title": "Flaky task",
                "description": "D",
                "task_type": "work",
                "priority": 5,
                "max_retries": 2
            }))
            .await
            .unwrap();
        let task_id = task_result["task_id"].as_str().unwrap().to_string();

        // Attempt 1: claim and fail → should go back to pending
        let claim1 = HiveTaskClaimPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        claim1
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await
            .unwrap();

        let fail1 = HiveTaskFailPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        let r1 = fail1
            .invoke(serde_json::json!({ "task_id": task_id, "reason": "timeout" }))
            .await
            .unwrap();
        assert_eq!(r1["status"], "pending");
        assert_eq!(r1["attempt_count"], 1);
        assert_eq!(r1["retries_exhausted"], false);

        // Attempt 2: claim and fail → retries exhausted, should be "failed"
        let claim2 = HiveTaskClaimPrimitive::new("worker-2".into(), agent_dir.clone(), bus.clone());
        claim2
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await
            .unwrap();

        let fail2 = HiveTaskFailPrimitive::new("worker-2".into(), agent_dir.clone(), bus.clone());
        let r2 = fail2
            .invoke(serde_json::json!({ "task_id": task_id, "reason": "still broken" }))
            .await
            .unwrap();
        assert_eq!(r2["status"], "failed");
        assert_eq!(r2["attempt_count"], 2);
        assert_eq!(r2["retries_exhausted"], true);

        // Task should no longer be claimable
        let claim3 = HiveTaskClaimPrimitive::new("worker-3".into(), agent_dir, bus);
        let err = claim3
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn hive_task_fail_rejects_non_owner() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let task_result = task_create
            .invoke(serde_json::json!({
                "title": "Task",
                "description": "D",
                "task_type": "work",
                "priority": 5
            }))
            .await
            .unwrap();
        let task_id = task_result["task_id"].as_str().unwrap().to_string();

        // Claim as worker-1
        let claim = HiveTaskClaimPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        claim
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await
            .unwrap();

        // Fail as worker-2 → AccessDenied
        let fail = HiveTaskFailPrimitive::new("worker-2".into(), agent_dir, bus);
        let result = fail
            .invoke(serde_json::json!({ "task_id": task_id, "reason": "nope" }))
            .await;
        assert!(matches!(result, Err(PrimitiveError::AccessDenied(_))));
    }

    #[tokio::test]
    async fn hive_task_claim_increments_attempt_count() {
        let tmp = tempfile::tempdir().unwrap();
        let agent_dir = tmp.path().to_path_buf();
        let bus = EventBus::new(100);

        let create_prim =
            HiveCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        create_prim
            .invoke(serde_json::json!({
                "name": "test-hive",
                "strategy": "consensus"
            }))
            .await
            .unwrap();

        let task_create =
            HiveTaskCreatePrimitive::new("queen-1".into(), agent_dir.clone(), bus.clone());
        let task_result = task_create
            .invoke(serde_json::json!({
                "title": "Task",
                "description": "D",
                "task_type": "work",
                "priority": 5,
                "max_retries": 5
            }))
            .await
            .unwrap();
        let task_id = task_result["task_id"].as_str().unwrap().to_string();

        // Claim → fail → claim again, verify attempt_count increments
        let claim = HiveTaskClaimPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        claim
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await
            .unwrap();

        let store = HiveStore::new(agent_dir.join(".hive"));
        let task = store.read_task(&task_id).unwrap();
        assert_eq!(task.attempt_count, 1);

        // Fail to reset to pending
        let fail = HiveTaskFailPrimitive::new("worker-1".into(), agent_dir.clone(), bus.clone());
        fail.invoke(serde_json::json!({ "task_id": task_id, "reason": "oops" }))
            .await
            .unwrap();

        // Re-claim
        let claim2 = HiveTaskClaimPrimitive::new("worker-2".into(), agent_dir.clone(), bus);
        claim2
            .invoke(serde_json::json!({ "task_id": task_id }))
            .await
            .unwrap();

        let task = store.read_task(&task_id).unwrap();
        assert_eq!(task.attempt_count, 2);
    }
}
