use async_trait::async_trait;
use moxxy_core::EventBus;
use moxxy_types::{EventEnvelope, EventType};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

use crate::registry::{Primitive, PrimitiveError};

/// Shared map of pending ask channels, keyed by question_id.
pub type AskChannels = Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>;

/// Creates a new empty AskChannels map.
pub fn new_ask_channels() -> AskChannels {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Primitive that lets an agent pause and ask the user a question.
/// The agent blocks until the user responds (via REST endpoint) or the timeout expires.
pub struct UserAskPrimitive {
    event_bus: EventBus,
    ask_channels: AskChannels,
    agent_id: String,
}

impl UserAskPrimitive {
    pub fn new(event_bus: EventBus, ask_channels: AskChannels, agent_id: String) -> Self {
        Self {
            event_bus,
            ask_channels,
            agent_id,
        }
    }
}

#[async_trait]
impl Primitive for UserAskPrimitive {
    fn name(&self) -> &str {
        "user.ask"
    }

    fn description(&self) -> &str {
        "Ask the user a question and wait for their response. The agent pauses until an answer is provided."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question to ask the user"
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "How long to wait for a response (default: 300 seconds)"
                }
            },
            "required": ["question"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let question = params
            .get("question")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'question'".into()))?
            .to_string();

        let timeout_seconds = params
            .get("timeout_seconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(300);

        let question_id = uuid::Uuid::now_v7().to_string();

        tracing::info!(agent_id = %self.agent_id, %question_id, timeout_seconds, "Agent asking user question");

        // Create oneshot channel
        let (tx, rx) = oneshot::channel::<String>();

        // Store sender in shared map
        {
            let mut channels = self
                .ask_channels
                .lock()
                .map_err(|_| PrimitiveError::ExecutionFailed("lock poisoned".into()))?;
            channels.insert(question_id.clone(), tx);
        }

        // Emit event so SSE consumers / TUI can show the question
        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::UserAskQuestion,
            serde_json::json!({
                "question_id": question_id,
                "question": question,
            }),
        ));

        // Wait for answer or timeout
        let timeout = std::time::Duration::from_secs(timeout_seconds);
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(answer)) => {
                tracing::debug!(%question_id, answer_len = answer.len(), "User question answered");
                self.event_bus.emit(EventEnvelope::new(
                    self.agent_id.clone(),
                    None,
                    None,
                    0,
                    EventType::UserAskAnswered,
                    serde_json::json!({
                        "question_id": question_id,
                    }),
                ));
                Ok(serde_json::json!({
                    "question_id": question_id,
                    "answer": answer,
                }))
            }
            Ok(Err(_)) => {
                // Sender dropped without sending
                tracing::warn!(%question_id, "Ask channel closed without response");
                self.cleanup_channel(&question_id);
                Err(PrimitiveError::ExecutionFailed(
                    "ask channel closed without response".into(),
                ))
            }
            Err(_) => {
                // Timeout
                tracing::warn!(%question_id, timeout_seconds, "User question timed out");
                self.cleanup_channel(&question_id);
                Err(PrimitiveError::Timeout)
            }
        }
    }
}

impl UserAskPrimitive {
    fn cleanup_channel(&self, question_id: &str) {
        if let Ok(mut channels) = self.ask_channels.lock() {
            channels.remove(question_id);
        }
    }
}

/// Primitive that lets a parent agent respond to a sub-agent's pending question.
pub struct AgentRespondPrimitive {
    ask_channels: AskChannels,
}

impl AgentRespondPrimitive {
    pub fn new(ask_channels: AskChannels) -> Self {
        Self { ask_channels }
    }
}

#[async_trait]
impl Primitive for AgentRespondPrimitive {
    fn name(&self) -> &str {
        "agent.respond"
    }

    fn description(&self) -> &str {
        "Respond to a pending question from a sub-agent or user.ask request."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "question_id": {
                    "type": "string",
                    "description": "The question_id to respond to"
                },
                "answer": {
                    "type": "string",
                    "description": "The answer to provide"
                }
            },
            "required": ["question_id", "answer"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let question_id = params
            .get("question_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'question_id'".into()))?
            .to_string();

        let answer = params
            .get("answer")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'answer'".into()))?
            .to_string();

        tracing::info!(%question_id, answer_len = answer.len(), "Responding to agent question");

        let sender = {
            let mut channels = self
                .ask_channels
                .lock()
                .map_err(|_| PrimitiveError::ExecutionFailed("lock poisoned".into()))?;
            channels
                .remove(&question_id)
                .ok_or_else(|| PrimitiveError::NotFound(format!("question_id '{question_id}'")))?
        };

        sender
            .send(answer)
            .map_err(|_| PrimitiveError::ExecutionFailed("receiver already dropped".into()))?;

        Ok(serde_json::json!({
            "question_id": question_id,
            "status": "answered",
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_bus() -> EventBus {
        EventBus::new(100)
    }

    #[tokio::test]
    async fn user_ask_and_respond_flow() {
        let bus = test_bus();
        let channels = new_ask_channels();
        let agent_id = "agent-1".to_string();

        let ask_prim = UserAskPrimitive::new(bus.clone(), channels.clone(), agent_id);
        let respond_prim = AgentRespondPrimitive::new(channels.clone());

        // Spawn the ask in a background task
        let ask_handle = tokio::spawn(async move {
            ask_prim
                .invoke(serde_json::json!({
                    "question": "What database should I use?",
                    "timeout_seconds": 5,
                }))
                .await
        });

        // Give it a moment to register the channel
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Find the question_id from the channels map
        let question_id = {
            let channels = channels.lock().unwrap();
            assert_eq!(channels.len(), 1);
            channels.keys().next().unwrap().clone()
        };

        // Respond
        let respond_result = respond_prim
            .invoke(serde_json::json!({
                "question_id": question_id,
                "answer": "PostgreSQL",
            }))
            .await;
        assert!(respond_result.is_ok());
        let resp = respond_result.unwrap();
        assert_eq!(resp["status"], "answered");

        // Ask should complete with the answer
        let ask_result = ask_handle.await.unwrap();
        assert!(ask_result.is_ok());
        let result = ask_result.unwrap();
        assert_eq!(result["answer"], "PostgreSQL");
    }

    #[tokio::test]
    async fn user_ask_times_out() {
        let bus = test_bus();
        let channels = new_ask_channels();

        let ask_prim = UserAskPrimitive::new(bus, channels, "agent-1".into());

        let result = ask_prim
            .invoke(serde_json::json!({
                "question": "Will anyone answer?",
                "timeout_seconds": 1,
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));
    }

    #[tokio::test]
    async fn respond_to_unknown_question_returns_not_found() {
        let channels = new_ask_channels();
        let respond_prim = AgentRespondPrimitive::new(channels);

        let result = respond_prim
            .invoke(serde_json::json!({
                "question_id": "nonexistent",
                "answer": "hello",
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::NotFound(_)));
    }

    #[tokio::test]
    async fn user_ask_missing_question_returns_invalid_params() {
        let bus = test_bus();
        let channels = new_ask_channels();

        let ask_prim = UserAskPrimitive::new(bus, channels, "agent-1".into());

        let result = ask_prim.invoke(serde_json::json!({})).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn respond_missing_params_returns_invalid() {
        let channels = new_ask_channels();
        let respond_prim = AgentRespondPrimitive::new(channels);

        let result = respond_prim
            .invoke(serde_json::json!({"question_id": "abc"}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn user_ask_emits_events() {
        let bus = test_bus();
        let mut rx = bus.subscribe();
        let channels = new_ask_channels();

        let ask_prim = UserAskPrimitive::new(bus.clone(), channels.clone(), "agent-1".into());
        let respond_prim = AgentRespondPrimitive::new(channels.clone());

        let ask_handle = tokio::spawn(async move {
            ask_prim
                .invoke(serde_json::json!({
                    "question": "test?",
                    "timeout_seconds": 5,
                }))
                .await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let question_id = {
            let channels = channels.lock().unwrap();
            channels.keys().next().unwrap().clone()
        };

        respond_prim
            .invoke(serde_json::json!({
                "question_id": question_id,
                "answer": "yes",
            }))
            .await
            .unwrap();

        ask_handle.await.unwrap().unwrap();

        let mut event_types = vec![];
        while let Ok(event) = rx.try_recv() {
            event_types.push(event.event_type);
        }

        assert!(event_types.contains(&EventType::UserAskQuestion));
        assert!(event_types.contains(&EventType::UserAskAnswered));
    }

    #[tokio::test]
    async fn cleanup_on_timeout_removes_channel() {
        let bus = test_bus();
        let channels = new_ask_channels();

        let ask_prim = UserAskPrimitive::new(bus, channels.clone(), "agent-1".into());

        let _ = ask_prim
            .invoke(serde_json::json!({
                "question": "timeout test",
                "timeout_seconds": 1,
            }))
            .await;

        // Channel should be cleaned up after timeout
        let channels = channels.lock().unwrap();
        assert!(channels.is_empty());
    }
}
