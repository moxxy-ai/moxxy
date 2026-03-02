use crate::provider::{Message, ModelConfig, Provider};
use crate::registry::PrimitiveRegistry;
use moxxy_core::EventBus;
use moxxy_types::{EventEnvelope, EventType};
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

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

    pub async fn execute(
        &self,
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
        &self,
        agent_id: &str,
        run_id: &str,
        task: &str,
        model_config: &ModelConfig,
    ) -> Result<String, String> {
        let mut sequence: u64 = 0;

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
        conversation.push(Message::user(task));

        let mut final_content = String::new();

        for iteration in 0..self.max_iterations {
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

            self.emit(
                agent_id,
                run_id,
                &mut sequence,
                EventType::ModelResponse,
                serde_json::json!({
                    "content_length": response.content.len(),
                    "tool_calls_count": response.tool_calls.len()
                }),
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
                break;
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
    use crate::provider::ToolCall;
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

        let executor = RunExecutor::new(bus, provider, registry, vec![]);
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

        let executor = RunExecutor::new(bus, provider, registry, vec!["echo".into()]);
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

        let executor = RunExecutor::new(bus, provider, registry, vec![]);
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

        let executor =
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

        let executor = RunExecutor::new(bus, provider, registry, vec![])
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

        let executor = RunExecutor::new(bus, provider, registry, vec!["echo".into()])
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

        let executor = RunExecutor::new(bus, provider, registry, vec!["echo".into()])
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
}
