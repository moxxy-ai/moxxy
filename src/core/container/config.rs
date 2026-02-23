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
