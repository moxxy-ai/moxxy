use moxxy_core::EventBus;
use moxxy_types::{AgentStatus, EventEnvelope, EventType};

pub struct AgentProcessConfig {
    pub agent_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub workspace_root: String,
}

pub struct AgentProcess {
    config: AgentProcessConfig,
    status: AgentStatus,
    event_bus: EventBus,
}

impl AgentProcess {
    pub fn new(config: AgentProcessConfig, event_bus: EventBus) -> Self {
        Self {
            config,
            status: AgentStatus::Idle,
            event_bus,
        }
    }

    pub fn status(&self) -> AgentStatus {
        self.status
    }

    pub fn set_status(&mut self, status: AgentStatus) {
        self.status = status;
    }

    pub fn stop(&mut self) {
        self.set_status(AgentStatus::Stopped);
    }

    pub fn agent_id(&self) -> &str {
        &self.config.agent_id
    }

    pub fn emit_lifecycle_event(&self, event_type: EventType, payload: serde_json::Value) {
        let envelope = EventEnvelope::new(
            self.config.agent_id.clone(),
            None,
            None,
            0,
            event_type,
            payload,
        );
        self.event_bus.emit(envelope);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> AgentProcessConfig {
        AgentProcessConfig {
            agent_id: "test-agent".into(),
            provider_id: "test".into(),
            model_id: "test-model".into(),
            workspace_root: "/tmp/test".into(),
        }
    }

    #[tokio::test]
    async fn agent_process_starts_and_reports_running() {
        let bus = EventBus::new(100);
        let config = test_config();
        let process = AgentProcess::new(config, bus);
        assert_eq!(process.status(), AgentStatus::Idle);
    }

    #[tokio::test]
    async fn agent_process_emits_run_started_event() {
        let bus = EventBus::new(100);
        let mut rx = bus.subscribe();
        let config = test_config();
        let process = AgentProcess::new(config, bus);
        process.emit_lifecycle_event(EventType::RunStarted, serde_json::json!({"task": "test"}));
        let event = rx.try_recv().unwrap();
        assert_eq!(event.event_type, EventType::RunStarted);
        assert_eq!(event.agent_id, "test-agent");
    }

    #[tokio::test]
    async fn agent_process_stops_gracefully() {
        let bus = EventBus::new(100);
        let config = test_config();
        let mut process = AgentProcess::new(config, bus);
        process.set_status(AgentStatus::Running);
        process.stop();
        assert_eq!(process.status(), AgentStatus::Stopped);
    }

    #[test]
    fn agent_process_exposes_agent_id() {
        let bus = EventBus::new(100);
        let config = test_config();
        let process = AgentProcess::new(config, bus);
        assert_eq!(process.agent_id(), "test-agent");
    }
}
