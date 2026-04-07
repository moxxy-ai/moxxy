use super::doc::ProviderDoc;
use moxxy_types::ProviderDocError;
use std::path::Path;

pub struct ProviderStore;

impl ProviderStore {
    /// Write a provider doc to `{moxxy_home}/providers/{id}/provider.yaml`.
    pub fn create(moxxy_home: &Path, doc: &ProviderDoc) -> Result<(), ProviderDocError> {
        let provider_dir = moxxy_home.join("providers").join(&doc.id);
        std::fs::create_dir_all(&provider_dir)
            .map_err(|e| ProviderDocError::IoError(format!("create provider dir: {e}")))?;
        let path = provider_dir.join("provider.yaml");
        doc.save_to_file(&path)
    }

    /// Delete a provider directory by id.
    pub fn delete(moxxy_home: &Path, id: &str) -> Result<(), ProviderDocError> {
        let provider_dir = moxxy_home.join("providers").join(id);
        if !provider_dir.exists() {
            return Err(ProviderDocError::IoError(format!(
                "provider not found: {}",
                provider_dir.display()
            )));
        }
        std::fs::remove_dir_all(&provider_dir)
            .map_err(|e| ProviderDocError::IoError(format!("{}: {e}", provider_dir.display())))
    }

    /// List provider ids (subdirectory names containing provider.yaml).
    pub fn list(moxxy_home: &Path) -> Vec<String> {
        let providers_dir = moxxy_home.join("providers");
        let Ok(entries) = std::fs::read_dir(&providers_dir) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                if path.is_dir() && path.join("provider.yaml").exists() {
                    e.file_name().into_string().ok()
                } else {
                    None
                }
            })
            .collect()
    }

    /// Load a single provider doc by id.
    pub fn load(moxxy_home: &Path, id: &str) -> Result<ProviderDoc, ProviderDocError> {
        let path = moxxy_home.join("providers").join(id).join("provider.yaml");
        ProviderDoc::load_from_file(&path)
    }

    /// Load, apply a mutation, and save back. Returns the updated doc.
    pub fn update(
        moxxy_home: &Path,
        id: &str,
        mutate: impl FnOnce(&mut ProviderDoc),
    ) -> Result<ProviderDoc, ProviderDocError> {
        let path = moxxy_home.join("providers").join(id).join("provider.yaml");
        let mut doc = ProviderDoc::load_from_file(&path)?;
        mutate(&mut doc);
        doc.save_to_file(&path)?;
        Ok(doc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::doc::ProviderModelEntry;

    fn sample_doc(id: &str, display_name: &str) -> ProviderDoc {
        ProviderDoc {
            id: id.into(),
            display_name: display_name.into(),
            enabled: true,
            secret_ref: None,
            api_base: None,
            models: vec![],
        }
    }

    #[test]
    fn create_and_load() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();

        let doc = sample_doc("openai", "OpenAI");
        ProviderStore::create(home, &doc).unwrap();

        let loaded = ProviderStore::load(home, "openai").unwrap();
        assert_eq!(loaded.id, "openai");
        assert_eq!(loaded.display_name, "OpenAI");
    }

    #[test]
    fn create_creates_providers_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();

        let doc = sample_doc("test-provider", "Test");
        ProviderStore::create(home, &doc).unwrap();
        assert!(home.join("providers/test-provider/provider.yaml").exists());
    }

    #[test]
    fn delete_removes_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();

        let doc = sample_doc("to-delete", "To Delete");
        ProviderStore::create(home, &doc).unwrap();
        ProviderStore::delete(home, "to-delete").unwrap();

        assert!(ProviderStore::load(home, "to-delete").is_err());
    }

    #[test]
    fn delete_nonexistent_fails() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(ProviderStore::delete(tmp.path(), "nope").is_err());
    }

    #[test]
    fn list_ids() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();

        ProviderStore::create(home, &sample_doc("alpha", "Alpha")).unwrap();
        ProviderStore::create(home, &sample_doc("beta", "Beta")).unwrap();

        let mut ids = ProviderStore::list(home);
        ids.sort();
        assert_eq!(ids, vec!["alpha", "beta"]);
    }

    #[test]
    fn list_empty() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(ProviderStore::list(tmp.path()).is_empty());
    }

    #[test]
    fn update_modifies_doc() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();

        ProviderStore::create(home, &sample_doc("upd", "Original")).unwrap();
        let updated = ProviderStore::update(home, "upd", |d| {
            d.enabled = false;
            d.models.push(ProviderModelEntry {
                id: "gpt-4".into(),
                display_name: "GPT-4".into(),
                api_base: Some("https://api.openai.com/v1".into()),
                chatgpt_account_id: None,
            });
        })
        .unwrap();
        assert!(!updated.enabled);
        assert_eq!(updated.models.len(), 1);
        assert_eq!(updated.display_name, "Original"); // unchanged
    }

    #[test]
    fn update_nonexistent_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let result = ProviderStore::update(tmp.path(), "nope", |_| {});
        assert!(result.is_err());
    }

    #[test]
    fn create_upserts() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();

        ProviderStore::create(home, &sample_doc("openai", "OpenAI v1")).unwrap();
        ProviderStore::create(home, &sample_doc("openai", "OpenAI v2")).unwrap();

        let loaded = ProviderStore::load(home, "openai").unwrap();
        assert_eq!(loaded.display_name, "OpenAI v2");
    }
}
