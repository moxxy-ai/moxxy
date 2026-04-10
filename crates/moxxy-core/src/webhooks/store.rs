use super::doc::WebhookDoc;
use super::loader::LoadedWebhook;
use moxxy_types::WebhookDocError;
use std::path::Path;

/// Input for creating a webhook. The caller resolves/stores the HMAC secret
/// (if any) before calling and passes its vault ref name via `secret_ref`.
/// A pre-generated `token` may be supplied when the caller needs to know the
/// token in advance (e.g. to derive vault backend keys); otherwise a fresh
/// UUIDv7 is generated.
#[derive(Debug, Clone, Default)]
pub struct WebhookCreateInput {
    pub label: String,
    pub token: Option<String>,
    pub event_filter: Option<String>,
    pub body: String,
    pub secret_ref: Option<String>,
}

/// Result of a webhook creation: the persisted doc and its loaded form ready
/// for the gateway in-memory index.
#[derive(Debug, Clone)]
pub struct WebhookCreateOutput {
    pub doc: WebhookDoc,
    pub loaded: LoadedWebhook,
}

pub struct WebhookStore;

impl WebhookStore {
    /// Write a webhook doc to `{moxxy_home}/agents/{agent_name}/webhooks/{slug}/WEBHOOK.md`.
    /// Creates the `webhooks/{slug}/` subdir if missing.
    pub fn create(
        moxxy_home: &Path,
        agent_name: &str,
        doc: &WebhookDoc,
    ) -> Result<(), WebhookDocError> {
        let slug = doc.slug();
        let slug_dir = moxxy_home
            .join("agents")
            .join(agent_name)
            .join("webhooks")
            .join(&slug);
        std::fs::create_dir_all(&slug_dir)
            .map_err(|e| WebhookDocError::IoError(format!("create webhook dir: {e}")))?;
        let path = slug_dir.join("WEBHOOK.md");
        doc.save_to_file(&path)
    }

    /// Generate a fresh token, build the `WebhookDoc`, persist it, and return
    /// a `LoadedWebhook` ready for the in-memory index. Returns a conflict
    /// error if a webhook with the same derived slug already exists.
    pub fn create_from_input(
        moxxy_home: &Path,
        agent_name: &str,
        input: WebhookCreateInput,
    ) -> Result<WebhookCreateOutput, WebhookDocError> {
        let token = input
            .token
            .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
        let doc = WebhookDoc {
            label: input.label,
            token,
            event_filter: input.event_filter,
            enabled: true,
            secret_ref: input.secret_ref,
            body: input.body,
        };

        let slug = doc.slug();
        if slug.is_empty() {
            return Err(WebhookDocError::MissingField("label".to_string()));
        }
        let slug_dir = moxxy_home
            .join("agents")
            .join(agent_name)
            .join("webhooks")
            .join(&slug);
        if slug_dir.exists() {
            return Err(WebhookDocError::IoError(format!(
                "webhook already exists: {slug}"
            )));
        }

        Self::create(moxxy_home, agent_name, &doc)?;

        let loaded = LoadedWebhook {
            doc: doc.clone(),
            agent_name: agent_name.to_string(),
            path: slug_dir.join("WEBHOOK.md"),
        };

        Ok(WebhookCreateOutput { doc, loaded })
    }

    /// Delete a webhook directory by slug.
    pub fn delete(moxxy_home: &Path, agent_name: &str, slug: &str) -> Result<(), WebhookDocError> {
        let slug_dir = moxxy_home
            .join("agents")
            .join(agent_name)
            .join("webhooks")
            .join(slug);
        if !slug_dir.exists() {
            return Err(WebhookDocError::IoError(format!(
                "webhook not found: {}",
                slug_dir.display()
            )));
        }
        std::fs::remove_dir_all(&slug_dir)
            .map_err(|e| WebhookDocError::IoError(format!("{}: {e}", slug_dir.display())))
    }

    /// List webhook slugs for an agent (subdirectory names containing WEBHOOK.md).
    pub fn list(moxxy_home: &Path, agent_name: &str) -> Vec<String> {
        let webhooks_dir = moxxy_home.join("agents").join(agent_name).join("webhooks");
        let Ok(entries) = std::fs::read_dir(&webhooks_dir) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                if path.is_dir() && path.join("WEBHOOK.md").exists() {
                    e.file_name().into_string().ok()
                } else {
                    None
                }
            })
            .collect()
    }

    /// Load a single webhook doc by slug.
    pub fn load(
        moxxy_home: &Path,
        agent_name: &str,
        slug: &str,
    ) -> Result<WebhookDoc, WebhookDocError> {
        let path = moxxy_home
            .join("agents")
            .join(agent_name)
            .join("webhooks")
            .join(slug)
            .join("WEBHOOK.md");
        WebhookDoc::load_from_file(&path)
    }

    /// Load, apply a mutation, and save back. Returns the updated doc.
    pub fn update(
        moxxy_home: &Path,
        agent_name: &str,
        slug: &str,
        mutate: impl FnOnce(&mut WebhookDoc),
    ) -> Result<WebhookDoc, WebhookDocError> {
        let slug_dir = moxxy_home
            .join("agents")
            .join(agent_name)
            .join("webhooks")
            .join(slug);
        let path = slug_dir.join("WEBHOOK.md");
        let mut doc = WebhookDoc::load_from_file(&path)?;
        mutate(&mut doc);

        // If the label changed, the slug changes → rename the directory
        let new_slug = doc.slug();
        if new_slug != slug {
            let new_dir = slug_dir.with_file_name(&new_slug);
            std::fs::rename(&slug_dir, &new_dir)
                .map_err(|e| WebhookDocError::IoError(format!("rename dir: {e}")))?;
            let new_path = new_dir.join("WEBHOOK.md");
            doc.save_to_file(&new_path)?;
        } else {
            doc.save_to_file(&path)?;
        }
        Ok(doc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_doc(label: &str, token: &str) -> WebhookDoc {
        WebhookDoc {
            label: label.into(),
            token: token.into(),
            event_filter: None,
            enabled: true,
            secret_ref: None,
            body: String::new(),
        }
    }

    #[test]
    fn create_and_load() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents/test-agent")).unwrap();

        let doc = sample_doc("My Hook", "tok-123");
        WebhookStore::create(home, "test-agent", &doc).unwrap();

        let loaded = WebhookStore::load(home, "test-agent", "my-hook").unwrap();
        assert_eq!(loaded.label, "My Hook");
        assert_eq!(loaded.token, "tok-123");
    }

    #[test]
    fn create_creates_webhooks_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents/new-agent")).unwrap();

        let doc = sample_doc("Auto Dir", "tok");
        WebhookStore::create(home, "new-agent", &doc).unwrap();
        assert!(
            home.join("agents/new-agent/webhooks/auto-dir/WEBHOOK.md")
                .exists()
        );
    }

    #[test]
    fn delete_removes_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents/del-agent")).unwrap();

        let doc = sample_doc("To Delete", "tok-del");
        WebhookStore::create(home, "del-agent", &doc).unwrap();
        WebhookStore::delete(home, "del-agent", "to-delete").unwrap();

        assert!(WebhookStore::load(home, "del-agent", "to-delete").is_err());
    }

    #[test]
    fn delete_nonexistent_fails() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(WebhookStore::delete(tmp.path(), "x", "nope").is_err());
    }

    #[test]
    fn list_slugs() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents/list-agent")).unwrap();

        WebhookStore::create(home, "list-agent", &sample_doc("Alpha", "t1")).unwrap();
        WebhookStore::create(home, "list-agent", &sample_doc("Beta", "t2")).unwrap();

        let mut slugs = WebhookStore::list(home, "list-agent");
        slugs.sort();
        assert_eq!(slugs, vec!["alpha", "beta"]);
    }

    #[test]
    fn list_empty() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(WebhookStore::list(tmp.path(), "nobody").is_empty());
    }

    #[test]
    fn update_modifies_doc() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents/upd-agent")).unwrap();

        WebhookStore::create(home, "upd-agent", &sample_doc("Original", "tok-1")).unwrap();
        let updated = WebhookStore::update(home, "upd-agent", "original", |d| {
            d.event_filter = Some("push".into());
            d.enabled = false;
        })
        .unwrap();
        assert_eq!(updated.event_filter.as_deref(), Some("push"));
        assert!(!updated.enabled);
        assert_eq!(updated.token, "tok-1"); // token unchanged
    }

    #[test]
    fn update_renames_dir_on_label_change() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents/rename-agent")).unwrap();

        WebhookStore::create(home, "rename-agent", &sample_doc("Old Name", "tok-r")).unwrap();
        WebhookStore::update(home, "rename-agent", "old-name", |d| {
            d.label = "New Name".into();
        })
        .unwrap();

        // Old slug gone, new slug present
        assert!(WebhookStore::load(home, "rename-agent", "old-name").is_err());
        let loaded = WebhookStore::load(home, "rename-agent", "new-name").unwrap();
        assert_eq!(loaded.label, "New Name");
        assert_eq!(loaded.token, "tok-r");
    }

    #[test]
    fn update_nonexistent_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let result = WebhookStore::update(tmp.path(), "x", "nope", |_| {});
        assert!(result.is_err());
    }

    #[test]
    fn create_from_input_generates_token_and_doc() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents/api-agent")).unwrap();

        let output = WebhookStore::create_from_input(
            home,
            "api-agent",
            WebhookCreateInput {
                label: "Programmatic Hook".into(),
                token: None,
                event_filter: Some("push".into()),
                body: "Handle {{body.msg}}".into(),
                secret_ref: Some("webhook_secret_programmatic-hook".into()),
            },
        )
        .unwrap();

        assert_eq!(output.doc.label, "Programmatic Hook");
        assert!(!output.doc.token.is_empty());
        assert_eq!(output.doc.event_filter.as_deref(), Some("push"));
        assert_eq!(
            output.doc.secret_ref.as_deref(),
            Some("webhook_secret_programmatic-hook")
        );
        assert_eq!(output.loaded.agent_name, "api-agent");
        assert!(output.loaded.path.ends_with("programmatic-hook/WEBHOOK.md"));

        // Round-trip through the filesystem.
        let reloaded = WebhookStore::load(home, "api-agent", "programmatic-hook").unwrap();
        assert_eq!(reloaded.token, output.doc.token);
        assert_eq!(reloaded.body, "Handle {{body.msg}}");
    }

    #[test]
    fn create_from_input_honors_supplied_token() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents/tok-agent")).unwrap();

        let output = WebhookStore::create_from_input(
            home,
            "tok-agent",
            WebhookCreateInput {
                label: "Fixed Token".into(),
                token: Some("fixed-token-value".into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(output.doc.token, "fixed-token-value");
    }

    #[test]
    fn create_from_input_rejects_duplicate_slug() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        std::fs::create_dir_all(home.join("agents/dup-agent")).unwrap();

        WebhookStore::create_from_input(
            home,
            "dup-agent",
            WebhookCreateInput {
                label: "Same Name".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let err = WebhookStore::create_from_input(
            home,
            "dup-agent",
            WebhookCreateInput {
                label: "Same Name".into(),
                ..Default::default()
            },
        )
        .unwrap_err();

        assert!(matches!(err, WebhookDocError::IoError(msg) if msg.contains("already exists")));
    }
}
