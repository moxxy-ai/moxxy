use async_trait::async_trait;
use moxxy_core::SkillDoc;

use crate::registry::{Primitive, PrimitiveError};

pub struct SkillImportPrimitive;

impl Default for SkillImportPrimitive {
    fn default() -> Self {
        Self::new()
    }
}

impl SkillImportPrimitive {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Primitive for SkillImportPrimitive {
    fn name(&self) -> &str {
        "skill.import"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let content = params["content"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content' parameter".into()))?;

        let name = params["name"].as_str().unwrap_or("unknown");

        let version = params["version"].as_str().unwrap_or("0.0.0");

        // Validate frontmatter by parsing
        let _doc =
            SkillDoc::parse(content).map_err(|e| PrimitiveError::InvalidParams(e.to_string()))?;

        // All imported skills start in quarantine
        Ok(serde_json::json!({
            "status": "quarantined",
            "name": name,
            "version": version,
        }))
    }
}

pub struct SkillValidatePrimitive;

impl Default for SkillValidatePrimitive {
    fn default() -> Self {
        Self::new()
    }
}

impl SkillValidatePrimitive {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Primitive for SkillValidatePrimitive {
    fn name(&self) -> &str {
        "skill.validate"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let content = params["content"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content' parameter".into()))?;

        let doc =
            SkillDoc::parse(content).map_err(|e| PrimitiveError::InvalidParams(e.to_string()))?;

        Ok(serde_json::json!({
            "valid": true,
            "id": doc.id,
            "name": doc.name,
            "version": doc.version,
            "allowed_primitives": doc.allowed_primitives,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn skill_import_triggers_quarantine_flow() {
        let prim = SkillImportPrimitive::new();
        let result = prim
            .invoke(serde_json::json!({
                "name": "my-skill",
                "version": "1.0",
                "content": "---\nid: my-skill\nname: My Skill\nversion: \"1.0\"\ninputs_schema: {}\nallowed_primitives: [fs.read]\nsafety_notes: safe\n---\nDo stuff"
            }))
            .await
            .unwrap();
        assert_eq!(result["status"].as_str().unwrap(), "quarantined");
    }

    #[tokio::test]
    async fn skill_validate_checks_frontmatter() {
        let prim = SkillValidatePrimitive::new();
        let result = prim
            .invoke(serde_json::json!({
                "content": "no frontmatter here"
            }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn skill_validate_succeeds_for_valid_doc() {
        let prim = SkillValidatePrimitive::new();
        let result = prim
            .invoke(serde_json::json!({
                "content": "---\nid: test\nname: Test\nversion: \"1.0\"\ninputs_schema: {}\nallowed_primitives: [fs.read]\nsafety_notes: safe\n---\nBody"
            }))
            .await
            .unwrap();
        assert_eq!(result["valid"], true);
        assert_eq!(result["id"].as_str().unwrap(), "test");
    }
}
