use serde::Deserialize;

use crate::PluginError;

fn default_fuel_limit() -> u64 {
    1_000_000_000
}

fn default_memory_limit_bytes() -> usize {
    256 * 1024 * 1024
}

#[derive(Debug, Clone, Deserialize)]
pub struct PluginManifest {
    pub provider_id: String,
    pub wasm_path: String,
    #[serde(default)]
    pub sig_path: Option<String>,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default = "default_fuel_limit")]
    pub fuel_limit: u64,
    #[serde(default = "default_memory_limit_bytes")]
    pub memory_limit_bytes: usize,
}

impl PluginManifest {
    pub fn from_yaml(content: &str) -> Result<Self, PluginError> {
        serde_yaml::from_str(content).map_err(|e| PluginError::ManifestError(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_yaml_manifest() {
        let yaml = r#"
provider_id: my-provider
wasm_path: /path/to/module.wasm
sig_path: /path/to/module.sig
allowed_domains:
  - api.example.com
fuel_limit: 500000
memory_limit_bytes: 134217728
"#;
        let manifest = PluginManifest::from_yaml(yaml).unwrap();
        assert_eq!(manifest.provider_id, "my-provider");
        assert_eq!(manifest.wasm_path, "/path/to/module.wasm");
        assert_eq!(manifest.sig_path.as_deref(), Some("/path/to/module.sig"));
        assert_eq!(manifest.allowed_domains, vec!["api.example.com"]);
        assert_eq!(manifest.fuel_limit, 500_000);
        assert_eq!(manifest.memory_limit_bytes, 134_217_728);
    }

    #[test]
    fn defaults_applied_when_fields_omitted() {
        let yaml = r#"
provider_id: minimal
wasm_path: module.wasm
"#;
        let manifest = PluginManifest::from_yaml(yaml).unwrap();
        assert_eq!(manifest.provider_id, "minimal");
        assert!(manifest.sig_path.is_none());
        assert!(manifest.allowed_domains.is_empty());
        assert_eq!(manifest.fuel_limit, 1_000_000_000);
        assert_eq!(manifest.memory_limit_bytes, 256 * 1024 * 1024);
    }

    #[test]
    fn invalid_yaml_returns_error() {
        let yaml = "not: [valid: yaml: {{";
        let result = PluginManifest::from_yaml(yaml);
        assert!(result.is_err());
        match result.unwrap_err() {
            PluginError::ManifestError(msg) => assert!(!msg.is_empty()),
            other => panic!("expected ManifestError, got {:?}", other),
        }
    }

    #[test]
    fn missing_required_field_returns_error() {
        let yaml = r#"
wasm_path: module.wasm
"#;
        let result = PluginManifest::from_yaml(yaml);
        assert!(result.is_err());
    }
}
