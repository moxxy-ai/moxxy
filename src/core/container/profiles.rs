use std::path::Path;

use super::config::CapabilityConfig;

/// Predefined image profiles for WASM agents.
/// The user can specify a profile name instead of a raw .wasm path.
pub struct ImageProfile;

impl ImageProfile {
    /// Resolve an image name to a filesystem path.
    /// Supports profile names ("base", "networked", "full") and raw paths.
    pub fn resolve(image_name: &str, workspace_dir: &Path) -> std::path::PathBuf {
        use crate::platform::{NativePlatform, Platform};
        let images_dir = NativePlatform::data_dir().join("images");

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
    ///
    /// All profiles are restricted to `./workspace` only for filesystem access.
    /// Agents access skills and memory via host bridge functions, not direct FS.
    pub fn default_capabilities(profile: &str) -> CapabilityConfig {
        match profile {
            "base" => CapabilityConfig {
                filesystem: vec!["./workspace".to_string()],
                network: false,
                max_memory_mb: 128,
                env_inherit: false,
            },
            "networked" => CapabilityConfig {
                filesystem: vec!["./workspace".to_string()],
                network: true,
                max_memory_mb: 256,
                env_inherit: false,
            },
            "full" => CapabilityConfig {
                filesystem: vec!["./workspace".to_string()],
                network: true,
                max_memory_mb: 0,
                env_inherit: true,
            },
            _ => CapabilityConfig::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_profile_has_no_network() {
        let cap = ImageProfile::default_capabilities("base");
        assert!(!cap.network);
        assert_eq!(cap.max_memory_mb, 128);
        assert!(!cap.env_inherit);
        assert_eq!(cap.filesystem, vec!["./workspace"]);
    }

    #[test]
    fn networked_profile_enables_network() {
        let cap = ImageProfile::default_capabilities("networked");
        assert!(cap.network);
        assert_eq!(cap.max_memory_mb, 256);
        assert!(!cap.env_inherit);
    }

    #[test]
    fn full_profile_enables_everything() {
        let cap = ImageProfile::default_capabilities("full");
        assert!(cap.network);
        assert_eq!(cap.max_memory_mb, 0);
        assert!(cap.env_inherit);
    }

    #[test]
    fn unknown_profile_returns_default() {
        let cap = ImageProfile::default_capabilities("custom_thing");
        let default = CapabilityConfig::default();
        assert_eq!(cap.network, default.network);
        assert_eq!(cap.max_memory_mb, default.max_memory_mb);
        assert_eq!(cap.env_inherit, default.env_inherit);
    }
}
