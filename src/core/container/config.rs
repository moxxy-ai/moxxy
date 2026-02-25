use anyhow::Result;
use serde::Deserialize;
use std::path::Path;
use tracing::info;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ContainerConfig {
    #[serde(default)]
    pub runtime: RuntimeConfig,

    #[serde(default)]
    pub capabilities: CapabilityConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeConfig {
    #[serde(default = "default_runtime_type")]
    pub r#type: String,

    /// Image path or profile name: "base", "networked", "full", or a custom path
    #[serde(default)]
    pub image: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CapabilityConfig {
    #[serde(default = "default_filesystem")]
    pub filesystem: Vec<String>,

    #[serde(default)]
    pub network: bool,

    #[serde(default)]
    pub max_memory_mb: u64,

    #[serde(default)]
    pub env_inherit: bool,
}

fn default_runtime_type() -> String {
    "native".to_string()
}
fn default_filesystem() -> Vec<String> {
    vec!["./workspace".to_string()]
}

/// Allowed preopened directory names within the agent directory.
/// Only `workspace` is permitted - agents access skills and memory via host bridge functions.
const ALLOWED_FS_ENTRIES: &[&str] = &["workspace"];

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            r#type: default_runtime_type(),
            image: None,
        }
    }
}

impl Default for CapabilityConfig {
    fn default() -> Self {
        Self {
            filesystem: default_filesystem(),
            network: false,
            max_memory_mb: 0,
            env_inherit: false,
        }
    }
}

impl ContainerConfig {
    pub async fn load<P: AsRef<Path>>(workspace_dir: P) -> Result<Self> {
        let config_path = workspace_dir.as_ref().join("container.toml");
        if !config_path.exists() {
            info!("No container.toml found, using default native runtime.");
            return Ok(Self::default());
        }
        let content = tokio::fs::read_to_string(&config_path).await?;
        let mut config: ContainerConfig = toml::from_str(&content)?;

        // Security: validate filesystem entries - only allowed directories within agent dir.
        // Strip any entries that could escape the sandbox (e.g., "..", "/", ".", "./skills").
        let original_count = config.capabilities.filesystem.len();
        config.capabilities.filesystem.retain(|path| {
            let normalized = path.trim_start_matches("./").trim_end_matches('/');
            ALLOWED_FS_ENTRIES.contains(&normalized)
        });

        if config.capabilities.filesystem.len() != original_count {
            info!(
                "Stripped {} disallowed filesystem entries from container.toml",
                original_count - config.capabilities.filesystem.len()
            );
        }

        // Ensure workspace is always present
        if config.capabilities.filesystem.is_empty() {
            config.capabilities.filesystem = vec!["./workspace".to_string()];
        }

        info!(
            "Loaded container config: runtime={}, network={}, max_memory={}MB, fs={:?}",
            config.runtime.r#type,
            config.capabilities.network,
            config.capabilities.max_memory_mb,
            config.capabilities.filesystem
        );
        Ok(config)
    }

    pub fn is_wasm(&self) -> bool {
        self.runtime.r#type == "wasm"
    }
    #[allow(dead_code)]
    pub fn is_native(&self) -> bool {
        self.runtime.r#type == "native"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_native() {
        let config = ContainerConfig::default();
        assert!(!config.is_wasm());
        assert!(config.is_native());
        assert_eq!(config.runtime.r#type, "native");
        assert!(config.runtime.image.is_none());
    }

    #[test]
    fn default_capabilities() {
        let cap = CapabilityConfig::default();
        assert_eq!(cap.filesystem, vec!["./workspace".to_string()]);
        assert!(!cap.network);
        assert_eq!(cap.max_memory_mb, 0);
        assert!(!cap.env_inherit);
    }

    #[test]
    fn is_wasm_detects_wasm_runtime() {
        let mut config = ContainerConfig::default();
        config.runtime.r#type = "wasm".to_string();
        assert!(config.is_wasm());
        assert!(!config.is_native());
    }

    #[tokio::test]
    async fn load_missing_file_returns_default() {
        let tmpdir = std::env::temp_dir().join(format!("moxxy-cfg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmpdir).unwrap();
        let config = ContainerConfig::load(&tmpdir).await.unwrap();
        assert!(config.is_native());
    }

    #[tokio::test]
    async fn load_strips_disallowed_fs_entries() {
        let tmpdir = std::env::temp_dir().join(format!("moxxy-cfg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmpdir).unwrap();

        let toml_content = r#"
[runtime]
type = "wasm"

[capabilities]
filesystem = ["./workspace", "../escape", "/etc/passwd", "./skills", "./workspace"]
network = true
"#;
        std::fs::write(tmpdir.join("container.toml"), toml_content).unwrap();

        let config = ContainerConfig::load(&tmpdir).await.unwrap();
        assert!(config.is_wasm());
        assert!(config.capabilities.network);
        for entry in &config.capabilities.filesystem {
            let normalized = entry.trim_start_matches("./").trim_end_matches('/');
            assert_eq!(normalized, "workspace");
        }
    }

    #[tokio::test]
    async fn load_ensures_workspace_when_all_entries_stripped() {
        let tmpdir = std::env::temp_dir().join(format!("moxxy-cfg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmpdir).unwrap();

        let toml_content = r#"
[runtime]
type = "wasm"

[capabilities]
filesystem = ["../escape", "/root"]
"#;
        std::fs::write(tmpdir.join("container.toml"), toml_content).unwrap();

        let config = ContainerConfig::load(&tmpdir).await.unwrap();
        assert_eq!(config.capabilities.filesystem, vec!["./workspace"]);
    }

    #[test]
    fn parse_valid_toml_config() {
        let content = r#"
[runtime]
type = "wasm"
image = "base"

[capabilities]
filesystem = ["./workspace"]
network = true
max_memory_mb = 512
env_inherit = false
"#;
        let config: ContainerConfig = toml::from_str(content).unwrap();
        assert!(config.is_wasm());
        assert_eq!(config.runtime.image, Some("base".to_string()));
        assert!(config.capabilities.network);
        assert_eq!(config.capabilities.max_memory_mb, 512);
    }
}
