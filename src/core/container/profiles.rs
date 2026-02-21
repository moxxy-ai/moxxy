use std::path::Path;

use super::config::CapabilityConfig;

/// Predefined image profiles for WASM agents.
/// The user can specify a profile name instead of a raw .wasm path.
pub struct ImageProfile;

impl ImageProfile {
    /// Resolve an image name to a filesystem path.
    /// Supports profile names ("base", "networked", "full") and raw paths.
    pub fn resolve(image_name: &str, workspace_dir: &Path) -> std::path::PathBuf {
        let home = dirs::home_dir().expect("Could not find home directory");
        let images_dir = home.join(".moxxy").join("images");

        match image_name {
            "base" => images_dir.join("agent_runtime.wasm"),
            "networked" => images_dir.join("agent_runtime.wasm"),
            "full" => images_dir.join("agent_runtime.wasm"),
            _ => {
                let workspace_path = workspace_dir.join(image_name);
                if workspace_path.exists() {
                    workspace_path
                } else {
                    images_dir.join(image_name)
                }
            }
        }
    }

    /// Get the default capabilities for a profile.
    pub fn default_capabilities(profile: &str) -> CapabilityConfig {
        match profile {
            "base" => CapabilityConfig {
                filesystem: vec!["./skills".to_string(), "./memory".to_string()],
                network: false,
                max_memory_mb: 128,
                env_inherit: false,
            },
            "networked" => CapabilityConfig {
                filesystem: vec!["./skills".to_string(), "./memory".to_string()],
                network: true,
                max_memory_mb: 256,
                env_inherit: false,
            },
            "full" => CapabilityConfig {
                filesystem: vec![".".to_string()],
                network: true,
                max_memory_mb: 0,
                env_inherit: true,
            },
            _ => CapabilityConfig::default(),
        }
    }
}
