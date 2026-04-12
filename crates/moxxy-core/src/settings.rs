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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt: Option<SttSettings>,
}

/// Speech-to-text configuration. When `None`, voice messages are rejected.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SttSettings {
    /// Provider identifier. Currently only `"whisper"` is implemented.
    pub provider: String,
    /// Model name, e.g. `"whisper-1"`.
    pub model: String,
    /// Optional API base override (for Groq/self-host compatibility).
    #[serde(default)]
    pub api_base: Option<String>,
    /// Vault secret reference holding the API key (e.g. `"OPENAI_API_KEY"`).
    pub secret_ref: String,
    /// Maximum accepted audio duration in seconds.
    #[serde(default = "default_stt_max_seconds")]
    pub max_seconds: u32,
    /// Maximum accepted audio byte size.
    #[serde(default = "default_stt_max_bytes")]
    pub max_bytes: usize,
}

fn default_stt_max_seconds() -> u32 {
    600
}

fn default_stt_max_bytes() -> usize {
    25 * 1024 * 1024
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
            stt: None,
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
            stt: None,
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
            stt: None,
        };
        settings.save(&path).unwrap();
        let loaded = SystemSettings::load(&path);
        assert!(loaded.browser_rendering);
    }

    #[test]
    fn round_trip_stt_settings() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.yaml");
        let settings = SystemSettings {
            network_mode: NetworkMode::Safe,
            browser_rendering: false,
            stt: Some(SttSettings {
                provider: "whisper".into(),
                model: "whisper-1".into(),
                api_base: None,
                secret_ref: "OPENAI_API_KEY".into(),
                max_seconds: 600,
                max_bytes: 25 * 1024 * 1024,
            }),
        };
        settings.save(&path).unwrap();
        let loaded = SystemSettings::load(&path);
        let stt = loaded.stt.expect("stt should round-trip");
        assert_eq!(stt.provider, "whisper");
        assert_eq!(stt.model, "whisper-1");
        assert_eq!(stt.secret_ref, "OPENAI_API_KEY");
        assert_eq!(stt.max_seconds, 600);
    }

    #[test]
    fn stt_defaults_when_missing_optional_fields() {
        let yaml = "stt:\n  provider: whisper\n  model: whisper-1\n  secret_ref: OPENAI_API_KEY\n";
        let settings: SystemSettings = serde_yaml::from_str(yaml).unwrap();
        let stt = settings.stt.expect("stt");
        assert_eq!(stt.max_seconds, 600);
        assert_eq!(stt.max_bytes, 25 * 1024 * 1024);
        assert!(stt.api_base.is_none());
    }

    #[test]
    fn browser_rendering_defaults_when_missing() {
        let yaml = "network_mode: safe\n";
        let settings: SystemSettings = serde_yaml::from_str(yaml).unwrap();
        assert!(!settings.browser_rendering);
    }
}
