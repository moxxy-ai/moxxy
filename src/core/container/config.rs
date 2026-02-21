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
    vec!["./skills".to_string(), "./memory".to_string()]
}

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
        let config: ContainerConfig = toml::from_str(&content)?;
        info!(
            "Loaded container config: runtime={}, network={}, max_memory={}MB",
            config.runtime.r#type, config.capabilities.network, config.capabilities.max_memory_mb
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
