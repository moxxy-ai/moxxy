use moxxy_types::SkillDocError;

#[derive(Debug)]
pub struct SkillDoc {
    pub id: String,
    pub name: String,
    pub version: String,
    pub inputs_schema: serde_json::Value,
    pub allowed_primitives: Vec<String>,
    pub safety_notes: String,
    pub body: String,
}

impl SkillDoc {
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

        let id = frontmatter
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| SkillDocError::MissingField("id".to_string()))?
            .to_string();

        let name = frontmatter
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| SkillDocError::MissingField("name".to_string()))?
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

        if allowed_primitives.is_empty() {
            return Err(SkillDocError::InvalidPrimitive(
                "allowed_primitives must not be empty".to_string(),
            ));
        }

        let safety_notes = frontmatter
            .get("safety_notes")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Ok(SkillDoc {
            id,
            name,
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
id: my-skill
name: My Skill
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
        assert_eq!(doc.id, "my-skill");
        assert_eq!(doc.name, "My Skill");
        assert_eq!(doc.version, "1.0");
        assert!(doc.body.contains("# Instructions"));
    }

    #[test]
    fn rejects_missing_id() {
        let input = r#"---
name: My Skill
version: "1.0"
inputs_schema: {}
allowed_primitives: [fs.read]
safety_notes: "safe"
---
body"#;
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::MissingField(_)));
    }

    #[test]
    fn rejects_missing_name() {
        let input = r#"---
id: my-skill
version: "1.0"
inputs_schema: {}
allowed_primitives: [fs.read]
safety_notes: "safe"
---
body"#;
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::MissingField(_)));
    }

    #[test]
    fn rejects_missing_version() {
        let input = r#"---
id: my-skill
name: My Skill
inputs_schema: {}
allowed_primitives: [fs.read]
safety_notes: "safe"
---
body"#;
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::MissingField(_)));
    }

    #[test]
    fn rejects_empty_allowed_primitives() {
        let input = r#"---
id: my-skill
name: My Skill
version: "1.0"
inputs_schema: {}
allowed_primitives: []
safety_notes: "safe"
---
body"#;
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::InvalidPrimitive(_)));
    }

    #[test]
    fn rejects_no_frontmatter_delimiters() {
        let input = "Just some text without frontmatter";
        let err = SkillDoc::parse(input).unwrap_err();
        assert!(matches!(err, SkillDocError::InvalidFrontmatter(_)));
    }

    #[test]
    fn preserves_body_whitespace() {
        let input = "---\nid: s\nname: S\nversion: \"1\"\ninputs_schema: {}\nallowed_primitives: [fs.read]\nsafety_notes: safe\n---\n  indented\n    more indented";
        let doc = SkillDoc::parse(input).unwrap();
        assert!(doc.body.contains("  indented"));
        assert!(doc.body.contains("    more indented"));
    }
}
