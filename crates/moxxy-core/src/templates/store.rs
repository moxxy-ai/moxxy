use std::path::Path;

use super::builtins::BUILTIN_TEMPLATES;
use super::doc::TemplateDoc;
use moxxy_types::TemplateDocError;

pub struct TemplateStore;

impl TemplateStore {
    /// List template slugs from `{moxxy_home}/templates/*/TEMPLATE.md`.
    pub fn list(moxxy_home: &Path) -> Vec<String> {
        let templates_dir = moxxy_home.join("templates");
        let entries = match std::fs::read_dir(&templates_dir) {
            Ok(entries) => entries,
            Err(_) => return Vec::new(),
        };

        let mut slugs = Vec::new();
        for entry in entries.flatten() {
            if entry.path().join("TEMPLATE.md").is_file()
                && let Some(name) = entry.file_name().to_str()
            {
                slugs.push(name.to_string());
            }
        }
        slugs.sort();
        slugs
    }

    /// Create a template: parse content, validate, write to `templates/{slug}/TEMPLATE.md`.
    pub fn create(moxxy_home: &Path, content: &str) -> Result<TemplateDoc, TemplateDocError> {
        let doc = TemplateDoc::parse(content)?;
        let slug = doc.slug();
        let template_dir = moxxy_home.join("templates").join(&slug);
        std::fs::create_dir_all(&template_dir).map_err(|e| {
            TemplateDocError::InvalidFrontmatter(format!("failed to create dir: {e}"))
        })?;
        std::fs::write(template_dir.join("TEMPLATE.md"), content).map_err(|e| {
            TemplateDocError::InvalidFrontmatter(format!("failed to write file: {e}"))
        })?;
        Ok(doc)
    }

    /// Update an existing template by slug.
    pub fn update(
        moxxy_home: &Path,
        slug: &str,
        content: &str,
    ) -> Result<TemplateDoc, TemplateDocError> {
        let doc = TemplateDoc::parse(content)?;
        let template_dir = moxxy_home.join("templates").join(slug);
        if !template_dir.exists() {
            return Err(TemplateDocError::InvalidFrontmatter(format!(
                "template '{}' not found",
                slug
            )));
        }
        std::fs::write(template_dir.join("TEMPLATE.md"), content).map_err(|e| {
            TemplateDocError::InvalidFrontmatter(format!("failed to write file: {e}"))
        })?;
        Ok(doc)
    }

    /// Delete a template and nullify agent references.
    pub fn delete(moxxy_home: &Path, slug: &str) -> Result<(), String> {
        let template_dir = moxxy_home.join("templates").join(slug);
        if !template_dir.exists() {
            return Err(format!("template '{}' not found", slug));
        }
        std::fs::remove_dir_all(&template_dir)
            .map_err(|e| format!("failed to remove template dir: {e}"))?;

        // Scan agents and nullify template references
        Self::nullify_agent_refs(moxxy_home, slug);
        Ok(())
    }

    /// Load and parse a template by slug.
    pub fn load(moxxy_home: &Path, slug: &str) -> Result<TemplateDoc, TemplateDocError> {
        let path = moxxy_home.join("templates").join(slug).join("TEMPLATE.md");
        TemplateDoc::load_from_file(&path)
    }

    /// Write built-in templates if not already present (idempotent).
    pub fn seed_builtins(moxxy_home: &Path) {
        for (slug, content) in BUILTIN_TEMPLATES {
            let template_dir = moxxy_home.join("templates").join(slug);
            let template_file = template_dir.join("TEMPLATE.md");
            if !template_file.exists() {
                if let Err(e) = std::fs::create_dir_all(&template_dir) {
                    tracing::warn!(slug, error = %e, "Failed to create builtin template dir");
                    continue;
                }
                if let Err(e) = std::fs::write(&template_file, content) {
                    tracing::warn!(slug, error = %e, "Failed to write builtin template");
                }
            }
        }
    }

    /// Scan agent.yaml files and clear template references matching a deleted slug.
    fn nullify_agent_refs(moxxy_home: &Path, slug: &str) {
        let agents_dir = moxxy_home.join("agents");
        let entries = match std::fs::read_dir(&agents_dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let config_path = entry.path().join("agent.yaml");
            if !config_path.is_file() {
                continue;
            }
            if let Ok(mut config) = moxxy_types::AgentConfig::load(&config_path)
                && config.template.as_deref() == Some(slug)
            {
                config.template = None;
                let _ = config.save(&config_path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn valid_content(name: &str) -> String {
        format!("---\nname: {name}\ndescription: A template\nversion: \"1.0\"\n---\n# {name}\nBody")
    }

    #[test]
    fn create_and_load_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let content = valid_content("Builder");
        let doc = TemplateStore::create(tmp.path(), &content).unwrap();
        assert_eq!(doc.slug(), "builder");

        let loaded = TemplateStore::load(tmp.path(), "builder").unwrap();
        assert_eq!(loaded.name, "Builder");
    }

    #[test]
    fn list_returns_sorted_slugs() {
        let tmp = TempDir::new().unwrap();
        TemplateStore::create(tmp.path(), &valid_content("Zebra")).unwrap();
        TemplateStore::create(tmp.path(), &valid_content("Alpha")).unwrap();

        let slugs = TemplateStore::list(tmp.path());
        assert_eq!(slugs, vec!["alpha", "zebra"]);
    }

    #[test]
    fn delete_removes_template() {
        let tmp = TempDir::new().unwrap();
        TemplateStore::create(tmp.path(), &valid_content("Builder")).unwrap();
        assert_eq!(TemplateStore::list(tmp.path()).len(), 1);

        TemplateStore::delete(tmp.path(), "builder").unwrap();
        assert!(TemplateStore::list(tmp.path()).is_empty());
    }

    #[test]
    fn delete_cascades_to_agent_refs() {
        let tmp = TempDir::new().unwrap();
        TemplateStore::create(tmp.path(), &valid_content("Builder")).unwrap();

        // Create an agent referencing this template
        let agent_dir = tmp.path().join("agents").join("test-agent");
        std::fs::create_dir_all(&agent_dir).unwrap();
        let config = moxxy_types::AgentConfig {
            provider: "openai".into(),
            model: "gpt-4".into(),
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            policy_profile: None,
            core_mount: None,
            template: Some("builder".into()),
        };
        config.save(&agent_dir.join("agent.yaml")).unwrap();

        TemplateStore::delete(tmp.path(), "builder").unwrap();

        // Verify agent template was cleared
        let reloaded = moxxy_types::AgentConfig::load(&agent_dir.join("agent.yaml")).unwrap();
        assert!(reloaded.template.is_none());
    }

    #[test]
    fn seed_builtins_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        TemplateStore::seed_builtins(tmp.path());
        let count1 = TemplateStore::list(tmp.path()).len();
        assert!(count1 > 0);

        TemplateStore::seed_builtins(tmp.path());
        let count2 = TemplateStore::list(tmp.path()).len();
        assert_eq!(count1, count2);
    }

    #[test]
    fn update_existing_template() {
        let tmp = TempDir::new().unwrap();
        TemplateStore::create(tmp.path(), &valid_content("Builder")).unwrap();

        let updated_content =
            "---\nname: Builder v2\ndescription: Updated\nversion: \"2.0\"\n---\nNew body";
        let doc = TemplateStore::update(tmp.path(), "builder", updated_content).unwrap();
        assert_eq!(doc.version, "2.0");

        let loaded = TemplateStore::load(tmp.path(), "builder").unwrap();
        assert_eq!(loaded.version, "2.0");
    }

    #[test]
    fn update_nonexistent_fails() {
        let tmp = TempDir::new().unwrap();
        let result = TemplateStore::update(tmp.path(), "nope", &valid_content("Nope"));
        assert!(result.is_err());
    }

    #[test]
    fn delete_nonexistent_fails() {
        let tmp = TempDir::new().unwrap();
        let result = TemplateStore::delete(tmp.path(), "nope");
        assert!(result.is_err());
    }
}
