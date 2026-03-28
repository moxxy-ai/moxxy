use std::collections::VecDeque;

use crate::provider::ProviderResponse;

pub enum StuckAction {
    Continue,
    InjectRecovery(String),
    Abort(String),
}

pub struct StuckDetector {
    max_empty_responses: usize,
    max_repeated_tool_calls: usize,
    max_monologue_responses: usize,
    recent_tool_calls: VecDeque<(String, serde_json::Value)>,
    empty_count: usize,
    monologue_count: usize,
    tool_recovery_count: usize,
    enabled: bool,
}

impl Default for StuckDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl StuckDetector {
    pub fn new() -> Self {
        Self {
            max_empty_responses: 3,
            max_repeated_tool_calls: 3,
            max_monologue_responses: 5,
            recent_tool_calls: VecDeque::with_capacity(10),
            empty_count: 0,
            monologue_count: 0,
            tool_recovery_count: 0,
            enabled: true,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// Observe a provider response and decide whether the agent is stuck.
    pub fn observe_response(&mut self, response: &ProviderResponse) -> StuckAction {
        if !self.enabled {
            return StuckAction::Continue;
        }

        if !response.tool_calls.is_empty() {
            // Tool calls present - reset non-tool counters
            self.empty_count = 0;
            self.monologue_count = 0;
            return StuckAction::Continue;
        }

        if response.content.is_empty() {
            self.empty_count += 1;
            if self.empty_count >= self.max_empty_responses {
                return StuckAction::InjectRecovery(
                    "You have produced several empty responses. \
                     Please either use a tool to make progress or provide a final answer."
                        .to_string(),
                );
            }
        } else {
            // Has content but no tool calls - potential monologue
            self.monologue_count += 1;
            if self.monologue_count >= self.max_monologue_responses {
                return StuckAction::Abort(
                    "Agent stuck: too many consecutive responses without tool usage".to_string(),
                );
            }
        }

        StuckAction::Continue
    }

    /// Observe a tool call for repetition detection.
    pub fn observe_tool_call(&mut self, name: &str, args: &serde_json::Value) -> StuckAction {
        if !self.enabled {
            return StuckAction::Continue;
        }

        let entry = (name.to_string(), args.clone());
        self.recent_tool_calls.push_back(entry.clone());
        if self.recent_tool_calls.len() > 10 {
            self.recent_tool_calls.pop_front();
        }

        // Check for repeated identical calls
        let repeated = self
            .recent_tool_calls
            .iter()
            .rev()
            .take(self.max_repeated_tool_calls)
            .filter(|tc| tc.0 == entry.0 && tc.1 == entry.1)
            .count();

        if repeated >= self.max_repeated_tool_calls {
            self.tool_recovery_count += 1;
            if self.tool_recovery_count >= 3 {
                return StuckAction::Abort(format!(
                    "Agent stuck: `{name}` called with identical arguments repeatedly \
                     despite multiple recovery attempts",
                ));
            }
            self.recent_tool_calls.clear();
            return StuckAction::InjectRecovery(format!(
                "You have called `{name}` with identical arguments {} times in a row. \
                 Try a different approach or different parameters.",
                self.max_repeated_tool_calls,
            ));
        }

        StuckAction::Continue
    }

    pub fn reset(&mut self) {
        self.empty_count = 0;
        self.monologue_count = 0;
        self.tool_recovery_count = 0;
        self.recent_tool_calls.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::ProviderResponse;

    fn empty_response() -> ProviderResponse {
        ProviderResponse {
            content: String::new(),
            tool_calls: vec![],
            usage: None,
        }
    }

    fn text_response(content: &str) -> ProviderResponse {
        ProviderResponse {
            content: content.to_string(),
            tool_calls: vec![],
            usage: None,
        }
    }

    fn tool_response() -> ProviderResponse {
        use crate::provider::ToolCall;
        ProviderResponse {
            content: String::new(),
            tool_calls: vec![ToolCall {
                id: "call_1".into(),
                name: "fs.read".into(),
                arguments: serde_json::json!({"path": "/tmp/test"}),
            }],
            usage: None,
        }
    }

    #[test]
    fn empty_responses_trigger_recovery() {
        let mut detector = StuckDetector::new();
        // First two empties → Continue
        assert!(matches!(
            detector.observe_response(&empty_response()),
            StuckAction::Continue
        ));
        assert!(matches!(
            detector.observe_response(&empty_response()),
            StuckAction::Continue
        ));
        // Third → InjectRecovery
        assert!(matches!(
            detector.observe_response(&empty_response()),
            StuckAction::InjectRecovery(_)
        ));
    }

    #[test]
    fn repeated_tool_calls_trigger_recovery() {
        let mut detector = StuckDetector::new();
        let args = serde_json::json!({"path": "/tmp/test"});
        assert!(matches!(
            detector.observe_tool_call("fs.read", &args),
            StuckAction::Continue
        ));
        assert!(matches!(
            detector.observe_tool_call("fs.read", &args),
            StuckAction::Continue
        ));
        assert!(matches!(
            detector.observe_tool_call("fs.read", &args),
            StuckAction::InjectRecovery(_)
        ));
    }

    #[test]
    fn monologue_responses_trigger_recovery() {
        let mut detector = StuckDetector::new();
        for _ in 0..4 {
            assert!(matches!(
                detector.observe_response(&text_response("thinking...")),
                StuckAction::Continue
            ));
        }
        // Fifth monologue → Abort
        assert!(matches!(
            detector.observe_response(&text_response("still thinking...")),
            StuckAction::Abort(_)
        ));
    }

    #[test]
    fn tool_calls_reset_counters() {
        let mut detector = StuckDetector::new();
        // Two empties
        detector.observe_response(&empty_response());
        detector.observe_response(&empty_response());
        // Tool call resets
        assert!(matches!(
            detector.observe_response(&tool_response()),
            StuckAction::Continue
        ));
        // Should be back to 0, so two more empties should still be Continue
        assert!(matches!(
            detector.observe_response(&empty_response()),
            StuckAction::Continue
        ));
        assert!(matches!(
            detector.observe_response(&empty_response()),
            StuckAction::Continue
        ));
    }

    #[test]
    fn repeated_tool_calls_escalate_to_abort() {
        let mut detector = StuckDetector::new();
        let args = serde_json::json!({"path": "/tmp/test"});

        // First round: 3 identical calls → InjectRecovery
        for _ in 0..3 {
            detector.observe_tool_call("fs.read", &args);
        }
        // Second round: 3 more → InjectRecovery again
        for _ in 0..3 {
            detector.observe_tool_call("fs.read", &args);
        }
        // Third round: 3 more → Abort
        detector.observe_tool_call("fs.read", &args);
        detector.observe_tool_call("fs.read", &args);
        assert!(matches!(
            detector.observe_tool_call("fs.read", &args),
            StuckAction::Abort(_)
        ));
    }

    #[test]
    fn disabled_detector_always_continues() {
        let mut detector = StuckDetector::new();
        detector.set_enabled(false);
        for _ in 0..10 {
            assert!(matches!(
                detector.observe_response(&empty_response()),
                StuckAction::Continue
            ));
        }
        let args = serde_json::json!({"path": "/tmp/test"});
        for _ in 0..10 {
            assert!(matches!(
                detector.observe_tool_call("fs.read", &args),
                StuckAction::Continue
            ));
        }
    }
}
