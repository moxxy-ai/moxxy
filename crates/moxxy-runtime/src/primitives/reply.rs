use async_trait::async_trait;
use serde_json::json;

use crate::registry::{Primitive, PrimitiveError};

/// Primitive that signals the agent is done and delivers a final response.
///
/// When the executor detects a `reply` tool call, it captures the message
/// and terminates the agentic loop.  Combined with `tool_choice: any` this
/// guarantees the model always calls a real tool — it can never "fake" an
/// action by producing bare text.
pub struct ReplyPrimitive;

pub const REPLY_PRIMITIVE_NAME: &str = "reply";

#[async_trait]
impl Primitive for ReplyPrimitive {
    fn name(&self) -> &str {
        REPLY_PRIMITIVE_NAME
    }

    fn description(&self) -> &str {
        "Send a final response message and end the current task. \
         Call this tool when you have completed the task or want to communicate your answer."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "The final response message to deliver"
                }
            },
            "required": ["message"]
        })
    }

    async fn invoke(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let message = params
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        Ok(json!({ "delivered": true, "message": message }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_primitive_name() {
        let p = ReplyPrimitive;
        assert_eq!(p.name(), "reply");
    }

    #[test]
    fn reply_primitive_description_is_non_empty() {
        let p = ReplyPrimitive;
        assert!(!p.description().is_empty());
    }

    #[test]
    fn reply_primitive_schema_requires_message() {
        let p = ReplyPrimitive;
        let schema = p.parameters_schema();
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&json!("message")));
    }

    #[tokio::test]
    async fn reply_primitive_returns_message() {
        let p = ReplyPrimitive;
        let result = p.invoke(json!({"message": "All done!"})).await.unwrap();
        assert_eq!(result["delivered"], true);
        assert_eq!(result["message"], "All done!");
    }

    #[tokio::test]
    async fn reply_primitive_handles_missing_message() {
        let p = ReplyPrimitive;
        let result = p.invoke(json!({})).await.unwrap();
        assert_eq!(result["delivered"], true);
        assert_eq!(result["message"], "");
    }
}
