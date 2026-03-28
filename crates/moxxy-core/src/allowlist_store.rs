use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListEntries {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deny: Vec<String>,
}

/// YAML-backed allowlist/denylist storage.
///
/// File format (`allowlists.yaml`):
/// ```yaml
/// http_domain:
///   allow:
///     - custom-api.com
///   deny:
///     - github.com
/// shell_command:
///   allow:
///     - my-tool
///   deny:
///     - curl
/// ```
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AllowlistFile(BTreeMap<String, ListEntries>);

impl AllowlistFile {
    /// Load from disk. Returns empty if file doesn't exist or is invalid.
    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(content) if !content.trim().is_empty() => {
                serde_yaml::from_str(&content).unwrap_or_default()
            }
            _ => Self::default(),
        }
    }

    /// Save to disk. Creates parent directories if needed.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create dir {}: {e}", parent.display()))?;
        }
        let content =
            serde_yaml::to_string(&self.0).map_err(|e| format!("serialize allowlists: {e}"))?;
        std::fs::write(path, content).map_err(|e| format!("write {}: {e}", path.display()))
    }

    pub fn allows(&self, list_type: &str) -> Vec<String> {
        self.0
            .get(list_type)
            .map(|e| e.allow.clone())
            .unwrap_or_default()
    }

    pub fn denials(&self, list_type: &str) -> Vec<String> {
        self.0
            .get(list_type)
            .map(|e| e.deny.clone())
            .unwrap_or_default()
    }

    pub fn add_allow(&mut self, list_type: &str, entry: String) {
        let entries = self.0.entry(list_type.to_string()).or_default();
        if !entries.allow.contains(&entry) {
            entries.allow.push(entry);
        }
    }

    pub fn remove_allow(&mut self, list_type: &str, entry: &str) {
        if let Some(entries) = self.0.get_mut(list_type) {
            entries.allow.retain(|e| e != entry);
        }
    }

    pub fn add_deny(&mut self, list_type: &str, entry: String) {
        let entries = self.0.entry(list_type.to_string()).or_default();
        if !entries.deny.contains(&entry) {
            entries.deny.push(entry);
        }
    }

    pub fn remove_deny(&mut self, list_type: &str, entry: &str) {
        if let Some(entries) = self.0.get_mut(list_type) {
            entries.deny.retain(|e| e != entry);
        }
    }

    pub fn list_types(&self) -> Vec<String> {
        self.0.keys().cloned().collect()
    }
}

/// Canonical path for an agent's allowlist file.
pub fn allowlist_path(agent_dir: &Path) -> std::path::PathBuf {
    agent_dir.join("allowlists.yaml")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn round_trip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("allowlists.yaml");

        let mut file = AllowlistFile::default();
        file.add_allow("http_domain", "example.com".into());
        file.add_allow("shell_command", "ls".into());
        file.add_deny("shell_command", "curl".into());
        file.save(&path).unwrap();

        let loaded = AllowlistFile::load(&path);
        assert_eq!(loaded.allows("http_domain"), vec!["example.com"]);
        assert_eq!(loaded.allows("shell_command"), vec!["ls"]);
        assert_eq!(loaded.denials("shell_command"), vec!["curl"]);
    }

    #[test]
    fn load_missing_file_returns_default() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nonexistent.yaml");
        let file = AllowlistFile::load(&path);
        assert!(file.allows("http_domain").is_empty());
    }

    #[test]
    fn add_is_idempotent() {
        let mut file = AllowlistFile::default();
        file.add_allow("http_domain", "example.com".into());
        file.add_allow("http_domain", "example.com".into());
        assert_eq!(file.allows("http_domain").len(), 1);
    }

    #[test]
    fn deny_is_idempotent() {
        let mut file = AllowlistFile::default();
        file.add_deny("shell_command", "curl".into());
        file.add_deny("shell_command", "curl".into());
        assert_eq!(file.denials("shell_command").len(), 1);
    }

    #[test]
    fn remove_allow_works() {
        let mut file = AllowlistFile::default();
        file.add_allow("http_domain", "example.com".into());
        file.add_allow("http_domain", "other.com".into());
        file.remove_allow("http_domain", "example.com");
        assert_eq!(file.allows("http_domain"), vec!["other.com"]);
    }

    #[test]
    fn remove_deny_works() {
        let mut file = AllowlistFile::default();
        file.add_deny("shell_command", "curl".into());
        file.add_deny("shell_command", "wget".into());
        file.remove_deny("shell_command", "curl");
        assert_eq!(file.denials("shell_command"), vec!["wget"]);
    }

    #[test]
    fn remove_from_nonexistent_type_is_noop() {
        let mut file = AllowlistFile::default();
        file.remove_allow("http_domain", "example.com");
        file.remove_deny("http_domain", "example.com");
        assert!(file.allows("http_domain").is_empty());
    }

    #[test]
    fn list_types() {
        let mut file = AllowlistFile::default();
        file.add_allow("http_domain", "example.com".into());
        file.add_deny("shell_command", "curl".into());
        let mut types = file.list_types();
        types.sort();
        assert_eq!(types, vec!["http_domain", "shell_command"]);
    }

    #[test]
    fn load_empty_file_returns_default() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("allowlists.yaml");
        std::fs::write(&path, "").unwrap();
        let file = AllowlistFile::load(&path);
        assert!(file.allows("http_domain").is_empty());
    }

    #[test]
    fn load_invalid_yaml_returns_default() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("allowlists.yaml");
        std::fs::write(&path, "not: [valid: yaml: {{").unwrap();
        let file = AllowlistFile::load(&path);
        assert!(file.allows("http_domain").is_empty());
    }
}
