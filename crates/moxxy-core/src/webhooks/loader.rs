use super::doc::WebhookDoc;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct LoadedWebhook {
    pub doc: WebhookDoc,
    pub agent_name: String,
    pub path: PathBuf,
}

pub struct WebhookLoader;

impl WebhookLoader {
    /// Load all webhook docs for a specific agent.
    pub fn load_agent(moxxy_home: &Path, agent_name: &str) -> Vec<LoadedWebhook> {
        let webhooks_dir = moxxy_home.join("agents").join(agent_name).join("webhooks");
        let Ok(entries) = std::fs::read_dir(&webhooks_dir) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| {
                let md_path = e.path().join("WEBHOOK.md");
                match WebhookDoc::load_from_file(&md_path) {
                    Ok(doc) => Some(LoadedWebhook {
                        doc,
                        agent_name: agent_name.to_string(),
                        path: md_path,
                    }),
                    Err(e) => {
                        tracing::warn!(
                            agent = %agent_name,
                            path = %md_path.display(),
                            error = %e,
                            "Skipping invalid webhook doc"
                        );
                        None
                    }
                }
            })
            .collect()
    }

    /// Load all webhook docs from all agents.
    pub fn load_all(moxxy_home: &Path) -> Vec<LoadedWebhook> {
        let agents_dir = moxxy_home.join("agents");
        let Ok(entries) = std::fs::read_dir(&agents_dir) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().into_string().ok())
            .flat_map(|agent_name| Self::load_agent(moxxy_home, &agent_name))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_webhook_md(dir: &Path, slug: &str, label: &str, token: &str) {
        let slug_dir = dir.join(slug);
        std::fs::create_dir_all(&slug_dir).unwrap();
        let content = format!("---\nlabel: {label}\ntoken: {token}\n---\n");
        std::fs::write(slug_dir.join("WEBHOOK.md"), content).unwrap();
    }

    #[test]
    fn load_agent_returns_webhooks() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let wh_dir = home.join("agents/my-agent/webhooks");
        std::fs::create_dir_all(&wh_dir).unwrap();

        write_webhook_md(&wh_dir, "github", "GitHub", "tok-1");
        write_webhook_md(&wh_dir, "stripe", "Stripe", "tok-2");

        let loaded = WebhookLoader::load_agent(home, "my-agent");
        assert_eq!(loaded.len(), 2);
        assert!(loaded.iter().all(|w| w.agent_name == "my-agent"));
    }

    #[test]
    fn load_agent_skips_invalid() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let wh_dir = home.join("agents/bad-agent/webhooks");
        std::fs::create_dir_all(&wh_dir).unwrap();

        // Bad: a directory with invalid WEBHOOK.md
        let bad_dir = wh_dir.join("bad");
        std::fs::create_dir_all(&bad_dir).unwrap();
        std::fs::write(bad_dir.join("WEBHOOK.md"), "not valid frontmatter\n").unwrap();

        write_webhook_md(&wh_dir, "good", "Good", "tok-g");

        let loaded = WebhookLoader::load_agent(home, "bad-agent");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].doc.label, "Good");
    }

    #[test]
    fn load_agent_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let loaded = WebhookLoader::load_agent(tmp.path(), "noone");
        assert!(loaded.is_empty());
    }

    #[test]
    fn load_all_scans_all_agents() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();

        let wh1 = home.join("agents/alpha/webhooks");
        std::fs::create_dir_all(&wh1).unwrap();
        write_webhook_md(&wh1, "hook", "Alpha Hook", "tok-a");

        let wh2 = home.join("agents/beta/webhooks");
        std::fs::create_dir_all(&wh2).unwrap();
        write_webhook_md(&wh2, "hook", "Beta Hook", "tok-b");

        let loaded = WebhookLoader::load_all(home);
        assert_eq!(loaded.len(), 2);
    }

    #[test]
    fn load_all_no_agents_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let loaded = WebhookLoader::load_all(tmp.path());
        assert!(loaded.is_empty());
    }
}
