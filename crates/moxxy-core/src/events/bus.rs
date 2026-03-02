use moxxy_types::EventEnvelope;
use tokio::sync::broadcast;

pub struct EventBus {
    sender: broadcast::Sender<EventEnvelope>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<EventEnvelope> {
        self.sender.subscribe()
    }

    pub fn emit(&self, envelope: EventEnvelope) {
        // Ignore error when there are no active receivers
        let _ = self.sender.send(envelope);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_types::EventType;

    #[tokio::test]
    async fn event_bus_delivers_to_all_subscribers() {
        let bus = EventBus::new(100);
        let mut rx1 = bus.subscribe();
        let mut rx2 = bus.subscribe();

        let envelope = EventEnvelope::new(
            "agent-1".into(),
            None,
            None,
            1,
            EventType::RunStarted,
            serde_json::json!({}),
        );
        bus.emit(envelope);

        let received1 = rx1.recv().await.unwrap();
        let received2 = rx2.recv().await.unwrap();
        assert_eq!(received1.event_id, received2.event_id);
    }

    #[test]
    fn event_bus_drops_when_no_subscribers() {
        let bus = EventBus::new(100);
        let envelope = EventEnvelope::new(
            "agent-1".into(),
            None,
            None,
            1,
            EventType::RunStarted,
            serde_json::json!({}),
        );
        // Should not panic even with no subscribers
        bus.emit(envelope);
    }
}
