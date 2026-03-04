use moxxy_types::{EventEnvelope, EventType};

use super::listener::{EventAction, EventListener};

/// Handles hive-specific events (task lifecycle, signals, proposals).
///
/// Stateless — formats notifications only, never blocks the executor.
pub struct HiveEventListener;

impl HiveEventListener {
    pub fn new() -> Self {
        Self
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
            EventType::HiveSignalPosted,
            EventType::HiveProposalCreated,
        ]
    }

    fn handle(&mut self, event: &EventEnvelope) -> EventAction {
        let notification = match event.event_type {
            EventType::HiveTaskCreated => {
                let title = event.payload["title"].as_str().unwrap_or("untitled");
                let priority = event.payload["priority"].as_i64().unwrap_or(0);
                format!("[Hive task created: '{title}' (priority {priority})]")
            }
            EventType::HiveTaskClaimed => {
                let task_id = event.payload["task_id"].as_str().unwrap_or("unknown");
                let worker = event.payload["agent_id"].as_str().unwrap_or("unknown");
                format!("[Hive task '{task_id}' claimed by {worker}]")
            }
            EventType::HiveTaskCompleted => {
                let task_id = event.payload["task_id"].as_str().unwrap_or("unknown");
                let worker = event.payload["agent_id"].as_str().unwrap_or("unknown");
                format!("[Hive task '{task_id}' completed by {worker}]")
            }
            EventType::HiveSignalPosted => {
                let signal_type = event.payload["signal_type"].as_str().unwrap_or("signal");
                let author = event.payload["author"].as_str().unwrap_or("unknown");
                format!("[Hive signal: {signal_type} from {author}]")
            }
            EventType::HiveProposalCreated => {
                let title = event.payload["title"].as_str().unwrap_or("untitled");
                let proposer = event.payload["proposer"].as_str().unwrap_or("unknown");
                format!("[Hive proposal: '{title}' by {proposer}]")
            }
            _ => format!("[Event: {:?}]", event.event_type),
        };

        EventAction {
            notification: Some(notification),
        }
    }

    fn has_pending_work(&self) -> bool {
        false
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
    fn has_pending_work_always_false() {
        let listener = HiveEventListener::new();
        assert!(!listener.has_pending_work());
    }

    #[test]
    fn interests_returns_correct_event_types() {
        let listener = HiveEventListener::new();
        let interests = listener.interests();
        assert!(interests.contains(&EventType::HiveTaskCreated));
        assert!(interests.contains(&EventType::HiveTaskClaimed));
        assert!(interests.contains(&EventType::HiveTaskCompleted));
        assert!(interests.contains(&EventType::HiveSignalPosted));
        assert!(interests.contains(&EventType::HiveProposalCreated));
        assert_eq!(interests.len(), 5);
    }

    #[test]
    fn name_returns_hive() {
        let listener = HiveEventListener::new();
        assert_eq!(listener.name(), "hive");
    }
}
