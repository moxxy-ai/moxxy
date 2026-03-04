use crate::provider::{Message, ModelConfig, Provider};
use crate::registry::PrimitiveRegistry;
use moxxy_core::EventBus;
use moxxy_types::{EventEnvelope, EventType};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

use super::agent_listener::AgentEventListener;
use super::hive_listener::HiveEventListener;
use super::listener::EventListener;

pub struct RunExecutor {
    event_bus: EventBus,
    provider: Arc<dyn Provider>,
    registry: PrimitiveRegistry,
    max_iterations: usize,
    allowed_primitives: Vec<String>,
    cancel_token: Option<CancellationToken>,
    run_timeout: Option<Duration>,
    system_prompt: Option<String>,
    heartbeat_interval: usize,
    history: Vec<Message>,
    listeners: Vec<Box<dyn EventListener>>,
}

impl RunExecutor {
    pub fn new(
        event_bus: EventBus,
        provider: Arc<dyn Provider>,
        registry: PrimitiveRegistry,
        allowed_primitives: Vec<String>,
    ) -> Self {
        Self {
            event_bus,
            provider,
            registry,
            max_iterations: 100_000,
            allowed_primitives,
            cancel_token: None,
            run_timeout: None,
            system_prompt: None,
            heartbeat_interval: 10,
            history: Vec::new(),
            listeners: vec![
                Box::new(AgentEventListener::new()),
                Box::new(HiveEventListener::new()),
            ],
        }
    }

    pub fn with_max_iterations(mut self, max: usize) -> Self {
        self.max_iterations = max;
        self
    }

    pub fn with_heartbeat_interval(mut self, interval: usize) -> Self {
        self.heartbeat_interval = interval;
        self
    }

    pub fn with_cancel_token(mut self, token: CancellationToken) -> Self {
        self.cancel_token = Some(token);
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.run_timeout = Some(timeout);
        self
    }

    pub fn with_system_prompt(mut self, prompt: String) -> Self {
        self.system_prompt = Some(prompt);
        self
    }

    pub fn with_history(mut self, messages: Vec<Message>) -> Self {
        self.history = messages;
        self
    }

    pub fn with_listener(mut self, listener: Box<dyn EventListener>) -> Self {
        self.listeners.push(listener);
        self
    }

    pub fn without_default_listeners(mut self) -> Self {
        self.listeners.clear();
        self
    }

    pub async fn execute(
        &mut self,
        agent_id: &str,
        run_id: &str,
        task: &str,
        model_config: &ModelConfig,
    ) -> Result<String, String> {
        match self.run_timeout {
            Some(timeout) => {
                match tokio::time::timeout(
                    timeout,
                    self.execute_inner(agent_id, run_id, task, model_config),
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => {
                        let mut seq = 0;
                        self.emit(
                            agent_id,
                            run_id,
                            &mut seq,
                            EventType::RunFailed,
                            serde_json::json!({"error": "timeout"}),
                        );
                        Err("Run timed out".to_string())
                    }
                }
            }
            None => {
                self.execute_inner(agent_id, run_id, task, model_config)
                    .await
            }
        }
    }

    async fn execute_inner(
        &mut self,
        agent_id: &str,
        run_id: &str,
        task: &str,
        model_config: &ModelConfig,
    ) -> Result<String, String> {
        let mut sequence: u64 = 0;
        let mut event_rx = self.event_bus.subscribe();
        let mut pending_notifications: Vec<EventEnvelope> = Vec::new();

        // Compute interest set from all listeners once before the loop
        let interest_set: HashSet<EventType> = self
            .listeners
            .iter()
            .flat_map(|l| l.interests().iter().copied())
            .collect();

        self.emit(
            agent_id,
            run_id,
            &mut sequence,
            EventType::RunStarted,
            serde_json::json!({"task": task}),
        );

        // Compute tool definitions once before the loop
        let tool_defs = self.registry.tool_definitions(&self.allowed_primitives);

        // Build initial conversation
        let mut conversation: Vec<Message> = Vec::new();
        if let Some(ref prompt) = self.system_prompt {
            conversation.push(Message::system(prompt));
        }
        // Inject STM history (prior user/assistant pairs) before current task
        conversation.extend(self.history.iter().cloned());
        conversation.push(Message::user(task));

        let mut final_content = String::new();

        for iteration in 0..self.max_iterations {
            // Drain event bus to prevent buffer overflow and collect notifications
            loop {
                match event_rx.try_recv() {
                    Ok(ev) if ev.agent_id == agent_id && interest_set.contains(&ev.event_type) => {
                        pending_notifications.push(ev);
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }

            // Check cancellation
            if self
                .cancel_token
                .as_ref()
                .is_some_and(|token| token.is_cancelled())
            {
                self.emit(
                    agent_id,
                    run_id,
                    &mut sequence,
                    EventType::RunFailed,
                    serde_json::json!({"error": "cancelled"}),
                );
                return Err("Run cancelled".to_string());
            }

            // Emit periodic agent-alive heartbeat
            if iteration > 0
                && self.heartbeat_interval > 0
                && iteration % self.heartbeat_interval == 0
            {
                self.emit(
                    agent_id,
                    run_id,
                    &mut sequence,
                    EventType::AgentAlive,
                    serde_json::json!({
                        "iteration": iteration,
                        "messages_count": conversation.len()
                    }),
                );
            }

            self.emit(
                agent_id,
                run_id,
                &mut sequence,
                EventType::ModelRequest,
                serde_json::json!({"messages_count": conversation.len()}),
            );

            let response = match self
                .provider
                .complete(conversation.clone(), model_config, &tool_defs)
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    self.emit(
                        agent_id,
                        run_id,
                        &mut sequence,
                        EventType::RunFailed,
                        serde_json::json!({"error": e.to_string()}),
                    );
                    return Err(e.to_string());
                }
            };

            let mut model_response_payload = serde_json::json!({
                "content_length": response.content.len(),
                "tool_calls_count": response.tool_calls.len()
            });
            if let Some(usage) = &response.usage
                && let Ok(serialized_usage) = serde_json::to_value(usage)
                && let Some(map) = model_response_payload.as_object_mut()
            {
                map.insert("usage".to_string(), serialized_usage);
            }

            self.emit(
                agent_id,
                run_id,
                &mut sequence,
                EventType::ModelResponse,
                model_response_payload,
            );

            if !response.content.is_empty() {
                // Emit content in chunks for streaming feel
                let chunk_size = 80;
                let chars: Vec<char> = response.content.chars().collect();
                for chunk in chars.chunks(chunk_size) {
                    let text: String = chunk.iter().collect();
                    self.emit(
                        agent_id,
                        run_id,
                        &mut sequence,
                        EventType::MessageDelta,
                        serde_json::json!({"content": text}),
                    );
                }
                self.emit(
                    agent_id,
                    run_id,
                    &mut sequence,
                    EventType::MessageFinal,
                    serde_json::json!({"content": response.content}),
                );
                final_content.clone_from(&response.content);
            }

            if response.tool_calls.is_empty() {
                if !self.listeners.iter().any(|l| l.has_pending_work()) {
                    break;
                }

                // Active listeners have pending work — wait for an event before continuing
                self.emit(
                    agent_id,
                    run_id,
                    &mut sequence,
                    EventType::AgentAlive,
                    serde_json::json!({
                        "waiting_for_events": true,
                        "iteration": iteration,
                    }),
                );

                let maybe_event = if let Some(ev) = pending_notifications.pop() {
                    Some(ev)
                } else {
                    // Block until a relevant event arrives
                    loop {
                        tokio::select! {
                            _ = async {
                                if let Some(ref token) = self.cancel_token {
                                    token.cancelled().await;
                                } else {
                                    std::future::pending::<()>().await;
                                }
                            } => {
                                self.emit(
                                    agent_id, run_id, &mut sequence,
                                    EventType::RunFailed,
                                    serde_json::json!({"error": "cancelled"}),
                                );
                                return Err("Run cancelled".to_string());
                            }
                            result = event_rx.recv() => {
                                match result {
                                    Ok(ev) if ev.agent_id == agent_id
                                        && interest_set.contains(&ev.event_type) =>
                                    {
                                        break Some(ev);
                                    }
                                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                        break None;
                                    }
                                    _ => continue,
                                }
                            }
                        }
                    }
                };

                let Some(event) = maybe_event else {
                    // Event bus closed — cannot wait for events
                    break;
                };

                // Dispatch event to matching listener
                let notification =
                    Self::dispatch_to_listeners(&mut self.listeners, &event, &interest_set);

                self.emit(
                    agent_id,
                    run_id,
                    &mut sequence,
                    EventType::AgentAlive,
                    serde_json::json!({
                        "event_notification": true,
                        "event_type": format!("{:?}", event.event_type),
                    }),
                );

                if let Some(text) = notification {
                    conversation.push(Message::user(&text));
                }
                continue;
            }

            // Push assistant message with tool_calls metadata
            conversation.push(Message::assistant_with_tool_calls(
                &response.content,
                response.tool_calls.clone(),
            ));

            for tool_call in &response.tool_calls {
                tracing::info!(
                    agent_id,
                    run_id,
                    tool = %tool_call.name,
                    call_id = %tool_call.id,
                    arguments = %tool_call.arguments,
                    "Primitive invoked"
                );

                self.emit(
                    agent_id,
                    run_id,
                    &mut sequence,
                    EventType::PrimitiveInvoked,
                    serde_json::json!({"name": tool_call.name, "arguments": tool_call.arguments}),
                );

                match self
                    .registry
                    .invoke(
                        &tool_call.name,
                        tool_call.arguments.clone(),
                        &self.allowed_primitives,
                    )
                    .await
                {
                    Ok(result) => {
                        let result_str = serde_json::to_string(&result).unwrap_or_default();

                        // Notify all listeners of the tool result
                        for listener in &mut self.listeners {
                            listener.on_tool_result(&tool_call.name, &result);
                        }

                        tracing::info!(
                            agent_id,
                            run_id,
                            tool = %tool_call.name,
                            call_id = %tool_call.id,
                            result_len = result_str.len(),
                            "Primitive completed"
                        );

                        self.emit(
                            agent_id,
                            run_id,
                            &mut sequence,
                            EventType::PrimitiveCompleted,
                            serde_json::json!({"name": tool_call.name, "result": result}),
                        );
                        conversation.push(Message::tool_result(
                            &tool_call.id,
                            &tool_call.name,
                            result_str,
                        ));
                    }
                    Err(e) => {
                        tracing::error!(
                            agent_id,
                            run_id,
                            tool = %tool_call.name,
                            call_id = %tool_call.id,
                            error = %e,
                            "Primitive failed"
                        );

                        self.emit(
                            agent_id,
                            run_id,
                            &mut sequence,
                            EventType::PrimitiveFailed,
                            serde_json::json!({"name": tool_call.name, "error": e.to_string()}),
                        );
                        conversation.push(Message::tool_result(
                            &tool_call.id,
                            &tool_call.name,
                            format!("Error: {}", e),
                        ));
                    }
                }
            }
        }

        self.emit(
            agent_id,
            run_id,
            &mut sequence,
            EventType::RunCompleted,
            serde_json::json!({"final_content_length": final_content.len()}),
        );

        Ok(final_content)
    }

    /// Dispatch an event to the first listener whose interests match.
    /// Returns the notification text if the listener produced one.
    fn dispatch_to_listeners(
        listeners: &mut [Box<dyn EventListener>],
        event: &EventEnvelope,
        interest_set: &HashSet<EventType>,
    ) -> Option<String> {
        if !interest_set.contains(&event.event_type) {
            return None;
        }
        for listener in listeners.iter_mut() {
            if listener.interests().contains(&event.event_type) {
                let action = listener.handle(event);
                return action.notification;
            }
        }
        None
    }

    fn emit(
        &self,
        agent_id: &str,
        run_id: &str,
        seq: &mut u64,
        event_type: EventType,
        payload: serde_json::Value,
    ) {
        *seq += 1;
        let envelope = EventEnvelope::new(
            agent_id.to_string(),
            Some(run_id.to_string()),
            None,
            *seq,
            event_type,
            payload,
        );
        self.event_bus.emit(envelope);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::echo_provider::EchoProvider;
    use crate::provider::{ProviderResponse, TokenUsage, ToolCall};
    use crate::registry::{Primitive, PrimitiveError};
    use async_trait::async_trait;

    struct EchoPrimitive;

    #[async_trait]
    impl Primitive for EchoPrimitive {
        fn name(&self) -> &str {
            "echo"
        }
        async fn invoke(
            &self,
            params: serde_json::Value,
        ) -> Result<serde_json::Value, PrimitiveError> {
            Ok(params)
        }
    }

    struct UsageProvider;

    #[async_trait]
    impl Provider for UsageProvider {
        async fn complete(
            &self,
            _messages: Vec<Message>,
            _config: &ModelConfig,
            _tools: &[crate::registry::ToolDefinition],
        ) -> Result<ProviderResponse, PrimitiveError> {
            Ok(ProviderResponse {
                content: "ok".into(),
                tool_calls: vec![],
                usage: Some(TokenUsage {
                    prompt_tokens: Some(42),
                    completion_tokens: Some(8),
                    total_tokens: Some(50),
                    input_tokens: None,
                    output_tokens: None,
                }),
            })
        }
    }

    fn model_config() -> ModelConfig {
        ModelConfig {
            temperature: 0.7,
            max_tokens: 100,
        }
    }

    #[tokio::test]
    async fn execute_emits_run_started_and_completed() {
        let bus = EventBus::new(100);
        let mut rx = bus.subscribe();
        let provider = Arc::new(EchoProvider::new());
        let registry = PrimitiveRegistry::new();

        let mut executor = RunExecutor::new(bus, provider, registry, vec![]);
        let result = executor
            .execute("agent-1", "run-1", "hello", &model_config())
            .await;
        assert!(result.is_ok());

        let mut event_types = vec![];
        while let Ok(event) = rx.try_recv() {
            event_types.push(event.event_type);
        }

        assert!(event_types.contains(&EventType::RunStarted));
        assert!(event_types.contains(&EventType::ModelRequest));
        assert!(event_types.contains(&EventType::ModelResponse));
        assert!(event_types.contains(&EventType::MessageDelta));
        assert!(event_types.contains(&EventType::MessageFinal));
        assert!(event_types.contains(&EventType::RunCompleted));
    }

    #[tokio::test]
    async fn execute_handles_tool_calls() {
        let bus = EventBus::new(100);
        let mut rx = bus.subscribe();

        let provider = Arc::new(EchoProvider::new().with_tool_calls(vec![ToolCall {
            id: "call_0".into(),
            name: "echo".into(),
            arguments: serde_json::json!({"msg": "hi"}),
        }]));

        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));

        let mut executor = RunExecutor::new(bus, provider, registry, vec!["echo".into()]);
        let result = executor
            .execute("agent-1", "run-1", "test tool", &model_config())
            .await;
        assert!(result.is_ok());

        let mut event_types = vec![];
        while let Ok(event) = rx.try_recv() {
            event_types.push(event.event_type);
        }

        assert!(event_types.contains(&EventType::PrimitiveInvoked));
        assert!(event_types.contains(&EventType::PrimitiveCompleted));
    }

    #[tokio::test]
    async fn execute_all_events_have_correct_agent_and_run_id() {
        let bus = EventBus::new(100);
        let mut rx = bus.subscribe();
        let provider = Arc::new(EchoProvider::new());
        let registry = PrimitiveRegistry::new();

        let mut executor = RunExecutor::new(bus, provider, registry, vec![]);
        executor
            .execute("my-agent", "my-run", "task", &model_config())
            .await
            .unwrap();

        while let Ok(event) = rx.try_recv() {
            assert_eq!(event.agent_id, "my-agent");
            assert_eq!(event.run_id, Some("my-run".into()));
        }
    }

    #[tokio::test]
    async fn model_response_event_includes_usage_when_provider_reports_it() {
        let bus = EventBus::new(100);
        let mut rx = bus.subscribe();
        let provider = Arc::new(UsageProvider);
        let registry = PrimitiveRegistry::new();

        let mut executor = RunExecutor::new(bus, provider, registry, vec![]);
        executor
            .execute("agent-usage", "run-usage", "count tokens", &model_config())
            .await
            .unwrap();

        let mut seen_usage = false;
        while let Ok(event) = rx.try_recv() {
            if event.event_type == EventType::ModelResponse {
                assert_eq!(event.payload["usage"]["prompt_tokens"], 42);
                assert_eq!(event.payload["usage"]["completion_tokens"], 8);
                assert_eq!(event.payload["usage"]["total_tokens"], 50);
                seen_usage = true;
            }
        }
        assert!(seen_usage);
    }

    #[tokio::test]
    async fn execute_respects_max_iterations() {
        let bus = EventBus::new(1000);
        let mut rx = bus.subscribe();

        // Provider always returns tool calls => would loop forever without max
        let provider = Arc::new(EchoProvider::new().with_tool_calls(vec![ToolCall {
            id: "call_0".into(),
            name: "echo".into(),
            arguments: serde_json::json!({}),
        }]));

        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));

        let mut executor =
            RunExecutor::new(bus, provider, registry, vec!["echo".into()]).with_max_iterations(2);

        let result = executor
            .execute("agent-1", "run-1", "loop test", &model_config())
            .await;
        assert!(result.is_ok());

        let mut model_request_count = 0;
        while let Ok(event) = rx.try_recv() {
            if event.event_type == EventType::ModelRequest {
                model_request_count += 1;
            }
        }
        assert_eq!(model_request_count, 2);
    }

    #[tokio::test]
    async fn execute_with_system_prompt() {
        let bus = EventBus::new(100);
        let provider = Arc::new(EchoProvider::new());
        let registry = PrimitiveRegistry::new();

        let mut executor = RunExecutor::new(bus, provider, registry, vec![])
            .with_system_prompt("You are a helpful agent.".into());

        let result = executor
            .execute("agent-1", "run-1", "hi", &model_config())
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn execute_default_max_iterations_is_high() {
        let bus = EventBus::new(100);
        let provider = Arc::new(EchoProvider::new());
        let registry = PrimitiveRegistry::new();

        let executor = RunExecutor::new(bus, provider, registry, vec![]);
        assert_eq!(executor.max_iterations, 100_000);
        assert_eq!(executor.heartbeat_interval, 10);
    }

    #[tokio::test]
    async fn agent_alive_emitted_at_heartbeat_interval() {
        let bus = EventBus::new(1000);
        let mut rx = bus.subscribe();

        // Provider always returns tool calls => loops until max_iterations
        let provider = Arc::new(
            EchoProvider::new()
                .with_tool_calls(vec![ToolCall {
                    id: "call_0".into(),
                    name: "echo".into(),
                    arguments: serde_json::json!({}),
                }])
                .with_always_call_tools(),
        );

        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));

        let mut executor = RunExecutor::new(bus, provider, registry, vec!["echo".into()])
            .with_max_iterations(6)
            .with_heartbeat_interval(3);

        executor
            .execute("agent-1", "run-1", "heartbeat test", &model_config())
            .await
            .unwrap();

        let mut alive_payloads = vec![];
        while let Ok(event) = rx.try_recv() {
            if event.event_type == EventType::AgentAlive {
                alive_payloads.push(event.payload);
            }
        }

        // With max_iterations=6 and interval=3, alive should fire at iteration 3 (not 0)
        assert_eq!(alive_payloads.len(), 1);
        assert_eq!(alive_payloads[0]["iteration"], 3);
    }

    #[tokio::test]
    async fn execute_with_history_includes_prior_messages() {
        let bus = EventBus::new(100);
        let provider = Arc::new(EchoProvider::new());
        let registry = PrimitiveRegistry::new();

        let history = vec![Message::user("What is 2+2?"), Message::assistant("4")];

        let mut executor = RunExecutor::new(bus, provider, registry, vec![]).with_history(history);

        let result = executor
            .execute("agent-1", "run-2", "What about 3+3?", &model_config())
            .await;
        assert!(result.is_ok());
        // EchoProvider echoes the last user message, which is the current task
        assert!(result.unwrap().contains("3+3"));
    }

    #[tokio::test]
    async fn execute_with_empty_history_behaves_same_as_no_history() {
        let bus1 = EventBus::new(100);
        let bus2 = EventBus::new(100);
        let provider1 = Arc::new(EchoProvider::new());
        let provider2 = Arc::new(EchoProvider::new());

        // Without history
        let mut executor1 = RunExecutor::new(bus1, provider1, PrimitiveRegistry::new(), vec![]);
        let result1 = executor1
            .execute("agent-1", "run-1", "hello", &model_config())
            .await
            .unwrap();

        // With empty history
        let mut executor2 = RunExecutor::new(bus2, provider2, PrimitiveRegistry::new(), vec![])
            .with_history(vec![]);
        let result2 = executor2
            .execute("agent-1", "run-1", "hello", &model_config())
            .await
            .unwrap();

        assert_eq!(result1, result2);
    }

    #[tokio::test]
    async fn full_agentic_loop_with_tool_call_id() {
        let bus = EventBus::new(100);
        let mut rx = bus.subscribe();

        // EchoProvider returns one tool call, then on second call (with tool result) returns none
        let provider = Arc::new(EchoProvider::new().with_tool_calls(vec![ToolCall {
            id: "call_abc".into(),
            name: "echo".into(),
            arguments: serde_json::json!({"msg": "test"}),
        }]));

        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));

        let mut executor = RunExecutor::new(bus, provider, registry, vec!["echo".into()])
            .with_system_prompt("You are a test agent.".into());

        let result = executor
            .execute("agent-1", "run-1", "do something", &model_config())
            .await;
        assert!(result.is_ok());

        // Should have: RunStarted, ModelRequest, ModelResponse, PrimitiveInvoked,
        // PrimitiveCompleted, ModelRequest (2nd), ModelResponse (2nd),
        // MessageDelta, MessageFinal, RunCompleted
        let mut events = vec![];
        while let Ok(event) = rx.try_recv() {
            events.push(event.event_type);
        }

        assert!(events.contains(&EventType::RunStarted));
        assert!(events.contains(&EventType::PrimitiveInvoked));
        assert!(events.contains(&EventType::PrimitiveCompleted));
        assert!(events.contains(&EventType::RunCompleted));
        // Two model requests (one for initial, one after tool result)
        assert_eq!(
            events
                .iter()
                .filter(|e| **e == EventType::ModelRequest)
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn executor_waits_for_subagent_completion() {
        let bus = EventBus::new(100);
        let bus_clone = bus.clone();
        let mut rx = bus.subscribe();

        // Provider returns agent.spawn tool call first, then echoes (no tools)
        let provider = Arc::new(EchoProvider::new().with_tool_calls(vec![ToolCall {
            id: "call_spawn".into(),
            name: "agent.spawn".into(),
            arguments: serde_json::json!({"task": "subtask"}),
        }]));

        // Fake agent.spawn primitive that returns a sub_agent_id
        struct FakeSpawnPrimitive;
        #[async_trait]
        impl Primitive for FakeSpawnPrimitive {
            fn name(&self) -> &str {
                "agent.spawn"
            }
            async fn invoke(
                &self,
                _params: serde_json::Value,
            ) -> Result<serde_json::Value, PrimitiveError> {
                Ok(serde_json::json!({"sub_agent_id": "sub-1", "run_id": "run-sub"}))
            }
        }

        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(FakeSpawnPrimitive));

        // Emit SubagentCompleted after a short delay (simulates sub-agent finishing)
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            bus_clone.emit(EventEnvelope::new(
                "parent-agent".into(),
                None,
                None,
                0,
                EventType::SubagentCompleted,
                serde_json::json!({
                    "sub_agent_id": "sub-1",
                    "name": "sub-agent-1",
                    "result": "subtask done",
                }),
            ));
        });

        let mut executor = RunExecutor::new(bus, provider, registry, vec!["agent.spawn".into()])
            .with_timeout(Duration::from_secs(10));

        let result = executor
            .execute("parent-agent", "run-1", "do task", &model_config())
            .await;

        assert!(
            result.is_ok(),
            "executor should complete: {:?}",
            result.err()
        );
        let content = result.unwrap();
        assert!(
            content.contains("Sub-agent"),
            "final content should reference sub-agent notification: {content}"
        );

        // Should have at least 3 model requests:
        // 1. initial task
        // 2. after agent.spawn tool result (returns no tools → enters wait)
        // 3. after sub-agent notification injected
        let mut model_requests = 0;
        while let Ok(event) = rx.try_recv() {
            if event.event_type == EventType::ModelRequest {
                model_requests += 1;
            }
        }
        assert!(
            model_requests >= 3,
            "expected at least 3 model requests, got {model_requests}"
        );
    }

    #[tokio::test]
    async fn executor_waits_for_hive_recruit_completion() {
        let bus = EventBus::new(100);
        let bus_clone = bus.clone();
        let mut rx = bus.subscribe();

        // Provider returns hive.recruit tool call first, then echoes (no tools)
        let provider = Arc::new(EchoProvider::new().with_tool_calls(vec![ToolCall {
            id: "call_recruit".into(),
            name: "hive.recruit".into(),
            arguments: serde_json::json!({"task": "research", "role": "worker"}),
        }]));

        // Fake hive.recruit primitive that returns a sub_agent_id
        struct FakeRecruitPrimitive;
        #[async_trait]
        impl Primitive for FakeRecruitPrimitive {
            fn name(&self) -> &str {
                "hive.recruit"
            }
            async fn invoke(
                &self,
                _params: serde_json::Value,
            ) -> Result<serde_json::Value, PrimitiveError> {
                Ok(
                    serde_json::json!({"sub_agent_id": "worker-1", "run_id": "run-w1", "role": "worker"}),
                )
            }
        }

        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(FakeRecruitPrimitive));

        // Emit SubagentCompleted after a short delay (simulates worker finishing)
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            bus_clone.emit(EventEnvelope::new(
                "queen-agent".into(),
                None,
                None,
                0,
                EventType::SubagentCompleted,
                serde_json::json!({
                    "sub_agent_id": "worker-1",
                    "name": "worker-1",
                    "result": "research done",
                }),
            ));
        });

        let mut executor = RunExecutor::new(bus, provider, registry, vec!["hive.recruit".into()])
            .with_timeout(Duration::from_secs(10));

        let result = executor
            .execute("queen-agent", "run-1", "coordinate hive", &model_config())
            .await;

        assert!(
            result.is_ok(),
            "executor should complete: {:?}",
            result.err()
        );
        let content = result.unwrap();
        assert!(
            content.contains("Sub-agent"),
            "final content should reference sub-agent notification: {content}"
        );

        let mut model_requests = 0;
        while let Ok(event) = rx.try_recv() {
            if event.event_type == EventType::ModelRequest {
                model_requests += 1;
            }
        }
        assert!(
            model_requests >= 3,
            "expected at least 3 model requests, got {model_requests}"
        );
    }

    #[tokio::test]
    async fn executor_wakes_on_hive_task_completed() {
        let bus = EventBus::new(100);
        let bus_clone = bus.clone();
        let mut rx = bus.subscribe();

        // Provider returns hive.recruit tool call first, then echoes (no tools)
        let provider = Arc::new(EchoProvider::new().with_tool_calls(vec![ToolCall {
            id: "call_recruit".into(),
            name: "hive.recruit".into(),
            arguments: serde_json::json!({"task": "work", "role": "worker"}),
        }]));

        struct FakeRecruitPrimitive;
        #[async_trait]
        impl Primitive for FakeRecruitPrimitive {
            fn name(&self) -> &str {
                "hive.recruit"
            }
            async fn invoke(
                &self,
                _params: serde_json::Value,
            ) -> Result<serde_json::Value, PrimitiveError> {
                Ok(
                    serde_json::json!({"sub_agent_id": "worker-2", "run_id": "run-w2", "role": "worker"}),
                )
            }
        }

        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(FakeRecruitPrimitive));

        // Emit HiveTaskCompleted first, then SubagentCompleted
        let bus_clone2 = bus_clone.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            // HiveTaskCompleted wakes the queen mid-wait (worker is still alive)
            bus_clone.emit(EventEnvelope::new(
                "queen-agent".into(),
                None,
                None,
                0,
                EventType::HiveTaskCompleted,
                serde_json::json!({
                    "hive_id": "hive-1",
                    "task_id": "task-42",
                    "agent_id": "worker-2",
                }),
            ));
            tokio::time::sleep(Duration::from_millis(100)).await;
            // SubagentCompleted ends the wait
            bus_clone2.emit(EventEnvelope::new(
                "queen-agent".into(),
                None,
                None,
                0,
                EventType::SubagentCompleted,
                serde_json::json!({
                    "sub_agent_id": "worker-2",
                    "name": "worker-2",
                    "result": "all tasks done",
                }),
            ));
        });

        let mut executor = RunExecutor::new(bus, provider, registry, vec!["hive.recruit".into()])
            .with_timeout(Duration::from_secs(10));

        let result = executor
            .execute("queen-agent", "run-1", "coordinate hive", &model_config())
            .await;

        assert!(
            result.is_ok(),
            "executor should complete: {:?}",
            result.err()
        );
        let content = result.unwrap();
        // The queen should have seen the hive task notification
        assert!(
            content.contains("Hive task") || content.contains("Sub-agent"),
            "final content should reference hive task or sub-agent notification: {content}"
        );

        // Should have at least 4 model requests:
        // 1. initial task
        // 2. after hive.recruit tool result (enters wait)
        // 3. after HiveTaskCompleted notification
        // 4. after SubagentCompleted notification
        let mut model_requests = 0;
        while let Ok(event) = rx.try_recv() {
            if event.event_type == EventType::ModelRequest {
                model_requests += 1;
            }
        }
        assert!(
            model_requests >= 4,
            "expected at least 4 model requests, got {model_requests}"
        );
    }

    #[tokio::test]
    async fn custom_listener_receives_events() {
        use super::super::listener::{EventAction, EventListener};

        struct MockListener {
            handled: std::sync::Arc<std::sync::Mutex<Vec<EventType>>>,
        }

        impl EventListener for MockListener {
            fn name(&self) -> &str {
                "mock"
            }
            fn interests(&self) -> &[EventType] {
                &[EventType::SubagentCompleted]
            }
            fn handle(&mut self, event: &EventEnvelope) -> EventAction {
                self.handled.lock().unwrap().push(event.event_type);
                EventAction {
                    notification: Some("[mock handled]".to_string()),
                }
            }
            fn has_pending_work(&self) -> bool {
                false
            }
        }

        let bus = EventBus::new(100);
        let provider = Arc::new(EchoProvider::new());
        let registry = PrimitiveRegistry::new();

        let handled = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let mock = MockListener {
            handled: handled.clone(),
        };

        let mut executor = RunExecutor::new(bus, provider, registry, vec![])
            .without_default_listeners()
            .with_listener(Box::new(mock));

        // No tool calls, no pending work → exits immediately
        let result = executor
            .execute("agent-1", "run-1", "test", &model_config())
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn executor_without_listeners_exits_immediately() {
        let bus = EventBus::new(100);
        let provider = Arc::new(EchoProvider::new());
        let registry = PrimitiveRegistry::new();

        let mut executor =
            RunExecutor::new(bus, provider, registry, vec![]).without_default_listeners();

        let result = executor
            .execute("agent-1", "run-1", "test", &model_config())
            .await;
        assert!(result.is_ok());
    }
}
