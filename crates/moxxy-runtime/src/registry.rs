use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::primitives::REPLY_PRIMITIVE_NAME;

#[derive(Debug, thiserror::Error)]
pub enum PrimitiveError {
    #[error("access denied: {0}")]
    AccessDenied(String),
    #[error("invalid params: {0}")]
    InvalidParams(String),
    #[error("execution failed: {0}")]
    ExecutionFailed(String),
    #[error("timeout")]
    Timeout,
    #[error("size limit exceeded")]
    SizeLimitExceeded,
    #[error("not found: {0}")]
    NotFound(String),
}

impl PrimitiveError {
    pub fn is_transient(&self) -> bool {
        match self {
            PrimitiveError::ExecutionFailed(msg) => {
                msg.contains("429")
                    || msg.contains("500")
                    || msg.contains("503")
                    || msg.contains("rate_limit")
                    || msg.contains("overloaded")
            }
            PrimitiveError::Timeout => true,
            _ => false,
        }
    }
}

#[async_trait]
pub trait Primitive: Send + Sync {
    fn name(&self) -> &str;
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError>;

    /// Human-readable description of what this primitive does.
    fn description(&self) -> &str {
        ""
    }

    /// JSON Schema describing the parameters this primitive accepts.
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({"type": "object", "properties": {}})
    }

    /// Whether this primitive is safe to run concurrently with other
    /// concurrent-safe primitives.  Read-only primitives should return `true`.
    fn is_concurrent_safe(&self) -> bool {
        false
    }
}

/// A tool definition suitable for sending to an LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Clone)]
pub struct PrimitiveRegistry {
    primitives: Arc<RwLock<HashMap<String, Arc<dyn Primitive>>>>,
}

impl Default for PrimitiveRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl PrimitiveRegistry {
    pub fn new() -> Self {
        Self {
            primitives: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn register(&self, primitive: Box<dyn Primitive>) {
        let name = primitive.name().to_string();
        self.primitives
            .write()
            .unwrap()
            .insert(name, Arc::from(primitive));
    }

    pub fn deregister(&self, name: &str) -> bool {
        self.primitives.write().unwrap().remove(name).is_some()
    }

    pub async fn invoke(
        &self,
        name: &str,
        params: serde_json::Value,
        allowed: &[String],
    ) -> Result<serde_json::Value, PrimitiveError> {
        if name != REPLY_PRIMITIVE_NAME && !allowed.contains(&name.to_string()) {
            tracing::warn!(primitive = name, "Primitive blocked by allowlist");
            return Err(PrimitiveError::AccessDenied(format!(
                "Primitive '{}' not in allowlist",
                name
            )));
        }
        // Clone the Arc to avoid holding the RwLock guard across await.
        let primitive = {
            let primitives = self.primitives.read().unwrap();
            primitives.get(name).cloned()
        };
        let primitive = primitive.ok_or_else(|| {
            tracing::warn!(primitive = name, "Primitive not found in registry");
            PrimitiveError::NotFound(name.to_string())
        })?;
        tracing::debug!(primitive = name, "Dispatching primitive invoke");
        primitive.invoke(params).await
    }

    pub fn list(&self) -> Vec<String> {
        self.primitives.read().unwrap().keys().cloned().collect()
    }

    /// Check whether a primitive is concurrent-safe.
    pub fn is_concurrent_safe(&self, name: &str) -> bool {
        self.primitives
            .read()
            .unwrap()
            .get(name)
            .is_some_and(|p| p.is_concurrent_safe())
    }

    /// Returns tool definitions for all primitives in the allowlist.
    /// The `reply` primitive is always included regardless of allowlist.
    pub fn tool_definitions(&self, allowed: &[String]) -> Vec<ToolDefinition> {
        self.primitives
            .read()
            .unwrap()
            .iter()
            .filter(|(name, _)| name.as_str() == REPLY_PRIMITIVE_NAME || allowed.contains(name))
            .map(|(_, prim)| ToolDefinition {
                name: prim.name().to_string(),
                description: prim.description().to_string(),
                parameters: prim.parameters_schema(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EchoPrimitive;

    #[async_trait]
    impl Primitive for EchoPrimitive {
        fn name(&self) -> &str {
            "echo"
        }
        fn description(&self) -> &str {
            "Echoes the input parameters back."
        }
        fn parameters_schema(&self) -> serde_json::Value {
            serde_json::json!({
                "type": "object",
                "properties": {
                    "msg": {"type": "string"}
                },
                "required": ["msg"]
            })
        }
        async fn invoke(
            &self,
            params: serde_json::Value,
        ) -> Result<serde_json::Value, PrimitiveError> {
            Ok(params)
        }
    }

    #[tokio::test]
    async fn registry_register_and_invoke() {
        let registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));
        let result = registry
            .invoke("echo", serde_json::json!({"msg": "hi"}), &["echo".into()])
            .await
            .unwrap();
        assert_eq!(result["msg"], "hi");
    }

    #[tokio::test]
    async fn registry_blocks_disallowed_primitive() {
        let registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));
        let result = registry.invoke("echo", serde_json::json!({}), &[]).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn registry_returns_not_found_for_missing_primitive() {
        let registry = PrimitiveRegistry::new();
        let result = registry
            .invoke("missing", serde_json::json!({}), &["missing".into()])
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::NotFound(_)));
    }

    #[test]
    fn registry_list_returns_registered_names() {
        let registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));
        let names = registry.list();
        assert!(names.contains(&"echo".to_string()));
    }

    #[test]
    fn tool_definitions_returns_correct_count() {
        let registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));
        let defs = registry.tool_definitions(&["echo".into()]);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].name, "echo");
        assert_eq!(defs[0].description, "Echoes the input parameters back.");
        assert!(defs[0].parameters["properties"]["msg"].is_object());
    }

    #[test]
    fn tool_definitions_respects_allowlist() {
        let registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));
        let defs = registry.tool_definitions(&[]); // empty allowlist
        assert_eq!(defs.len(), 0);
    }

    #[test]
    fn tool_definition_serializes_to_json() {
        let def = ToolDefinition {
            name: "test".into(),
            description: "A test tool".into(),
            parameters: serde_json::json!({"type": "object"}),
        };
        let json = serde_json::to_string(&def).unwrap();
        assert!(json.contains("test"));
        assert!(json.contains("A test tool"));
    }

    #[test]
    fn is_transient_detects_rate_limit() {
        let err = PrimitiveError::ExecutionFailed("HTTP 429 rate_limit exceeded".into());
        assert!(err.is_transient());

        let err = PrimitiveError::ExecutionFailed("503 service overloaded".into());
        assert!(err.is_transient());

        let err = PrimitiveError::ExecutionFailed("500 internal server error".into());
        assert!(err.is_transient());

        let err = PrimitiveError::Timeout;
        assert!(err.is_transient());
    }

    #[test]
    fn is_transient_returns_false_for_access_denied() {
        let err = PrimitiveError::AccessDenied("forbidden".into());
        assert!(!err.is_transient());

        let err = PrimitiveError::InvalidParams("bad input".into());
        assert!(!err.is_transient());

        let err = PrimitiveError::NotFound("missing".into());
        assert!(!err.is_transient());

        let err = PrimitiveError::SizeLimitExceeded;
        assert!(!err.is_transient());

        let err = PrimitiveError::ExecutionFailed("permission denied".into());
        assert!(!err.is_transient());
    }
}
