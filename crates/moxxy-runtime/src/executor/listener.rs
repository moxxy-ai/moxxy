use moxxy_types::{EventEnvelope, EventType};

/// Action returned by a listener after processing an event.
pub struct EventAction {
    /// Notification to inject as `Message::user()` into conversation.
    /// `None` = event consumed silently (state update only).
    pub notification: Option<String>,
}

/// Trait for modular event handling within the executor loop.
///
/// Listeners are sync (no async) - they only inspect payloads and mutate
/// in-memory state, never perform I/O. The executor owns them via `&mut self`
/// and is constructed fresh per run, so no sharing concerns arise.
pub trait EventListener: Send {
    /// Human-readable name for logging / debugging.
    fn name(&self) -> &str;

    /// Which event types this listener wants to receive.
    fn interests(&self) -> &[EventType];

    /// Handle an incoming event. Called only for events matching `interests()`.
    fn handle(&mut self, event: &EventEnvelope) -> EventAction;

    /// Whether this listener has outstanding work that should keep the
    /// executor alive even when the model returns no tool calls.
    fn has_pending_work(&self) -> bool;

    /// Called after every successful tool invocation so listeners can
    /// track spawned sub-agents, etc. Default implementation is a no-op.
    fn on_tool_result(&mut self, _tool_name: &str, _result: &serde_json::Value) {}
}
