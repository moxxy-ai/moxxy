use moxxy_types::SkillDocError;

#[derive(Debug)]
pub struct SkillDoc {
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub inputs_schema: serde_json::Value,
    pub allowed_primitives: Vec<String>,
    pub safety_notes: String,
    pub body: String,
}

impl SkillDoc {
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

    pub fn load_from_file(path: &std::path::Path) -> Result<Self, SkillDocError> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| SkillDocError::InvalidFrontmatter(format!("cannot read file: {e}")))?;
        Self::parse(&content)
    }

    pub fn parse(input: &str) -> Result<Self, SkillDocError> {
        // Find frontmatter delimiters
        if !input.starts_with("---") {
            return Err(SkillDocError::InvalidFrontmatter(
                "missing opening ---".to_string(),
            ));
        }

        let after_first = &input[3..];
        let end_idx = after_first
            .find("\n---")
            .ok_or_else(|| SkillDocError::InvalidFrontmatter("missing closing ---".to_string()))?;

        let frontmatter_str = &after_first[..end_idx];
        let body_start = 3 + end_idx + 4; // skip "---" + "\n---" + "\n"
        let body = if body_start < input.len() {
            &input[body_start..]
        } else {
            ""
        };

        let frontmatter: serde_yaml::Value = serde_yaml::from_str(frontmatter_str)
            .map_err(|e| SkillDocError::InvalidFrontmatter(e.to_string()))?;

        let name = frontmatter
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| SkillDocError::MissingField("name".to_string()))?
            .to_string();

        let description = frontmatter
            .get("description")
            .and_then(|v| v.as_str())
            .ok_or_else(|| SkillDocError::MissingField("description".to_string()))?
            .to_string();

        let author = frontmatter
            .get("author")
            .and_then(|v| v.as_str())
            .ok_or_else(|| SkillDocError::MissingField("author".to_string()))?
            .to_string();

        let version = frontmatter
            .get("version")
            .and_then(|v| v.as_str())
            .ok_or_else(|| SkillDocError::MissingField("version".to_string()))?
            .to_string();

        let inputs_schema = frontmatter
            .get("inputs_schema")
            .cloned()
            .unwrap_or(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));

        let inputs_schema_json: serde_json::Value =
            serde_json::to_value(&inputs_schema).unwrap_or(serde_json::json!({}));

        let allowed_primitives: Vec<String> = frontmatter
            .get("allowed_primitives")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let safety_notes = frontmatter
            .get("safety_notes")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Ok(SkillDoc {
            name,
            description,
            author,
            version,
            inputs_schema: inputs_schema_json,
            allowed_primitives,
            safety_notes,
            body: body.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_yaml_frontmatter_and_markdown_body() {
        let input = r#"---
name: My Skill
description: A useful skill for testing
author: tester
version: "1.0"
inputs_schema: {}
allowed_primitives:
  - fs.read
  - fs.write
safety_notes: "Safe skill"
---
# Instructions
Do something useful."#;
        let doc = SkillDoc::parse(input).unwrap();
        assert_eq!(doc.name, "My Skill");
        assert_eq!(doc.description, "A useful skill for testing");
        assert_eq!(doc.author, "tester");
        assert_eq!(doc.version, "1.0");
        assert!(doc.body.contains("# Instructions"));
    }

    #[test]
    fn slug_derived_from_name() {
        let input =
            "---\nname: My Cool Skill!\ndescription: test\nauthor: me\nversion: \"1.0\"\n---\nbody";
        let doc = SkillDoc::parse(input).unwrap();
        assert_eq!(doc.slug(), "my-cool-skill");
    }

    #[test]
    fn slug_handles_simple_name() {
        let input = "---\nname: deploy\ndescription: test\nauthor: me\nversion: \"1.0\"\n---\nbody";
        let doc = SkillDoc::parse(input).unwrap();
        assert_eq!(doc.slug(), "deploy");
    }

    #[test]
    fn rejects_missing_name() {
        let input = r#"---
description: test
author: me
version: "1.0"
---
body"#;
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::MissingField(_)));
    }

    #[test]
    fn rejects_missing_description() {
        let input = r#"---
name: My Skill
author: me
version: "1.0"
---
body"#;
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::MissingField(_)));
    }

    #[test]
    fn rejects_missing_author() {
        let input = r#"---
name: My Skill
description: test
version: "1.0"
---
body"#;
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::MissingField(_)));
    }

    #[test]
    fn rejects_missing_version() {
        let input = r#"---
name: My Skill
description: test
author: me
---
body"#;
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::MissingField(_)));
    }

    #[test]
    fn empty_allowed_primitives_succeeds() {
        let input = r#"---
name: My Skill
description: test
author: me
version: "1.0"
allowed_primitives: []
---
body"#;
        let doc = SkillDoc::parse(input).unwrap();
        assert!(doc.allowed_primitives.is_empty());
    }

    #[test]
    fn omitted_allowed_primitives_defaults_to_empty() {
        let input =
            "---\nname: My Skill\ndescription: test\nauthor: me\nversion: \"1.0\"\n---\nbody";
        let doc = SkillDoc::parse(input).unwrap();
        assert!(doc.allowed_primitives.is_empty());
    }

    #[test]
    fn rejects_no_frontmatter_delimiters() {
        let input = "Just some text without frontmatter";
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::InvalidFrontmatter(_)));
    }

    #[test]
    fn preserves_body_whitespace() {
        let input = "---\nname: S\ndescription: d\nauthor: a\nversion: \"1\"\n---\n  indented\n    more indented";
        let doc = SkillDoc::parse(input).unwrap();
        assert!(doc.body.contains("  indented"));
        assert!(doc.body.contains("    more indented"));
    }
}
