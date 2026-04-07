use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Controls how domain allowlists are enforced for network primitives
/// (`browse.fetch`, `http.request`).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NetworkMode {
    /// Default. When a domain is not in the allowlist the primitive returns
    /// an instructive result telling the agent to ask the user via `user.ask`
    /// and, if approved, add the domain with `allowlist.add` before retrying.
    #[default]
    Safe,
    /// The domain allowlist is skipped entirely — any domain is allowed.
    Unsafe,
}

/// Global Moxxy settings loaded from `{moxxy_home}/settings.yaml`.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct SystemSettings {
    #[serde(default)]
    pub network_mode: NetworkMode,
    #[serde(default)]
    pub browser_rendering: bool,
}

impl SystemSettings {
    /// Load settings from the YAML file at `path`.
    /// Returns defaults if the file doesn't exist or is invalid.
    pub fn load(path: &Path) -> Self {
        let Ok(content) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        if content.trim().is_empty() {
            return Self::default();
        }
        serde_yaml::from_str(&content).unwrap_or_default()
    }

    /// Persist settings to the YAML file at `path`.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create settings dir: {}", e))?;
        }
        let content = serde_yaml::to_string(self)
            .map_err(|e| format!("failed to serialize settings: {}", e))?;
        std::fs::write(path, content).map_err(|e| format!("failed to write settings: {}", e))
    }
}

/// Canonical path for the global settings file.
pub fn settings_path(moxxy_home: &Path) -> PathBuf {
    moxxy_home.join("settings.yaml")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn default_network_mode_is_safe() {
        let settings = SystemSettings::default();
        assert_eq!(settings.network_mode, NetworkMode::Safe);
    }

    #[test]
    fn load_returns_defaults_for_missing_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.yaml");
        let settings = SystemSettings::load(&path);
        assert_eq!(settings.network_mode, NetworkMode::Safe);
    }

    #[test]
    fn load_returns_defaults_for_empty_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.yaml");
        std::fs::write(&path, "").unwrap();
        let settings = SystemSettings::load(&path);
        assert_eq!(settings.network_mode, NetworkMode::Safe);
    }

    #[test]
    fn round_trip_safe_mode() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.yaml");
        let settings = SystemSettings {
            network_mode: NetworkMode::Safe,
            browser_rendering: false,
        };
        settings.save(&path).unwrap();
        let loaded = SystemSettings::load(&path);
        assert_eq!(loaded.network_mode, NetworkMode::Safe);
    }

    #[test]
    fn round_trip_unsafe_mode() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.yaml");
        let settings = SystemSettings {
            network_mode: NetworkMode::Unsafe,
            browser_rendering: false,
        };
        settings.save(&path).unwrap();
        let loaded = SystemSettings::load(&path);
        assert_eq!(loaded.network_mode, NetworkMode::Unsafe);
    }

    #[test]
    fn deserializes_from_yaml_string() {
        let yaml = "network_mode: unsafe\n";
        let settings: SystemSettings = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(settings.network_mode, NetworkMode::Unsafe);
    }

    #[test]
    fn deserializes_safe_from_yaml() {
        let yaml = "network_mode: safe\n";
        let settings: SystemSettings = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(settings.network_mode, NetworkMode::Safe);
    }

    #[test]
    fn settings_path_is_correct() {
        let home = Path::new("/home/test/.moxxy");
        assert_eq!(
            settings_path(home),
            PathBuf::from("/home/test/.moxxy/settings.yaml")
        );
    }

    #[test]
    fn default_browser_rendering_is_false() {
        let settings = SystemSettings::default();
        assert!(!settings.browser_rendering);
    }

    #[test]
    fn round_trip_browser_rendering() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.yaml");
        let settings = SystemSettings {
            network_mode: NetworkMode::Safe,
            browser_rendering: true,
        };
        settings.save(&path).unwrap();
        let loaded = SystemSettings::load(&path);
        assert!(loaded.browser_rendering);
    }

    #[test]
    fn browser_rendering_defaults_when_missing() {
        let yaml = "network_mode: safe\n";
        let settings: SystemSettings = serde_yaml::from_str(yaml).unwrap();
        assert!(!settings.browser_rendering);
    }
}
