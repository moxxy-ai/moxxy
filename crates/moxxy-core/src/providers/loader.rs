use super::doc::ProviderDoc;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct LoadedProvider {
    pub doc: ProviderDoc,
    pub path: PathBuf,
}

pub struct ProviderLoader;

impl ProviderLoader {
    /// Load a single provider by id from `{moxxy_home}/providers/{id}/provider.yaml`.
    pub fn load(moxxy_home: &Path, id: &str) -> Option<LoadedProvider> {
        let yaml_path = moxxy_home.join("providers").join(id).join("provider.yaml");
        match ProviderDoc::load_from_file(&yaml_path) {
            Ok(doc) => Some(LoadedProvider {
                doc,
                path: yaml_path,
            }),
            Err(e) => {
                tracing::warn!(
                    provider_id = %id,
                    path = %yaml_path.display(),
                    error = %e,
                    "Failed to load provider"
                );
                None
            }
        }
    }

    /// Load all providers from `{moxxy_home}/providers/*/provider.yaml`.
    pub fn load_all(moxxy_home: &Path) -> Vec<LoadedProvider> {
        let providers_dir = moxxy_home.join("providers");
        let Ok(entries) = std::fs::read_dir(&providers_dir) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| {
                let id = e.file_name().into_string().ok()?;
                Self::load(moxxy_home, &id)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::doc::{ProviderDoc, ProviderModelEntry};

    fn write_provider_yaml(home: &Path, id: &str, display_name: &str) {
        let dir = home.join("providers").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        let doc = ProviderDoc {
            id: id.into(),
            display_name: display_name.into(),
            enabled: true,
            secret_ref: None,
            api_base: None,
            models: vec![ProviderModelEntry {
                id: "gpt-4o".into(),
                display_name: "GPT-4o".into(),
                api_base: Some("https://api.openai.com/v1".into()),
                chatgpt_account_id: None,
            }],
        };
        doc.save_to_file(&dir.join("provider.yaml")).unwrap();
    }

    #[test]
    fn load_single_provider() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        write_provider_yaml(home, "openai", "OpenAI");

        let loaded = ProviderLoader::load(home, "openai").unwrap();
        assert_eq!(loaded.doc.id, "openai");
        assert_eq!(loaded.doc.display_name, "OpenAI");
        assert_eq!(loaded.doc.models.len(), 1);
    }

    #[test]
    fn load_missing_provider() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(ProviderLoader::load(tmp.path(), "nonexistent").is_none());
    }

    #[test]
    fn load_all_scans_providers() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        write_provider_yaml(home, "openai", "OpenAI");
        write_provider_yaml(home, "anthropic", "Anthropic");

        let loaded = ProviderLoader::load_all(home);
        assert_eq!(loaded.len(), 2);
    }

    #[test]
    fn load_all_no_providers_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let loaded = ProviderLoader::load_all(tmp.path());
        assert!(loaded.is_empty());
    }

    #[test]
    fn load_all_skips_invalid() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        write_provider_yaml(home, "good", "Good Provider");

        // Write invalid YAML
        let bad_dir = home.join("providers").join("bad");
        std::fs::create_dir_all(&bad_dir).unwrap();
        std::fs::write(bad_dir.join("provider.yaml"), "not valid yaml: [").unwrap();

        let loaded = ProviderLoader::load_all(home);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].doc.id, "good");
    }
}
