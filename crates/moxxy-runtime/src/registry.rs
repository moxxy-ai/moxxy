use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
}

/// A tool definition suitable for sending to an LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

pub struct PrimitiveRegistry {
    primitives: HashMap<String, Box<dyn Primitive>>,
}

impl Default for PrimitiveRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl PrimitiveRegistry {
    pub fn new() -> Self {
        Self {
            primitives: HashMap::new(),
        }
    }

    pub fn register(&mut self, primitive: Box<dyn Primitive>) {
        let name = primitive.name().to_string();
        self.primitives.insert(name, primitive);
    }

    pub async fn invoke(
        &self,
        name: &str,
        params: serde_json::Value,
        allowed: &[String],
    ) -> Result<serde_json::Value, PrimitiveError> {
        if !allowed.contains(&name.to_string()) {
            tracing::warn!(primitive = name, "Primitive blocked by allowlist");
            return Err(PrimitiveError::AccessDenied(format!(
                "Primitive '{}' not in allowlist",
                name
            )));
        }
        let primitive = self.primitives.get(name).ok_or_else(|| {
            tracing::warn!(primitive = name, "Primitive not found in registry");
            PrimitiveError::NotFound(name.to_string())
        })?;
        tracing::debug!(primitive = name, "Dispatching primitive invoke");
        primitive.invoke(params).await
    }

    pub fn list(&self) -> Vec<&str> {
        self.primitives.keys().map(|s| s.as_str()).collect()
    }

    /// Returns tool definitions for all primitives in the allowlist.
    pub fn tool_definitions(&self, allowed: &[String]) -> Vec<ToolDefinition> {
        self.primitives
            .iter()
            .filter(|(name, _)| allowed.contains(name))
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
        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));
        let result = registry
            .invoke("echo", serde_json::json!({"msg": "hi"}), &["echo".into()])
            .await
            .unwrap();
        assert_eq!(result["msg"], "hi");
    }

    #[tokio::test]
    async fn registry_blocks_disallowed_primitive() {
        let mut registry = PrimitiveRegistry::new();
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
        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));
        let names = registry.list();
        assert!(names.contains(&"echo"));
    }

    #[test]
    fn tool_definitions_returns_correct_count() {
        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));
        let defs = registry.tool_definitions(&["echo".into()]);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].name, "echo");
        assert_eq!(defs[0].description, "Echoes the input parameters back.");
        assert!(defs[0].parameters["properties"]["msg"].is_object());
    }

    #[test]
    fn tool_definitions_respects_allowlist() {
        let mut registry = PrimitiveRegistry::new();
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
}
