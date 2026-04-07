use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// On-disk representation of a channel registration.
/// Stored at `~/.moxxy/channels/{id}/channel.yaml`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelDoc {
    pub channel_type: String,
    pub display_name: String,
    pub vault_secret_ref_id: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_json::Value>,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_status() -> String {
    "active".into()
}

/// A single binding entry mapping an external chat to an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BindingEntry {
    pub agent_name: String,
    pub status: String,
    pub created_at: String,
}

/// Per-channel bindings file stored at `~/.moxxy/channels/{id}/bindings.yaml`.
/// Keys are `external_chat_id` strings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BindingsFile(pub BTreeMap<String, BindingEntry>);

impl BindingsFile {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_yaml::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
        }
        let yaml = serde_yaml::to_string(&self).map_err(|e| format!("serialize: {e}"))?;
        std::fs::write(path, yaml).map_err(|e| format!("write: {e}"))
    }

    /// Find the first active binding in this file.
    pub fn active_binding(&self) -> Option<(&str, &BindingEntry)> {
        self.0
            .iter()
            .find(|(_, entry)| entry.status == "active")
            .map(|(k, v)| (k.as_str(), v))
    }

    /// Find all active bindings for a given agent.
    pub fn bindings_for_agent(&self, agent_name: &str) -> Vec<(&str, &BindingEntry)> {
        self.0
            .iter()
            .filter(|(_, entry)| entry.agent_name == agent_name && entry.status == "active")
            .map(|(k, v)| (k.as_str(), v))
            .collect()
    }
}

/// Filesystem-backed channel store.
pub struct ChannelStore;

impl ChannelStore {
    /// Root directory for all channels.
    pub fn channels_dir(moxxy_home: &Path) -> PathBuf {
        moxxy_home.join("channels")
    }

    fn channel_dir(moxxy_home: &Path, id: &str) -> PathBuf {
        Self::channels_dir(moxxy_home).join(id)
    }

    fn channel_path(moxxy_home: &Path, id: &str) -> PathBuf {
        Self::channel_dir(moxxy_home, id).join("channel.yaml")
    }

    fn bindings_path(moxxy_home: &Path, id: &str) -> PathBuf {
        Self::channel_dir(moxxy_home, id).join("bindings.yaml")
    }

    /// Create a new channel on disk.
    pub fn create(moxxy_home: &Path, id: &str, doc: &ChannelDoc) -> Result<(), String> {
        let dir = Self::channel_dir(moxxy_home, id);
        std::fs::create_dir_all(&dir).map_err(|e| format!("create channel dir: {e}"))?;
        let yaml = serde_yaml::to_string(doc).map_err(|e| format!("serialize: {e}"))?;
        std::fs::write(Self::channel_path(moxxy_home, id), yaml).map_err(|e| format!("write: {e}"))
    }

    /// Load a single channel by ID.
    pub fn load(moxxy_home: &Path, id: &str) -> Result<ChannelDoc, String> {
        let path = Self::channel_path(moxxy_home, id);
        let content =
            std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        serde_yaml::from_str(&content).map_err(|e| format!("parse: {e}"))
    }

    /// List all channels (id, doc) pairs.
    pub fn list(moxxy_home: &Path) -> Vec<(String, ChannelDoc)> {
        let dir = Self::channels_dir(moxxy_home);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return vec![];
        };
        let mut result = Vec::new();
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            if let Ok(doc) = Self::load(moxxy_home, &id) {
                result.push((id, doc));
            }
        }
        result
    }

    /// List only active channels.
    pub fn list_active(moxxy_home: &Path) -> Vec<(String, ChannelDoc)> {
        Self::list(moxxy_home)
            .into_iter()
            .filter(|(_, doc)| doc.status == "active")
            .collect()
    }

    /// Update channel status.
    pub fn update_status(moxxy_home: &Path, id: &str, status: &str) -> Result<(), String> {
        let mut doc = Self::load(moxxy_home, id)?;
        doc.status = status.to_string();
        doc.updated_at = chrono::Utc::now().to_rfc3339();
        let yaml = serde_yaml::to_string(&doc).map_err(|e| format!("serialize: {e}"))?;
        std::fs::write(Self::channel_path(moxxy_home, id), yaml).map_err(|e| format!("write: {e}"))
    }

    /// Delete a channel directory entirely.
    pub fn delete(moxxy_home: &Path, id: &str) -> Result<(), String> {
        let dir = Self::channel_dir(moxxy_home, id);
        if !dir.exists() {
            return Err("channel not found".into());
        }
        std::fs::remove_dir_all(&dir).map_err(|e| format!("delete: {e}"))
    }

    /// Load bindings for a channel.
    pub fn load_bindings(moxxy_home: &Path, channel_id: &str) -> BindingsFile {
        BindingsFile::load(&Self::bindings_path(moxxy_home, channel_id))
    }

    /// Save bindings for a channel.
    pub fn save_bindings(
        moxxy_home: &Path,
        channel_id: &str,
        bindings: &BindingsFile,
    ) -> Result<(), String> {
        bindings.save(&Self::bindings_path(moxxy_home, channel_id))
    }

    /// Find all active bindings for an agent across all channels.
    /// Returns `(channel_id, external_chat_id, BindingEntry)` triples.
    pub fn find_bindings_by_agent(
        moxxy_home: &Path,
        agent_name: &str,
    ) -> Vec<(String, String, BindingEntry)> {
        let dir = Self::channels_dir(moxxy_home);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return vec![];
        };
        let mut result = Vec::new();
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let channel_id = entry.file_name().to_string_lossy().to_string();
            let bindings = Self::load_bindings(moxxy_home, &channel_id);
            for (chat_id, binding) in &bindings.0 {
                if binding.agent_name == agent_name && binding.status == "active" {
                    result.push((channel_id.clone(), chat_id.clone(), binding.clone()));
                }
            }
        }
        result
    }

    /// Find active bindings for a specific channel.
    /// Returns `(external_chat_id, BindingEntry)` pairs.
    pub fn find_bindings_by_channel(
        moxxy_home: &Path,
        channel_id: &str,
    ) -> Vec<(String, BindingEntry)> {
        let bindings = Self::load_bindings(moxxy_home, channel_id);
        bindings
            .0
            .into_iter()
            .filter(|(_, entry)| entry.status == "active")
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_and_load_channel() {
        let tmp = tempfile::tempdir().unwrap();
        let doc = ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Test Bot".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01T00:00:00Z".into(),
            updated_at: "2025-01-01T00:00:00Z".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();
        let loaded = ChannelStore::load(tmp.path(), "ch1").unwrap();
        assert_eq!(loaded.channel_type, "telegram");
        assert_eq!(loaded.display_name, "Test Bot");
        assert_eq!(loaded.status, "active");
    }

    #[test]
    fn list_channels() {
        let tmp = tempfile::tempdir().unwrap();
        let doc = ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Bot A".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();
        ChannelStore::create(tmp.path(), "ch2", &doc).unwrap();
        assert_eq!(ChannelStore::list(tmp.path()).len(), 2);
    }

    #[test]
    fn list_active_filters() {
        let tmp = tempfile::tempdir().unwrap();
        let active = ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Active".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        let paused = ChannelDoc {
            status: "paused".into(),
            ..active.clone()
        };
        ChannelStore::create(tmp.path(), "ch1", &active).unwrap();
        ChannelStore::create(tmp.path(), "ch2", &paused).unwrap();
        assert_eq!(ChannelStore::list_active(tmp.path()).len(), 1);
    }

    #[test]
    fn update_status() {
        let tmp = tempfile::tempdir().unwrap();
        let doc = ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Bot".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();
        ChannelStore::update_status(tmp.path(), "ch1", "paused").unwrap();
        let loaded = ChannelStore::load(tmp.path(), "ch1").unwrap();
        assert_eq!(loaded.status, "paused");
    }

    #[test]
    fn delete_channel() {
        let tmp = tempfile::tempdir().unwrap();
        let doc = ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Bot".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();
        ChannelStore::delete(tmp.path(), "ch1").unwrap();
        assert!(ChannelStore::load(tmp.path(), "ch1").is_err());
    }

    #[test]
    fn delete_nonexistent_returns_error() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(ChannelStore::delete(tmp.path(), "nope").is_err());
    }

    #[test]
    fn bindings_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        // Create channel dir first
        let doc = ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Bot".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();

        let mut bindings = BindingsFile::default();
        bindings.0.insert(
            "12345".into(),
            BindingEntry {
                agent_name: "my-agent".into(),
                status: "active".into(),
                created_at: "2025-01-01".into(),
            },
        );
        ChannelStore::save_bindings(tmp.path(), "ch1", &bindings).unwrap();
        let loaded = ChannelStore::load_bindings(tmp.path(), "ch1");
        assert_eq!(loaded.0.len(), 1);
        assert_eq!(loaded.0["12345"].agent_name, "my-agent");
    }

    #[test]
    fn find_bindings_by_agent() {
        let tmp = tempfile::tempdir().unwrap();
        let doc = ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Bot".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();
        ChannelStore::create(tmp.path(), "ch2", &doc).unwrap();

        let mut b1 = BindingsFile::default();
        b1.0.insert(
            "111".into(),
            BindingEntry {
                agent_name: "agent-a".into(),
                status: "active".into(),
                created_at: "2025-01-01".into(),
            },
        );
        ChannelStore::save_bindings(tmp.path(), "ch1", &b1).unwrap();

        let mut b2 = BindingsFile::default();
        b2.0.insert(
            "222".into(),
            BindingEntry {
                agent_name: "agent-b".into(),
                status: "active".into(),
                created_at: "2025-01-01".into(),
            },
        );
        ChannelStore::save_bindings(tmp.path(), "ch2", &b2).unwrap();

        let found = ChannelStore::find_bindings_by_agent(tmp.path(), "agent-a");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0, "ch1");
        assert_eq!(found[0].1, "111");

        let found_b = ChannelStore::find_bindings_by_agent(tmp.path(), "agent-b");
        assert_eq!(found_b.len(), 1);
    }

    #[test]
    fn find_bindings_by_channel() {
        let tmp = tempfile::tempdir().unwrap();
        let doc = ChannelDoc {
            channel_type: "telegram".into(),
            display_name: "Bot".into(),
            vault_secret_ref_id: "ref-1".into(),
            status: "active".into(),
            config: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
        };
        ChannelStore::create(tmp.path(), "ch1", &doc).unwrap();

        let mut bindings = BindingsFile::default();
        bindings.0.insert(
            "111".into(),
            BindingEntry {
                agent_name: "agent-a".into(),
                status: "active".into(),
                created_at: "2025-01-01".into(),
            },
        );
        bindings.0.insert(
            "222".into(),
            BindingEntry {
                agent_name: "agent-b".into(),
                status: "inactive".into(),
                created_at: "2025-01-01".into(),
            },
        );
        ChannelStore::save_bindings(tmp.path(), "ch1", &bindings).unwrap();

        let found = ChannelStore::find_bindings_by_channel(tmp.path(), "ch1");
        assert_eq!(found.len(), 1); // only active
        assert_eq!(found[0].0, "111");
    }

    #[test]
    fn active_binding_returns_first_active() {
        let mut bindings = BindingsFile::default();
        bindings.0.insert(
            "111".into(),
            BindingEntry {
                agent_name: "agent-a".into(),
                status: "inactive".into(),
                created_at: "2025-01-01".into(),
            },
        );
        bindings.0.insert(
            "222".into(),
            BindingEntry {
                agent_name: "agent-b".into(),
                status: "active".into(),
                created_at: "2025-01-01".into(),
            },
        );
        let (chat_id, entry) = bindings.active_binding().unwrap();
        assert_eq!(chat_id, "222");
        assert_eq!(entry.agent_name, "agent-b");
    }

    #[test]
    fn load_bindings_empty_file() {
        let tmp = tempfile::tempdir().unwrap();
        let bindings = ChannelStore::load_bindings(tmp.path(), "nonexistent");
        assert!(bindings.0.is_empty());
    }
}
