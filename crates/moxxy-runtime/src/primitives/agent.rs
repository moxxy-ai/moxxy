use async_trait::async_trait;
use moxxy_core::EventBus;
use moxxy_types::{AgentType, EventEnvelope, EventType, RunStarter, SpawnOpts};
use std::sync::Arc;

use super::ask::AskChannels;
use crate::registry::{Primitive, PrimitiveError};

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

        let result = self
            .run_starter
            .spawn_child(
                &self.parent_name,
                &task,
                SpawnOpts {
                    agent_type: AgentType::Ephemeral,
                    model_id,
                    hive_role: None,
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

        Ok(serde_json::json!({
            "child_name": child_name,
            "status": child.status,
            "has_pending_question": has_pending_question,
        }))
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
            let child_name = format!("parent-1-sub-abc12345");
            self.children.lock().unwrap().push(ChildInfo {
                name: child_name.clone(),
                status: "running".to_string(),
                agent_type: opts.agent_type,
                hive_role: opts.hive_role,
                depth: 1,
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
}
