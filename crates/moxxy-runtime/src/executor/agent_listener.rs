use std::collections::HashSet;

use moxxy_types::{EventEnvelope, EventType};

use super::listener::{EventAction, EventListener};

/// Handles sub-agent lifecycle events (spawned via `agent.spawn` or `hive.recruit`).
///
/// Tracks active sub-agents and formats completion/failure notifications
/// that get injected into the parent agent's conversation.
pub struct AgentEventListener {
    active_subagents: HashSet<String>,
}

impl AgentEventListener {
    pub fn new() -> Self {
        Self {
            active_subagents: HashSet::new(),
        }
    }
}

impl Default for AgentEventListener {
    fn default() -> Self {
        Self::new()
    }
}

impl EventListener for AgentEventListener {
    fn name(&self) -> &str {
        "agent"
    }

    fn interests(&self) -> &[EventType] {
        &[EventType::SubagentCompleted, EventType::SubagentFailed]
    }

    fn handle(&mut self, event: &EventEnvelope) -> EventAction {
        // Events use "child_name" as the identifier
        let child_name = event.payload["child_name"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let notification = match event.event_type {
            EventType::SubagentCompleted => {
                self.active_subagents.remove(&child_name);
                let result_text = event.payload["result"].as_str().unwrap_or("(no output)");
                format!("[Sub-agent '{child_name}' completed]\n{result_text}")
            }
            EventType::SubagentFailed => {
                self.active_subagents.remove(&child_name);
                let error = event.payload["error"].as_str().unwrap_or("unknown error");
                format!("[Sub-agent '{child_name}' failed]\n{error}")
            }
            _ => format!("[Event: {:?}]", event.event_type),
        };

        EventAction {
            notification: Some(notification),
        }
    }

    fn has_pending_work(&self) -> bool {
        !self.active_subagents.is_empty()
    }

    fn on_tool_result(&mut self, tool_name: &str, result: &serde_json::Value) {
        if tool_name == "agent.spawn" || tool_name == "hive.recruit" {
            // Both agent.spawn and hive.recruit return "child_name"
            if let Some(id) = result.get("child_name").and_then(|v| v.as_str()) {
                self.active_subagents.insert(id.to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_types::EventEnvelope;

    fn make_event(event_type: EventType, payload: serde_json::Value) -> EventEnvelope {
        EventEnvelope::new("agent-1".into(), None, None, 1, event_type, payload)
    }

    #[test]
    fn on_tool_result_tracks_agent_spawn() {
        let mut listener = AgentEventListener::new();
        assert!(!listener.has_pending_work());

        listener.on_tool_result(
            "agent.spawn",
            &serde_json::json!({"child_name": "sub-1", "run_id": "run-1"}),
        );

        assert!(listener.has_pending_work());
    }

    #[test]
    fn on_tool_result_tracks_hive_recruit() {
        let mut listener = AgentEventListener::new();

        listener.on_tool_result(
            "hive.recruit",
            &serde_json::json!({"child_name": "worker-1", "run_id": "run-w1"}),
        );

        assert!(listener.has_pending_work());
    }

    #[test]
    fn on_tool_result_ignores_other_tools() {
        let mut listener = AgentEventListener::new();

        listener.on_tool_result("fs.read", &serde_json::json!({"content": "hello"}));

        assert!(!listener.has_pending_work());
    }

    #[test]
    fn handle_subagent_completed_removes_and_formats() {
        let mut listener = AgentEventListener::new();
        listener.on_tool_result("agent.spawn", &serde_json::json!({"child_name": "researcher"}));
        assert!(listener.has_pending_work());

        let event = make_event(
            EventType::SubagentCompleted,
            serde_json::json!({
                "child_name": "researcher",
                "result": "found 3 results",
            }),
        );

        let action = listener.handle(&event);
        assert!(!listener.has_pending_work());
        let notification = action.notification.unwrap();
        assert!(notification.contains("Sub-agent 'researcher' completed"));
        assert!(notification.contains("found 3 results"));
    }

    #[test]
    fn handle_subagent_failed_removes_and_formats() {
        let mut listener = AgentEventListener::new();
        listener.on_tool_result("agent.spawn", &serde_json::json!({"child_name": "worker"}));

        let event = make_event(
            EventType::SubagentFailed,
            serde_json::json!({
                "child_name": "worker",
                "error": "connection refused",
            }),
        );

        let action = listener.handle(&event);
        assert!(!listener.has_pending_work());
        let notification = action.notification.unwrap();
        assert!(notification.contains("Sub-agent 'worker' failed"));
        assert!(notification.contains("connection refused"));
    }

    #[test]
    fn interests_returns_correct_event_types() {
        let listener = AgentEventListener::new();
        let interests = listener.interests();
        assert!(interests.contains(&EventType::SubagentCompleted));
        assert!(interests.contains(&EventType::SubagentFailed));
        assert_eq!(interests.len(), 2);
    }

    #[test]
    fn name_returns_agent() {
        let listener = AgentEventListener::new();
        assert_eq!(listener.name(), "agent");
    }
}
