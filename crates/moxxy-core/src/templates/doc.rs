use moxxy_types::TemplateDocError;

#[derive(Debug)]
pub struct TemplateDoc {
    pub name: String,
    pub description: String,
    pub version: String,
    pub tags: Vec<String>,
    pub body: String,
}

impl TemplateDoc {
    /// Derive a slug from the name: lowercase, spaces/special chars → `-`.
    pub fn slug(&self) -> String {
        self.name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .collect::<String>()
            .split('-')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("-")
    }

    pub fn load_from_file(path: &std::path::Path) -> Result<Self, TemplateDocError> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| TemplateDocError::InvalidFrontmatter(format!("cannot read file: {e}")))?;
        Self::parse(&content)
    }

    pub fn parse(input: &str) -> Result<Self, TemplateDocError> {
        if !input.starts_with("---") {
            return Err(TemplateDocError::InvalidFrontmatter(
                "missing opening ---".to_string(),
            ));
        }

        let after_first = &input[3..];
        let end_idx = after_first.find("\n---").ok_or_else(|| {
            TemplateDocError::InvalidFrontmatter("missing closing ---".to_string())
        })?;

        let frontmatter_str = &after_first[..end_idx];
        let body_start = 3 + end_idx + 4; // skip "---" + "\n---" + "\n"
        let body = if body_start < input.len() {
            &input[body_start..]
        } else {
            ""
        };

        let frontmatter: serde_yaml::Value = serde_yaml::from_str(frontmatter_str)
            .map_err(|e| TemplateDocError::InvalidFrontmatter(e.to_string()))?;

        let name = frontmatter
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| TemplateDocError::MissingField("name".to_string()))?
            .to_string();

        let description = frontmatter
            .get("description")
            .and_then(|v| v.as_str())
            .ok_or_else(|| TemplateDocError::MissingField("description".to_string()))?
            .to_string();

        let version = frontmatter
            .get("version")
            .and_then(|v| v.as_str())
            .ok_or_else(|| TemplateDocError::MissingField("version".to_string()))?
            .to_string();

        let tags: Vec<String> = frontmatter
            .get("tags")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(TemplateDoc {
            name,
            description,
            version,
            tags,
            body: body.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_template() {
        let input = r#"---
name: Builder
description: Software builder focused on clean code
version: "1.0"
tags: [builder, coding]
---
# Builder Archetype

You are a Builder."#;
        let doc = TemplateDoc::parse(input).unwrap();
        assert_eq!(doc.name, "Builder");
        assert_eq!(doc.description, "Software builder focused on clean code");
        assert_eq!(doc.version, "1.0");
        assert_eq!(doc.tags, vec!["builder", "coding"]);
        assert!(doc.body.contains("# Builder Archetype"));
    }

    #[test]
    fn slug_derived_from_name() {
        let input = "---\nname: My Cool Template!\ndescription: test\nversion: \"1.0\"\n---\nbody";
        let doc = TemplateDoc::parse(input).unwrap();
        assert_eq!(doc.slug(), "my-cool-template");
    }

    #[test]
    fn slug_handles_simple_name() {
        let input = "---\nname: builder\ndescription: test\nversion: \"1.0\"\n---\nbody";
        let doc = TemplateDoc::parse(input).unwrap();
        assert_eq!(doc.slug(), "builder");
    }

    #[test]
    fn rejects_missing_name() {
        let input = "---\ndescription: test\nversion: \"1.0\"\n---\nbody";
        let err = TemplateDoc::parse(input).unwrap_err();
        assert!(matches!(err, TemplateDocError::MissingField(_)));
    }

    #[test]
    fn rejects_missing_description() {
        let input = "---\nname: Builder\nversion: \"1.0\"\n---\nbody";
        let err = TemplateDoc::parse(input).unwrap_err();
        assert!(matches!(err, TemplateDocError::MissingField(_)));
    }

    #[test]
    fn rejects_missing_version() {
        let input = "---\nname: Builder\ndescription: test\n---\nbody";
        let err = TemplateDoc::parse(input).unwrap_err();
        assert!(matches!(err, TemplateDocError::MissingField(_)));
    }

    #[test]
    fn rejects_no_frontmatter() {
        let input = "Just some text without frontmatter";
        let err = TemplateDoc::parse(input).unwrap_err();
        assert!(matches!(err, TemplateDocError::InvalidFrontmatter(_)));
    }

    #[test]
    fn tags_default_to_empty() {
        let input = "---\nname: Builder\ndescription: test\nversion: \"1.0\"\n---\nbody";
        let doc = TemplateDoc::parse(input).unwrap();
        assert!(doc.tags.is_empty());
    }

    #[test]
    fn preserves_body_whitespace() {
        let input = "---\nname: B\ndescription: d\nversion: \"1\"\n---\n  indented\n    more";
        let doc = TemplateDoc::parse(input).unwrap();
        assert!(doc.body.contains("  indented"));
        assert!(doc.body.contains("    more"));
    }
}
