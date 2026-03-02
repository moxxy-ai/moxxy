use async_trait::async_trait;
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
    async fn invoke(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError>;
}

pub struct PrimitiveRegistry {
    primitives: HashMap<String, Box<dyn Primitive>>,
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
            return Err(PrimitiveError::AccessDenied(format!(
                "Primitive '{}' not in allowlist",
                name
            )));
        }
        let primitive = self
            .primitives
            .get(name)
            .ok_or_else(|| PrimitiveError::NotFound(name.to_string()))?;
        primitive.invoke(params).await
    }

    pub fn list(&self) -> Vec<&str> {
        self.primitives.keys().map(|s| s.as_str()).collect()
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
            .invoke(
                "echo",
                serde_json::json!({"msg": "hi"}),
                &["echo".into()],
            )
            .await
            .unwrap();
        assert_eq!(result["msg"], "hi");
    }

    #[tokio::test]
    async fn registry_blocks_disallowed_primitive() {
        let mut registry = PrimitiveRegistry::new();
        registry.register(Box::new(EchoPrimitive));
        let result = registry
            .invoke("echo", serde_json::json!({}), &[])
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::AccessDenied(_)));
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
}
