use std::path::{Path, PathBuf};

use super::doc::TemplateDoc;

#[derive(Debug)]
pub struct LoadedTemplate {
    pub doc: TemplateDoc,
    pub path: PathBuf,
}

pub struct TemplateLoader;

impl TemplateLoader {
    /// Load all templates from `{moxxy_home}/templates/*/TEMPLATE.md`.
    pub fn load_all(moxxy_home: &Path) -> Vec<LoadedTemplate> {
        let templates_dir = moxxy_home.join("templates");
        let entries = match std::fs::read_dir(&templates_dir) {
            Ok(entries) => entries,
            Err(_) => return Vec::new(),
        };

        let mut templates = Vec::new();
        for entry in entries.flatten() {
            let template_md = entry.path().join("TEMPLATE.md");
            if template_md.is_file() {
                match TemplateDoc::load_from_file(&template_md) {
                    Ok(doc) => {
                        templates.push(LoadedTemplate {
                            doc,
                            path: template_md,
                        });
                    }
                    Err(e) => {
                        tracing::warn!(
                            path = %template_md.display(),
                            error = %e,
                            "Skipping invalid template file"
                        );
                    }
                }
            }
        }
        templates
    }

    /// Load a specific template by slug from `{moxxy_home}/templates/{slug}/TEMPLATE.md`.
    pub fn load_by_slug(moxxy_home: &Path, slug: &str) -> Option<LoadedTemplate> {
        let template_md = moxxy_home.join("templates").join(slug).join("TEMPLATE.md");
        if !template_md.is_file() {
            return None;
        }
        match TemplateDoc::load_from_file(&template_md) {
            Ok(doc) => Some(LoadedTemplate {
                doc,
                path: template_md,
            }),
            Err(e) => {
                tracing::warn!(
                    slug = %slug,
                    error = %e,
                    "Failed to load template"
                );
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn valid_template_content(name: &str) -> String {
        format!(
            "---\nname: {name}\ndescription: A template called {name}\nversion: \"1.0\"\n---\n# {name}\nBody"
        )
    }

    fn write_template(dir: &Path, slug: &str, content: &str) {
        let template_dir = dir.join("templates").join(slug);
        std::fs::create_dir_all(&template_dir).unwrap();
        std::fs::write(template_dir.join("TEMPLATE.md"), content).unwrap();
    }

    #[test]
    fn load_all_returns_templates() {
        let tmp = TempDir::new().unwrap();
        write_template(tmp.path(), "builder", &valid_template_content("builder"));
        write_template(tmp.path(), "designer", &valid_template_content("designer"));

        let templates = TemplateLoader::load_all(tmp.path());
        assert_eq!(templates.len(), 2);
    }

    #[test]
    fn load_by_slug_finds_template() {
        let tmp = TempDir::new().unwrap();
        write_template(tmp.path(), "builder", &valid_template_content("builder"));

        let loaded = TemplateLoader::load_by_slug(tmp.path(), "builder");
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().doc.name, "builder");
    }

    #[test]
    fn load_by_slug_returns_none_for_missing() {
        let tmp = TempDir::new().unwrap();
        assert!(TemplateLoader::load_by_slug(tmp.path(), "nonexistent").is_none());
    }

    #[test]
    fn load_all_empty_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let templates = TemplateLoader::load_all(tmp.path());
        assert!(templates.is_empty());
    }

    #[test]
    fn load_all_skips_invalid_files() {
        let tmp = TempDir::new().unwrap();
        // Write an invalid TEMPLATE.md
        let bad_dir = tmp.path().join("templates").join("bad");
        std::fs::create_dir_all(&bad_dir).unwrap();
        std::fs::write(bad_dir.join("TEMPLATE.md"), "no frontmatter").unwrap();
        // Write a valid one
        write_template(tmp.path(), "good", &valid_template_content("good"));

        let templates = TemplateLoader::load_all(tmp.path());
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].doc.name, "good");
    }
}
