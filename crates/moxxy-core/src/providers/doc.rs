use moxxy_types::ProviderDocError;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProviderModelEntry {
    pub id: String,
    pub display_name: String,
    pub api_base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chatgpt_account_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProviderDoc {
    pub id: String,
    pub display_name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_base: Option<String>,
    #[serde(default)]
    pub models: Vec<ProviderModelEntry>,
}

fn default_true() -> bool {
    true
}

impl ProviderDoc {
    /// Parse a YAML string into a `ProviderDoc`.
    pub fn parse(input: &str) -> Result<Self, ProviderDocError> {
        let doc: ProviderDoc = serde_yaml::from_str(input)
            .map_err(|e| ProviderDocError::InvalidYaml(e.to_string()))?;

        if doc.id.is_empty() {
            return Err(ProviderDocError::MissingField("id".to_string()));
        }
        if doc.display_name.is_empty() {
            return Err(ProviderDocError::MissingField("display_name".to_string()));
        }

        Ok(doc)
    }

    /// Serialize to YAML.
    pub fn to_yaml(&self) -> Result<String, ProviderDocError> {
        serde_yaml::to_string(self).map_err(|e| ProviderDocError::InvalidYaml(e.to_string()))
    }

    /// Load from a YAML file.
    pub fn load_from_file(path: &std::path::Path) -> Result<Self, ProviderDocError> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| ProviderDocError::IoError(format!("{}: {e}", path.display())))?;
        Self::parse(&content)
    }

    /// Save to a YAML file.
    pub fn save_to_file(&self, path: &std::path::Path) -> Result<(), ProviderDocError> {
        let content = self.to_yaml()?;
        std::fs::write(path, content)
            .map_err(|e| ProviderDocError::IoError(format!("{}: {e}", path.display())))
    }

    /// Find a model by id.
    pub fn find_model(&self, model_id: &str) -> Option<&ProviderModelEntry> {
        self.models.iter().find(|m| m.id == model_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_happy_path() {
        let input = r#"
id: openai
display_name: OpenAI
enabled: true
secret_ref: OPENAI_API_KEY
models:
  - id: gpt-4o
    display_name: GPT-4o
    api_base: https://api.openai.com/v1
  - id: o3
    display_name: o3
    api_base: https://api.openai.com/v1
    chatgpt_account_id: "acct-123"
"#;
        let doc = ProviderDoc::parse(input).unwrap();
        assert_eq!(doc.id, "openai");
        assert_eq!(doc.display_name, "OpenAI");
        assert!(doc.enabled);
        assert_eq!(doc.secret_ref.as_deref(), Some("OPENAI_API_KEY"));
        assert_eq!(doc.models.len(), 2);
        assert_eq!(doc.models[0].id, "gpt-4o");
        assert_eq!(
            doc.models[0].api_base.as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(
            doc.models[1].chatgpt_account_id.as_deref(),
            Some("acct-123")
        );
    }

    #[test]
    fn parse_missing_id() {
        let input = "id: \"\"\ndisplay_name: Test\n";
        let err = ProviderDoc::parse(input).unwrap_err();
        assert!(matches!(err, ProviderDocError::MissingField(_)));
    }

    #[test]
    fn parse_missing_display_name() {
        let input = "id: test\ndisplay_name: \"\"\n";
        let err = ProviderDoc::parse(input).unwrap_err();
        assert!(matches!(err, ProviderDocError::MissingField(_)));
    }

    #[test]
    fn parse_invalid_yaml() {
        let input = "not: [valid: yaml: here";
        let err = ProviderDoc::parse(input).unwrap_err();
        assert!(matches!(err, ProviderDocError::InvalidYaml(_)));
    }

    #[test]
    fn parse_defaults() {
        let input = "id: minimal\ndisplay_name: Minimal\n";
        let doc = ProviderDoc::parse(input).unwrap();
        assert!(doc.enabled);
        assert!(doc.secret_ref.is_none());
        assert!(doc.models.is_empty());
    }

    #[test]
    fn find_model_found() {
        let doc = ProviderDoc {
            id: "test".into(),
            display_name: "Test".into(),
            enabled: true,
            secret_ref: None,
            api_base: None,
            models: vec![ProviderModelEntry {
                id: "gpt-4".into(),
                display_name: "GPT-4".into(),
                api_base: Some("https://api.openai.com/v1".into()),
                chatgpt_account_id: None,
            }],
        };
        assert!(doc.find_model("gpt-4").is_some());
        assert!(doc.find_model("nonexistent").is_none());
    }

    #[test]
    fn round_trip() {
        let doc = ProviderDoc {
            id: "openai".into(),
            display_name: "OpenAI".into(),
            enabled: true,
            secret_ref: Some("OPENAI_KEY".into()),
            api_base: Some("https://api.openai.com/v1".into()),
            models: vec![ProviderModelEntry {
                id: "gpt-4o".into(),
                display_name: "GPT-4o".into(),
                api_base: Some("https://api.openai.com/v1".into()),
                chatgpt_account_id: Some("acct-1".into()),
            }],
        };
        let yaml = doc.to_yaml().unwrap();
        let parsed = ProviderDoc::parse(&yaml).unwrap();
        assert_eq!(parsed.id, doc.id);
        assert_eq!(parsed.display_name, doc.display_name);
        assert_eq!(parsed.enabled, doc.enabled);
        assert_eq!(parsed.secret_ref, doc.secret_ref);
        assert_eq!(parsed.models.len(), 1);
        assert_eq!(parsed.models[0].id, "gpt-4o");
        assert_eq!(
            parsed.models[0].chatgpt_account_id.as_deref(),
            Some("acct-1")
        );
    }

    #[test]
    fn save_and_load_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("provider.yaml");
        let doc = ProviderDoc {
            id: "file-test".into(),
            display_name: "File Test".into(),
            enabled: true,
            secret_ref: None,
            api_base: None,
            models: vec![],
        };
        doc.save_to_file(&path).unwrap();
        let loaded = ProviderDoc::load_from_file(&path).unwrap();
        assert_eq!(loaded.id, "file-test");
        assert_eq!(loaded.display_name, "File Test");
    }

    #[test]
    fn load_from_missing_file() {
        let path = std::path::Path::new("/nonexistent/provider.yaml");
        let err = ProviderDoc::load_from_file(path).unwrap_err();
        assert!(matches!(err, ProviderDocError::IoError(_)));
    }

    #[test]
    fn disabled_provider() {
        let input = "id: test\ndisplay_name: Test\nenabled: false\n";
        let doc = ProviderDoc::parse(input).unwrap();
        assert!(!doc.enabled);
    }
}
