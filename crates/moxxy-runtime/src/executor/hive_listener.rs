use std::collections::HashSet;

use moxxy_types::{EventEnvelope, EventType};

use super::listener::{EventAction, EventListener};

/// Handles hive-specific events (task lifecycle, signals, proposals).
///
/// Tracks active hive workers to prevent the queen from exiting
/// before all workers have finished.
pub struct HiveEventListener {
    active_workers: HashSet<String>,
}

impl HiveEventListener {
    pub fn new() -> Self {
        Self {
            active_workers: HashSet::new(),
        }
    }
}

impl Default for HiveEventListener {
    fn default() -> Self {
        Self::new()
    }
}

impl EventListener for HiveEventListener {
    fn name(&self) -> &str {
        "hive"
    }

    fn interests(&self) -> &[EventType] {
        &[
            EventType::HiveTaskCreated,
            EventType::HiveTaskClaimed,
            EventType::HiveTaskCompleted,
            EventType::HiveTaskFailed,
            EventType::HiveSignalPosted,
            EventType::HiveProposalCreated,
            EventType::SubagentCompleted,
            EventType::SubagentFailed,
        ]
    }

    fn handle(&mut self, event: &EventEnvelope) -> EventAction {
        let notification = match event.event_type {
            EventType::HiveTaskCreated => {
                let title = event.payload["title"].as_str().unwrap_or("untitled");
                let priority = event.payload["priority"].as_i64().unwrap_or(0);
                Some(format!(
                    "[Hive task created: '{title}' (priority {priority})]"
                ))
            }
            EventType::HiveTaskClaimed => {
                let task_id = event.payload["task_id"].as_str().unwrap_or("unknown");
                let worker = event.payload["agent_id"].as_str().unwrap_or("unknown");
                Some(format!("[Hive task '{task_id}' claimed by {worker}]"))
            }
            EventType::HiveTaskCompleted => {
                let task_id = event.payload["task_id"].as_str().unwrap_or("unknown");
                let worker = event.payload["agent_id"].as_str().unwrap_or("unknown");
                Some(format!("[Hive task '{task_id}' completed by {worker}]"))
            }
            EventType::HiveTaskFailed => {
                let task_id = event.payload["task_id"].as_str().unwrap_or("unknown");
                let worker = event.payload["agent_id"].as_str().unwrap_or("unknown");
                let reason = event.payload["reason"].as_str().unwrap_or("unknown");
                let exhausted = event.payload["retries_exhausted"]
                    .as_bool()
                    .unwrap_or(false);
                let suffix = if exhausted {
                    " (retries exhausted)"
                } else {
                    " (will retry)"
                };
                Some(format!(
                    "[Hive task '{task_id}' failed by {worker}: {reason}{suffix}]"
                ))
            }
            EventType::HiveSignalPosted => {
                let signal_type = event.payload["signal_type"].as_str().unwrap_or("signal");
                let author = event.payload["author"].as_str().unwrap_or("unknown");
                Some(format!("[Hive signal: {signal_type} from {author}]"))
            }
            EventType::HiveProposalCreated => {
                let title = event.payload["title"].as_str().unwrap_or("untitled");
                let proposer = event.payload["proposer"].as_str().unwrap_or("unknown");
                Some(format!("[Hive proposal: '{title}' by {proposer}]"))
            }
            EventType::SubagentCompleted => {
                let child = event.payload["child_name"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                self.active_workers.remove(&child);
                None // AgentEventListener handles the notification
            }
            EventType::SubagentFailed => {
                let child = event.payload["child_name"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                self.active_workers.remove(&child);
                None // AgentEventListener handles the notification
            }
            _ => Some(format!("[Event: {:?}]", event.event_type)),
        };

        EventAction { notification }
    }

    fn has_pending_work(&self) -> bool {
        !self.active_workers.is_empty()
    }

    fn on_tool_result(&mut self, tool_name: &str, result: &serde_json::Value) {
        if tool_name == "hive.recruit"
            && let Some(id) = result.get("child_name").and_then(|v| v.as_str())
        {
            self.active_workers.insert(id.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_types::EventEnvelope;

    fn make_event(event_type: EventType, payload: serde_json::Value) -> EventEnvelope {
        EventEnvelope::new("queen-1".into(), None, None, 1, event_type, payload)
    }

    #[test]
    fn handle_hive_task_created() {
        let mut listener = HiveEventListener::new();
        let event = make_event(
            EventType::HiveTaskCreated,
            serde_json::json!({
                "hive_id": "hive-1",
                "task_id": "task-1",
                "title": "Build auth module",
                "priority": 9,
            }),
        );

        let action = listener.handle(&event);
        let notification = action.notification.unwrap();
        assert!(notification.contains("Hive task created: 'Build auth module'"));
        assert!(notification.contains("priority 9"));
    }

    #[test]
    fn handle_hive_task_claimed() {
        let mut listener = HiveEventListener::new();
        let event = make_event(
            EventType::HiveTaskClaimed,
            serde_json::json!({
                "hive_id": "hive-1",
                "task_id": "task-42",
                "agent_id": "worker-3",
            }),
        );

        let action = listener.handle(&event);
        let notification = action.notification.unwrap();
        assert!(notification.contains("Hive task 'task-42' claimed by worker-3"));
    }

    #[test]
    fn handle_hive_task_completed() {
        let mut listener = HiveEventListener::new();
        let event = make_event(
            EventType::HiveTaskCompleted,
            serde_json::json!({
                "hive_id": "hive-1",
                "task_id": "task-42",
                "agent_id": "worker-2",
            }),
        );

        let action = listener.handle(&event);
        let notification = action.notification.unwrap();
        assert!(notification.contains("Hive task 'task-42' completed by worker-2"));
    }

    #[test]
    fn handle_hive_signal_posted() {
        let mut listener = HiveEventListener::new();
        let event = make_event(
            EventType::HiveSignalPosted,
            serde_json::json!({
                "hive_id": "hive-1",
                "signal_type": "discovery",
                "author": "scout-1",
            }),
        );

        let action = listener.handle(&event);
        let notification = action.notification.unwrap();
        assert!(notification.contains("Hive signal: discovery from scout-1"));
    }

    #[test]
    fn handle_hive_proposal_created() {
        let mut listener = HiveEventListener::new();
        let event = make_event(
            EventType::HiveProposalCreated,
            serde_json::json!({
                "hive_id": "hive-1",
                "title": "Refactor auth module",
                "proposer": "architect-1",
            }),
        );

        let action = listener.handle(&event);
        let notification = action.notification.unwrap();
        assert!(notification.contains("Hive proposal: 'Refactor auth module' by architect-1"));
    }

    #[test]
    fn has_pending_work_empty() {
        let listener = HiveEventListener::new();
        assert!(!listener.has_pending_work());
    }

    #[test]
    fn on_tool_result_tracks_hive_recruit() {
        let mut listener = HiveEventListener::new();
        assert!(!listener.has_pending_work());

        listener.on_tool_result(
            "hive.recruit",
            &serde_json::json!({"child_name": "worker-1", "run_id": "run-1"}),
        );

        assert!(listener.has_pending_work());
    }

    #[test]
    fn on_tool_result_ignores_other_tools() {
        let mut listener = HiveEventListener::new();

        listener.on_tool_result("fs.read", &serde_json::json!({"content": "hello"}));

        assert!(!listener.has_pending_work());
    }

    #[test]
    fn recruit_then_complete_clears_pending() {
        let mut listener = HiveEventListener::new();

        listener.on_tool_result(
            "hive.recruit",
            &serde_json::json!({"child_name": "worker-1"}),
        );
        listener.on_tool_result(
            "hive.recruit",
            &serde_json::json!({"child_name": "worker-2"}),
        );
        assert!(listener.has_pending_work());

        let event1 = make_event(
            EventType::SubagentCompleted,
            serde_json::json!({"child_name": "worker-1", "result": "done"}),
        );
        listener.handle(&event1);
        assert!(listener.has_pending_work()); // worker-2 still active

        let event2 = make_event(
            EventType::SubagentCompleted,
            serde_json::json!({"child_name": "worker-2", "result": "done"}),
        );
        listener.handle(&event2);
        assert!(!listener.has_pending_work()); // all done
    }

    #[test]
    fn recruit_then_fail_clears_pending() {
        let mut listener = HiveEventListener::new();

        listener.on_tool_result(
            "hive.recruit",
            &serde_json::json!({"child_name": "worker-1"}),
        );
        assert!(listener.has_pending_work());

        let event = make_event(
            EventType::SubagentFailed,
            serde_json::json!({"child_name": "worker-1", "error": "crash"}),
        );
        listener.handle(&event);
        assert!(!listener.has_pending_work());
    }

    #[test]
    fn interests_returns_correct_event_types() {
        let listener = HiveEventListener::new();
        let interests = listener.interests();
        assert!(interests.contains(&EventType::HiveTaskCreated));
        assert!(interests.contains(&EventType::HiveTaskClaimed));
        assert!(interests.contains(&EventType::HiveTaskCompleted));
        assert!(interests.contains(&EventType::HiveTaskFailed));
        assert!(interests.contains(&EventType::HiveSignalPosted));
        assert!(interests.contains(&EventType::HiveProposalCreated));
        assert!(interests.contains(&EventType::SubagentCompleted));
        assert!(interests.contains(&EventType::SubagentFailed));
        assert_eq!(interests.len(), 8);
    }

    #[test]
    fn name_returns_hive() {
        let listener = HiveEventListener::new();
        assert_eq!(listener.name(), "hive");
    }
}
