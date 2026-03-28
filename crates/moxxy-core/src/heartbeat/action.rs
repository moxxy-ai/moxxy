use std::collections::HashMap;
use std::fmt;

use async_trait::async_trait;

use super::HeartbeatEntry;

/// Context passed to each heartbeat action when it fires.
pub struct HeartbeatActionContext {
    pub agent_id: String,
    pub entry: HeartbeatEntry,
}

/// Successful result from a heartbeat action execution.
pub struct HeartbeatActionResult {
    /// Payload merged into the HeartbeatCompleted event.
    pub payload: serde_json::Value,
}

/// Error from a heartbeat action execution.
#[derive(Debug)]
pub struct HeartbeatActionError {
    pub message: String,
}

impl fmt::Display for HeartbeatActionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Trait for heartbeat action implementations.
/// Each action type (execute_skill, notify_cli, etc.) implements this trait.
#[async_trait]
pub trait HeartbeatAction: Send + Sync {
    /// Action type name, must match `HeartbeatEntry.action_type`.
    fn action_type(&self) -> &str;

    /// Execute the action for a due heartbeat entry.
    async fn execute(
        &self,
        ctx: &HeartbeatActionContext,
    ) -> Result<HeartbeatActionResult, HeartbeatActionError>;
}

/// Registry of heartbeat actions, keyed by action_type.
pub struct HeartbeatActionRegistry {
    actions: HashMap<String, Box<dyn HeartbeatAction>>,
}

impl HeartbeatActionRegistry {
    pub fn new() -> Self {
        Self {
            actions: HashMap::new(),
        }
    }

    pub fn register(&mut self, action: Box<dyn HeartbeatAction>) {
        self.actions
            .insert(action.action_type().to_string(), action);
    }

    pub fn get(&self, action_type: &str) -> Option<&dyn HeartbeatAction> {
        self.actions.get(action_type).map(|a| a.as_ref())
    }
}

impl Default for HeartbeatActionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyAction;

    #[async_trait]
    impl HeartbeatAction for DummyAction {
        fn action_type(&self) -> &str {
            "dummy"
        }

        async fn execute(
            &self,
            _ctx: &HeartbeatActionContext,
        ) -> Result<HeartbeatActionResult, HeartbeatActionError> {
            Ok(HeartbeatActionResult {
                payload: serde_json::json!({"ok": true}),
            })
        }
    }

    #[test]
    fn registry_register_and_get() {
        let mut registry = HeartbeatActionRegistry::new();
        registry.register(Box::new(DummyAction));

        assert!(registry.get("dummy").is_some());
        assert_eq!(registry.get("dummy").unwrap().action_type(), "dummy");
        assert!(registry.get("nonexistent").is_none());
    }

    #[tokio::test]
    async fn action_execute_returns_payload() {
        let action = DummyAction;
        let ctx = HeartbeatActionContext {
            agent_id: "test-agent".into(),
            entry: HeartbeatEntry {
                id: "hb-1".into(),
                action_type: "dummy".into(),
                action_payload: None,
                interval_minutes: Some(10),
                cron_expr: None,
                timezone: "UTC".into(),
                enabled: true,
                next_run_at: "2026-03-03T12:00:00Z".into(),
                created_at: "2026-03-01T10:00:00Z".into(),
                updated_at: "2026-03-01T10:00:00Z".into(),
            },
        };
        let result = action.execute(&ctx).await.unwrap();
        assert_eq!(result.payload, serde_json::json!({"ok": true}));
    }
}
