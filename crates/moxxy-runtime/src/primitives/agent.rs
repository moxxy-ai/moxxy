use async_trait::async_trait;
use moxxy_core::EventBus;
use moxxy_types::{AgentType, EventEnvelope, EventType, RunStarter, SpawnOpts};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::ask::AskChannels;
use crate::registry::{Primitive, PrimitiveError};

// ──────────────────────────── Inbox Types ────────────────────────────

/// A message sent between agents via the inbox system.
#[derive(Debug, Clone)]
pub struct AgentMessage {
    pub from: String,
    pub content: String,
    pub timestamp: i64,
}

/// Per-agent message inbox: agent_name → pending messages.
pub type AgentInbox = Arc<Mutex<HashMap<String, Vec<AgentMessage>>>>;

/// Channels for blocking until a child agent completes.
pub type AgentAwaitChannels = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>>;

pub fn new_agent_inbox() -> AgentInbox {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn new_agent_await_channels() -> AgentAwaitChannels {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Plan approval result sent from parent to child.
#[derive(Debug, Clone)]
pub struct PlanApproval {
    pub approved: bool,
    pub feedback: Option<String>,
}

/// Channels for plan approval: child_name → sender.
pub type PlanApprovalChannels =
    Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<PlanApproval>>>>;

pub fn new_plan_approval_channels() -> PlanApprovalChannels {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Primitive that lets an agent spawn a sub-agent for a task.
pub struct AgentSpawnPrimitive {
    parent_name: String,
    run_starter: Arc<dyn RunStarter>,
    event_bus: EventBus,
}

impl AgentSpawnPrimitive {
    pub fn new(parent_name: String, run_starter: Arc<dyn RunStarter>, event_bus: EventBus) -> Self {
        Self {
            parent_name,
            run_starter,
            event_bus,
        }
    }
}

#[async_trait]
impl Primitive for AgentSpawnPrimitive {
    fn name(&self) -> &str {
        "agent.spawn"
    }

    fn description(&self) -> &str {
        "Spawn a sub-agent to work on a subtask. The sub-agent inherits the parent's provider, model, and workspace."
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
                "plan_mode": {
                    "type": "boolean",
                    "description": "When true, the sub-agent must submit a plan before executing write operations (default: false)"
                },
                "isolation": {
                    "type": "string",
                    "enum": ["shared", "worktree"],
                    "description": "Workspace isolation mode: 'shared' (default) or 'worktree' (git worktree for isolated changes)"
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

        tracing::info!(parent_name = %self.parent_name, task_len = task.len(), "Spawning sub-agent");

        let model_id = params
            .get("model_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from);

        let plan_mode = params
            .get("plan_mode")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let isolation = match params.get("isolation").and_then(|v| v.as_str()) {
            Some("worktree") => moxxy_types::WorkspaceIsolation::Worktree,
            _ => moxxy_types::WorkspaceIsolation::Shared,
        };

        let result = self
            .run_starter
            .spawn_child(
                &self.parent_name,
                &task,
                SpawnOpts {
                    agent_type: AgentType::Ephemeral,
                    model_id,
                    hive_role: None,
                    plan_mode,
                    isolation,
                },
            )
            .await
            .map_err(PrimitiveError::ExecutionFailed)?;

        // Emit spawn event
        self.event_bus.emit(EventEnvelope::new(
            self.parent_name.clone(),
            None,
            None,
            0,
            EventType::SubagentSpawned,
            serde_json::json!({
                "child_name": result.child_name,
                "task": task,
            }),
        ));

        Ok(serde_json::json!({
            "child_name": result.child_name,
            "run_id": result.run_id,
        }))
    }
}

/// Primitive that lets a parent agent check the status of a sub-agent.
pub struct AgentStatusPrimitive {
    parent_name: String,
    run_starter: Arc<dyn RunStarter>,
    ask_channels: AskChannels,
}

impl AgentStatusPrimitive {
    pub fn new(
        parent_name: String,
        run_starter: Arc<dyn RunStarter>,
        ask_channels: AskChannels,
    ) -> Self {
        Self {
            parent_name,
            run_starter,
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

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "child_name": {
                    "type": "string",
                    "description": "The name of the sub-agent to check"
                }
            },
            "required": ["child_name"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let child_name = params
            .get("child_name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'child_name'".into()))?;

        tracing::debug!(child_name, parent_name = %self.parent_name, "Checking sub-agent status");

        // Verify ownership via list_children
        let children = self
            .run_starter
            .list_children(&self.parent_name)
            .map_err(PrimitiveError::ExecutionFailed)?;

        let child = children
            .iter()
            .find(|c| c.name == child_name)
            .ok_or_else(|| {
                PrimitiveError::AccessDenied(format!(
                    "agent '{child_name}' is not a child of '{}'",
                    self.parent_name
                ))
            })?;

        // Check for pending questions in ask_channels
        let has_pending_question = self
            .ask_channels
            .lock()
            .ok()
            .map(|channels| !channels.is_empty())
            .unwrap_or(false);

        let mut response = serde_json::json!({
            "child_name": child_name,
            "status": child.status,
            "has_pending_question": has_pending_question,
        });
        if let Some(ref result) = child.last_result {
            response["result"] = serde_json::Value::String(result.clone());
        }
        Ok(response)
    }
}

/// Primitive that lists all sub-agents of the current agent.
pub struct AgentListPrimitive {
    parent_name: String,
    run_starter: Arc<dyn RunStarter>,
}

impl AgentListPrimitive {
    pub fn new(parent_name: String, run_starter: Arc<dyn RunStarter>) -> Self {
        Self {
            parent_name,
            run_starter,
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
        tracing::debug!(parent_name = %self.parent_name, "Listing sub-agents");

        let children = self
            .run_starter
            .list_children(&self.parent_name)
            .map_err(PrimitiveError::ExecutionFailed)?;

        let agents: Vec<serde_json::Value> = children
            .iter()
            .map(|c| {
                serde_json::json!({
                    "name": c.name,
                    "status": c.status,
                    "depth": c.depth,
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
    parent_name: String,
    run_starter: Arc<dyn RunStarter>,
}

impl AgentStopPrimitive {
    pub fn new(parent_name: String, run_starter: Arc<dyn RunStarter>) -> Self {
        Self {
            parent_name,
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
                "child_name": {
                    "type": "string",
                    "description": "The name of the sub-agent to stop"
                }
            },
            "required": ["child_name"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let child_name = params
            .get("child_name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'child_name'".into()))?;

        tracing::info!(child_name, parent_name = %self.parent_name, "Stopping sub-agent");

        // Verify ownership
        let children = self
            .run_starter
            .list_children(&self.parent_name)
            .map_err(PrimitiveError::ExecutionFailed)?;

        if !children.iter().any(|c| c.name == child_name) {
            return Err(PrimitiveError::AccessDenied(format!(
                "agent '{child_name}' is not a child of '{}'",
                self.parent_name
            )));
        }

        self.run_starter
            .stop_agent(child_name)
            .await
            .map_err(PrimitiveError::ExecutionFailed)?;

        Ok(serde_json::json!({
            "child_name": child_name,
            "status": "stopped",
        }))
    }
}

/// Primitive that lets a parent agent dismiss (unregister) a completed sub-agent.
pub struct AgentDismissPrimitive {
    parent_name: String,
    run_starter: Arc<dyn RunStarter>,
}

impl AgentDismissPrimitive {
    pub fn new(parent_name: String, run_starter: Arc<dyn RunStarter>) -> Self {
        Self {
            parent_name,
            run_starter,
        }
    }
}

#[async_trait]
impl Primitive for AgentDismissPrimitive {
    fn name(&self) -> &str {
        "agent.dismiss"
    }

    fn description(&self) -> &str {
        "Dismiss a completed sub-agent, removing it from the registry. Use after confirming the sub-agent's work is done."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "child_name": {
                    "type": "string",
                    "description": "The name of the sub-agent to dismiss"
                }
            },
            "required": ["child_name"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let child_name = params
            .get("child_name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'child_name'".into()))?;

        tracing::info!(child_name, parent_name = %self.parent_name, "Dismissing sub-agent");

        self.run_starter
            .dismiss_child(&self.parent_name, child_name)
            .map_err(PrimitiveError::ExecutionFailed)?;

        Ok(serde_json::json!({
            "child_name": child_name,
            "status": "dismissed",
        }))
    }
}

// ──────────────────────────── agent.message ────────────────────────────

/// Primitive that sends a direct message to another agent's inbox.
pub struct AgentMessagePrimitive {
    sender_name: String,
    inbox: AgentInbox,
    run_starter: Arc<dyn RunStarter>,
}

impl AgentMessagePrimitive {
    pub fn new(sender_name: String, inbox: AgentInbox, run_starter: Arc<dyn RunStarter>) -> Self {
        Self {
            sender_name,
            inbox,
            run_starter,
        }
    }
}

#[async_trait]
impl Primitive for AgentMessagePrimitive {
    fn name(&self) -> &str {
        "agent.message"
    }

    fn description(&self) -> &str {
        "Send a direct message to a sub-agent. The message will be injected into the target agent's conversation on its next iteration."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "to": {
                    "type": "string",
                    "description": "Name of the target agent (must be a child of the current agent)"
                },
                "content": {
                    "type": "string",
                    "description": "The message content to send"
                }
            },
            "required": ["to", "content"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let to = params
            .get("to")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'to'".into()))?;
        let content = params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content'".into()))?;

        // Verify the target is a child of this agent
        let children = self
            .run_starter
            .list_children(&self.sender_name)
            .map_err(PrimitiveError::ExecutionFailed)?;
        if !children.iter().any(|c| c.name == to) {
            return Err(PrimitiveError::AccessDenied(format!(
                "agent '{}' is not a child of '{}'",
                to, self.sender_name
            )));
        }

        let msg = AgentMessage {
            from: self.sender_name.clone(),
            content: content.to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
        };

        {
            let mut inbox = self.inbox.lock().map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("inbox lock poisoned: {e}"))
            })?;
            inbox.entry(to.to_string()).or_default().push(msg);
        }

        tracing::info!(
            from = %self.sender_name,
            to = %to,
            content_len = content.len(),
            "Agent message sent"
        );

        Ok(serde_json::json!({
            "status": "sent",
            "to": to,
        }))
    }
}

// ──────────────────────────── agent.broadcast ────────────────────────────

/// Primitive that broadcasts a message to all child agents.
pub struct AgentBroadcastPrimitive {
    sender_name: String,
    inbox: AgentInbox,
    run_starter: Arc<dyn RunStarter>,
}

impl AgentBroadcastPrimitive {
    pub fn new(sender_name: String, inbox: AgentInbox, run_starter: Arc<dyn RunStarter>) -> Self {
        Self {
            sender_name,
            inbox,
            run_starter,
        }
    }
}

#[async_trait]
impl Primitive for AgentBroadcastPrimitive {
    fn name(&self) -> &str {
        "agent.broadcast"
    }

    fn description(&self) -> &str {
        "Broadcast a message to all child agents. Each child receives the message in its inbox."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The message content to broadcast to all children"
                }
            },
            "required": ["content"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let content = params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content'".into()))?;

        let children = self
            .run_starter
            .list_children(&self.sender_name)
            .map_err(PrimitiveError::ExecutionFailed)?;

        let timestamp = chrono::Utc::now().timestamp_millis();
        let mut sent_to = Vec::new();

        {
            let mut inbox = self.inbox.lock().map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("inbox lock poisoned: {e}"))
            })?;
            for child in &children {
                let msg = AgentMessage {
                    from: self.sender_name.clone(),
                    content: content.to_string(),
                    timestamp,
                };
                inbox.entry(child.name.clone()).or_default().push(msg);
                sent_to.push(child.name.clone());
            }
        }

        tracing::info!(
            from = %self.sender_name,
            recipients = %sent_to.len(),
            "Agent broadcast sent"
        );

        Ok(serde_json::json!({
            "status": "broadcast_sent",
            "recipients": sent_to,
            "count": sent_to.len(),
        }))
    }
}

// ──────────────────────────── agent.await ────────────────────────────

/// Primitive that blocks until a child agent completes and returns its result.
pub struct AgentAwaitPrimitive {
    parent_name: String,
    run_starter: Arc<dyn RunStarter>,
    await_channels: AgentAwaitChannels,
}

impl AgentAwaitPrimitive {
    pub fn new(
        parent_name: String,
        run_starter: Arc<dyn RunStarter>,
        await_channels: AgentAwaitChannels,
    ) -> Self {
        Self {
            parent_name,
            run_starter,
            await_channels,
        }
    }
}

#[async_trait]
impl Primitive for AgentAwaitPrimitive {
    fn name(&self) -> &str {
        "agent.await"
    }

    fn description(&self) -> &str {
        "Block until a sub-agent completes and return its final result. If the sub-agent has already finished, returns immediately with the result."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "child_name": {
                    "type": "string",
                    "description": "Name of the sub-agent to wait for"
                },
                "timeout_secs": {
                    "type": "integer",
                    "description": "Maximum seconds to wait (default: 300)"
                }
            },
            "required": ["child_name"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let child_name = params
            .get("child_name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'child_name'".into()))?;
        let timeout_secs = params
            .get("timeout_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(300);

        // Verify ownership
        let children = self
            .run_starter
            .list_children(&self.parent_name)
            .map_err(PrimitiveError::ExecutionFailed)?;
        let child = children
            .iter()
            .find(|c| c.name == child_name)
            .ok_or_else(|| {
                PrimitiveError::AccessDenied(format!(
                    "agent '{}' is not a child of '{}'",
                    child_name, self.parent_name
                ))
            })?;

        // If already completed, return immediately
        if child.status != "running" {
            return Ok(serde_json::json!({
                "child_name": child_name,
                "status": child.status,
                "result": child.last_result,
            }));
        }

        // Register an await channel and wait for completion
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut channels = self.await_channels.lock().map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("await channels lock poisoned: {e}"))
            })?;
            channels.insert(child_name.to_string(), tx);
        }

        tracing::info!(
            parent = %self.parent_name,
            child = %child_name,
            timeout_secs,
            "Awaiting sub-agent completion"
        );

        let result = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx)
            .await
            .map_err(|_| PrimitiveError::Timeout)?
            .map_err(|_| {
                PrimitiveError::ExecutionFailed("child agent was dropped before completing".into())
            })?;

        Ok(serde_json::json!({
            "child_name": child_name,
            "status": "completed",
            "result": result,
        }))
    }
}

// ──────────────────────────── plan.submit ────────────────────────────

/// Primitive for a child agent to submit a plan for parent approval.
/// Blocks until the parent approves or rejects the plan.
pub struct PlanSubmitPrimitive {
    agent_name: String,
    inbox: AgentInbox,
    plan_channels: PlanApprovalChannels,
}

impl PlanSubmitPrimitive {
    pub fn new(agent_name: String, inbox: AgentInbox, plan_channels: PlanApprovalChannels) -> Self {
        Self {
            agent_name,
            inbox,
            plan_channels,
        }
    }
}

#[async_trait]
impl Primitive for PlanSubmitPrimitive {
    fn name(&self) -> &str {
        "plan.submit"
    }

    fn description(&self) -> &str {
        "Submit a plan for parent approval. Blocks until the parent approves or rejects. Only available in plan_mode agents."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "plan": {
                    "type": "string",
                    "description": "The detailed plan describing what actions you intend to take"
                }
            },
            "required": ["plan"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let plan = params
            .get("plan")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'plan'".into()))?;

        tracing::info!(
            agent = %self.agent_name,
            plan_len = plan.len(),
            "Plan submitted, awaiting parent approval"
        );

        // Send the plan to the parent's inbox
        // The parent agent is inferred from the naming convention (parent is prefix before last dash-tag-suffix)
        let parent_name = self
            .agent_name
            .rsplit_once('-')
            .and_then(|(prefix, _)| prefix.rsplit_once('-'))
            .map(|(parent, _)| parent.to_string())
            .unwrap_or_default();

        if !parent_name.is_empty() {
            let msg = AgentMessage {
                from: self.agent_name.clone(),
                content: format!("[PLAN SUBMITTED - awaiting approval]\n{plan}"),
                timestamp: chrono::Utc::now().timestamp_millis(),
            };
            if let Ok(mut inbox) = self.inbox.lock() {
                inbox.entry(parent_name).or_default().push(msg);
            }
        }

        // Create approval channel and wait
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut channels = self.plan_channels.lock().map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("plan channels lock poisoned: {e}"))
            })?;
            channels.insert(self.agent_name.clone(), tx);
        }

        let approval = tokio::time::timeout(std::time::Duration::from_secs(600), rx)
            .await
            .map_err(|_| PrimitiveError::Timeout)?
            .map_err(|_| {
                PrimitiveError::ExecutionFailed("parent dropped before approving plan".into())
            })?;

        if approval.approved {
            tracing::info!(agent = %self.agent_name, "Plan approved by parent");
            Ok(serde_json::json!({
                "status": "approved",
                "feedback": approval.feedback,
            }))
        } else {
            tracing::info!(agent = %self.agent_name, "Plan rejected by parent");
            Ok(serde_json::json!({
                "status": "rejected",
                "feedback": approval.feedback,
            }))
        }
    }
}

// ──────────────────────────── plan.approve ────────────────────────────

/// Primitive for a parent agent to approve or reject a child's submitted plan.
pub struct PlanApprovePrimitive {
    parent_name: String,
    plan_channels: PlanApprovalChannels,
    run_starter: Arc<dyn RunStarter>,
}

impl PlanApprovePrimitive {
    pub fn new(
        parent_name: String,
        plan_channels: PlanApprovalChannels,
        run_starter: Arc<dyn RunStarter>,
    ) -> Self {
        Self {
            parent_name,
            plan_channels,
            run_starter,
        }
    }
}

#[async_trait]
impl Primitive for PlanApprovePrimitive {
    fn name(&self) -> &str {
        "plan.approve"
    }

    fn description(&self) -> &str {
        "Approve or reject a child agent's submitted plan. The child is blocked waiting for this response."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "child_name": {
                    "type": "string",
                    "description": "Name of the child agent whose plan to approve/reject"
                },
                "approved": {
                    "type": "boolean",
                    "description": "Whether to approve (true) or reject (false) the plan"
                },
                "feedback": {
                    "type": "string",
                    "description": "Optional feedback for the child (guidance, corrections, etc.)"
                }
            },
            "required": ["child_name", "approved"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let child_name = params
            .get("child_name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'child_name'".into()))?;
        let approved = params
            .get("approved")
            .and_then(|v| v.as_bool())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'approved'".into()))?;
        let feedback = params
            .get("feedback")
            .and_then(|v| v.as_str())
            .map(String::from);

        // Verify ownership
        let children = self
            .run_starter
            .list_children(&self.parent_name)
            .map_err(PrimitiveError::ExecutionFailed)?;
        if !children.iter().any(|c| c.name == child_name) {
            return Err(PrimitiveError::AccessDenied(format!(
                "agent '{}' is not a child of '{}'",
                child_name, self.parent_name
            )));
        }

        // Send approval to the child's plan channel
        let sender = {
            let mut channels = self.plan_channels.lock().map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("plan channels lock poisoned: {e}"))
            })?;
            channels.remove(child_name)
        };

        let Some(sender) = sender else {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "no pending plan from '{child_name}'"
            )));
        };

        let approval = PlanApproval {
            approved,
            feedback: feedback.clone(),
        };

        sender.send(approval).map_err(|_| {
            PrimitiveError::ExecutionFailed("child agent dropped before receiving approval".into())
        })?;

        tracing::info!(
            parent = %self.parent_name,
            child = %child_name,
            approved,
            "Plan approval sent"
        );

        Ok(serde_json::json!({
            "child_name": child_name,
            "approved": approved,
            "feedback": feedback,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_types::{AgentType, ChildInfo, SpawnResult};
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct MockRunStarter {
        started: AtomicBool,
        stopped: AtomicBool,
        children: Mutex<Vec<ChildInfo>>,
        spawn_should_fail: AtomicBool,
        dismiss_should_fail: AtomicBool,
    }

    impl MockRunStarter {
        fn new() -> Self {
            Self {
                started: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
                children: Mutex::new(Vec::new()),
                spawn_should_fail: AtomicBool::new(false),
                dismiss_should_fail: AtomicBool::new(false),
            }
        }

        fn add_child(&self, name: &str, status: &str) {
            self.children.lock().unwrap().push(ChildInfo {
                name: name.to_string(),
                status: status.to_string(),
                agent_type: AgentType::Ephemeral,
                hive_role: None,
                depth: 1,
                last_result: None,
            });
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
        async fn spawn_child(
            &self,
            _parent_name: &str,
            _task: &str,
            opts: SpawnOpts,
        ) -> Result<SpawnResult, String> {
            if self.spawn_should_fail.load(Ordering::SeqCst) {
                return Err("spawn limit reached: depth=0/0, total=0/0".into());
            }
            let child_name = "parent-1-sub-abc12345".to_string();
            self.children.lock().unwrap().push(ChildInfo {
                name: child_name.clone(),
                status: "running".to_string(),
                agent_type: opts.agent_type,
                hive_role: opts.hive_role,
                depth: 1,
                last_result: None,
            });
            self.started.store(true, Ordering::SeqCst);
            Ok(SpawnResult {
                child_name,
                run_id: "run-123".into(),
            })
        }
        fn list_children(&self, _parent_name: &str) -> Result<Vec<ChildInfo>, String> {
            Ok(self.children.lock().unwrap().clone())
        }
        fn dismiss_child(&self, _parent_name: &str, child_name: &str) -> Result<(), String> {
            if self.dismiss_should_fail.load(Ordering::SeqCst) {
                return Err(format!(
                    "sub-agent '{child_name}' is still running; stop it first"
                ));
            }
            let mut children = self.children.lock().unwrap();
            children.retain(|c| c.name != child_name);
            Ok(())
        }
    }

    #[tokio::test]
    async fn agent_spawn_creates_child_and_starts_run() {
        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        let prim = AgentSpawnPrimitive::new("parent-1".into(), run_starter.clone(), bus);

        let result = prim
            .invoke(serde_json::json!({
                "task": "research something",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert!(val["child_name"].is_string());
        assert_eq!(val["run_id"], "run-123");
        assert!(run_starter.started.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn agent_spawn_respects_lineage_limits() {
        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.spawn_should_fail.store(true, Ordering::SeqCst);

        let prim = AgentSpawnPrimitive::new("parent-limited".into(), run_starter, bus);

        let result = prim
            .invoke(serde_json::json!({
                "task": "should fail",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::ExecutionFailed(_)
        ));
    }

    #[tokio::test]
    async fn agent_status_returns_status_for_child() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");

        let channels = super::super::ask::new_ask_channels();
        let prim = AgentStatusPrimitive::new("parent-1".into(), run_starter, channels);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "child-1",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["child_name"], "child-1");
        assert_eq!(val["status"], "running");
    }

    #[tokio::test]
    async fn agent_status_rejects_non_child() {
        let run_starter = Arc::new(MockRunStarter::new());
        // No children registered

        let channels = super::super::ask::new_ask_channels();
        let prim = AgentStatusPrimitive::new("parent-1".into(), run_starter, channels);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "other-agent",
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
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");
        run_starter.add_child("child-2", "idle");

        let prim = AgentListPrimitive::new("parent-1".into(), run_starter);

        let result = prim.invoke(serde_json::json!({})).await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["count"], 2);
        assert_eq!(val["agents"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn agent_stop_delegates_to_run_starter() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");

        let prim = AgentStopPrimitive::new("parent-1".into(), run_starter.clone());

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "child-1",
            }))
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap()["status"], "stopped");
        assert!(run_starter.stopped.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn agent_dismiss_removes_child() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "idle");

        let prim = AgentDismissPrimitive::new("parent-1".into(), run_starter.clone());

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "child-1",
            }))
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap()["status"], "dismissed");
        // Verify child was removed
        assert!(run_starter.list_children("parent-1").unwrap().is_empty());
    }

    #[tokio::test]
    async fn agent_dismiss_rejects_running_child() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");
        run_starter
            .dismiss_should_fail
            .store(true, Ordering::SeqCst);

        let prim = AgentDismissPrimitive::new("parent-1".into(), run_starter);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "child-1",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::ExecutionFailed(_)
        ));
    }

    #[tokio::test]
    async fn agent_stop_rejects_non_child() {
        let run_starter = Arc::new(MockRunStarter::new());
        // No children

        let prim = AgentStopPrimitive::new("parent-1".into(), run_starter);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "not-my-child",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    // ──────────── agent.message tests ────────────

    #[tokio::test]
    async fn agent_message_sends_to_child_inbox() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");

        let inbox = new_agent_inbox();
        let prim =
            AgentMessagePrimitive::new("parent-1".into(), inbox.clone(), run_starter.clone());

        let result = prim
            .invoke(serde_json::json!({
                "to": "child-1",
                "content": "hello child",
            }))
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap()["status"], "sent");

        // Verify message landed in inbox
        let inbox = inbox.lock().unwrap();
        let messages = inbox.get("child-1").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].from, "parent-1");
        assert_eq!(messages[0].content, "hello child");
    }

    #[tokio::test]
    async fn agent_message_rejects_non_child() {
        let run_starter = Arc::new(MockRunStarter::new());
        // No children

        let inbox = new_agent_inbox();
        let prim = AgentMessagePrimitive::new("parent-1".into(), inbox, run_starter);

        let result = prim
            .invoke(serde_json::json!({
                "to": "stranger",
                "content": "hi",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    // ──────────── agent.broadcast tests ────────────

    #[tokio::test]
    async fn agent_broadcast_sends_to_all_children() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");
        run_starter.add_child("child-2", "running");

        let inbox = new_agent_inbox();
        let prim =
            AgentBroadcastPrimitive::new("parent-1".into(), inbox.clone(), run_starter.clone());

        let result = prim
            .invoke(serde_json::json!({
                "content": "attention everyone",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["count"], 2);

        let inbox = inbox.lock().unwrap();
        assert_eq!(inbox.get("child-1").unwrap().len(), 1);
        assert_eq!(inbox.get("child-2").unwrap().len(), 1);
        assert_eq!(
            inbox.get("child-1").unwrap()[0].content,
            "attention everyone"
        );
    }

    #[tokio::test]
    async fn agent_broadcast_with_no_children_sends_zero() {
        let run_starter = Arc::new(MockRunStarter::new());
        let inbox = new_agent_inbox();
        let prim = AgentBroadcastPrimitive::new("parent-1".into(), inbox, run_starter);

        let result = prim
            .invoke(serde_json::json!({
                "content": "hello?",
            }))
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap()["count"], 0);
    }

    // ──────────── agent.await tests ────────────

    #[tokio::test]
    async fn agent_await_returns_immediately_when_child_done() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.children.lock().unwrap().push(ChildInfo {
            name: "child-1".into(),
            status: "idle".into(),
            agent_type: AgentType::Ephemeral,
            hive_role: None,
            depth: 1,
            last_result: Some("task completed".into()),
        });

        let await_channels = new_agent_await_channels();
        let prim = AgentAwaitPrimitive::new("parent-1".into(), run_starter, await_channels);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "child-1",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["status"], "idle");
        assert_eq!(val["result"], "task completed");
    }

    #[tokio::test]
    async fn agent_await_blocks_until_child_completes() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");

        let await_channels = new_agent_await_channels();
        let channels_clone = await_channels.clone();

        // Simulate child completing after a short delay
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            let sender = channels_clone.lock().unwrap().remove("child-1");
            if let Some(sender) = sender {
                let _ = sender.send("result from child".to_string());
            }
        });

        let prim = AgentAwaitPrimitive::new("parent-1".into(), run_starter, await_channels);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "child-1",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["status"], "completed");
        assert_eq!(val["result"], "result from child");
    }

    #[tokio::test]
    async fn agent_await_rejects_non_child() {
        let run_starter = Arc::new(MockRunStarter::new());
        let await_channels = new_agent_await_channels();
        let prim = AgentAwaitPrimitive::new("parent-1".into(), run_starter, await_channels);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "not-mine",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn agent_await_times_out() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");

        let await_channels = new_agent_await_channels();
        let prim = AgentAwaitPrimitive::new("parent-1".into(), run_starter, await_channels);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "child-1",
                "timeout_secs": 1,
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));
    }

    // ──────────── plan.submit / plan.approve tests ────────────

    #[tokio::test]
    async fn plan_submit_blocks_until_approved() {
        let inbox = new_agent_inbox();
        let plan_channels = new_plan_approval_channels();
        let channels_clone = plan_channels.clone();

        // Simulate parent approving after a short delay
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            let sender = channels_clone
                .lock()
                .unwrap()
                .remove("parent-1-sub-abc12345");
            if let Some(sender) = sender {
                let _ = sender.send(PlanApproval {
                    approved: true,
                    feedback: Some("looks good".into()),
                });
            }
        });

        let prim =
            PlanSubmitPrimitive::new("parent-1-sub-abc12345".into(), inbox.clone(), plan_channels);

        let result = prim
            .invoke(serde_json::json!({
                "plan": "I will read files and write a summary",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["status"], "approved");
        assert_eq!(val["feedback"], "looks good");

        // Verify plan was sent to parent's inbox
        let inbox = inbox.lock().unwrap();
        let parent_msgs = inbox.get("parent-1").unwrap();
        assert_eq!(parent_msgs.len(), 1);
        assert!(parent_msgs[0].content.contains("PLAN SUBMITTED"));
    }

    #[tokio::test]
    async fn plan_submit_handles_rejection() {
        let inbox = new_agent_inbox();
        let plan_channels = new_plan_approval_channels();
        let channels_clone = plan_channels.clone();

        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            let sender = channels_clone
                .lock()
                .unwrap()
                .remove("parent-1-sub-abc12345");
            if let Some(sender) = sender {
                let _ = sender.send(PlanApproval {
                    approved: false,
                    feedback: Some("too broad, narrow the scope".into()),
                });
            }
        });

        let prim = PlanSubmitPrimitive::new("parent-1-sub-abc12345".into(), inbox, plan_channels);

        let result = prim
            .invoke(serde_json::json!({
                "plan": "I will rewrite everything",
            }))
            .await;

        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["status"], "rejected");
        assert_eq!(val["feedback"], "too broad, narrow the scope");
    }

    #[tokio::test]
    async fn plan_approve_sends_approval_to_child() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");

        let plan_channels = new_plan_approval_channels();

        // Register a pending plan from child-1
        let (tx, rx) = tokio::sync::oneshot::channel();
        plan_channels.lock().unwrap().insert("child-1".into(), tx);

        let prim = PlanApprovePrimitive::new("parent-1".into(), plan_channels, run_starter);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "child-1",
                "approved": true,
                "feedback": "proceed",
            }))
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap()["approved"], true);

        // Verify child received the approval
        let approval = rx.await.unwrap();
        assert!(approval.approved);
        assert_eq!(approval.feedback.unwrap(), "proceed");
    }

    #[tokio::test]
    async fn plan_approve_rejects_non_child() {
        let run_starter = Arc::new(MockRunStarter::new());
        // No children

        let plan_channels = new_plan_approval_channels();
        let prim = PlanApprovePrimitive::new("parent-1".into(), plan_channels, run_starter);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "stranger",
                "approved": true,
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn plan_approve_fails_when_no_pending_plan() {
        let run_starter = Arc::new(MockRunStarter::new());
        run_starter.add_child("child-1", "running");

        let plan_channels = new_plan_approval_channels();
        // No pending plan registered

        let prim = PlanApprovePrimitive::new("parent-1".into(), plan_channels, run_starter);

        let result = prim
            .invoke(serde_json::json!({
                "child_name": "child-1",
                "approved": true,
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::ExecutionFailed(_)
        ));
    }

    // ──────────── SpawnOpts / WorkspaceIsolation tests ────────────

    #[tokio::test]
    async fn agent_spawn_passes_plan_mode() {
        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        let prim = AgentSpawnPrimitive::new("parent-1".into(), run_starter, bus);

        let result = prim
            .invoke(serde_json::json!({
                "task": "careful work",
                "plan_mode": true,
            }))
            .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn agent_spawn_passes_isolation_worktree() {
        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        let prim = AgentSpawnPrimitive::new("parent-1".into(), run_starter, bus);

        let result = prim
            .invoke(serde_json::json!({
                "task": "isolated work",
                "isolation": "worktree",
            }))
            .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn agent_spawn_defaults_to_shared_isolation() {
        let bus = EventBus::new(100);
        let run_starter = Arc::new(MockRunStarter::new());

        let prim = AgentSpawnPrimitive::new("parent-1".into(), run_starter, bus);

        let result = prim
            .invoke(serde_json::json!({
                "task": "normal work",
            }))
            .await;

        assert!(result.is_ok());
    }

    #[test]
    fn workspace_isolation_default_is_shared() {
        assert_eq!(
            moxxy_types::WorkspaceIsolation::default(),
            moxxy_types::WorkspaceIsolation::Shared
        );
    }
}
