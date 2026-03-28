use moxxy_types::WebhookDocError;

#[derive(Debug, Clone)]
pub struct WebhookDoc {
    pub label: String,
    pub token: String,
    pub event_filter: Option<String>,
    pub enabled: bool,
    pub secret_ref: Option<String>,
    pub body: String,
}

impl WebhookDoc {
    /// Derive a filesystem-safe slug from the label.
    pub fn slug(&self) -> String {
        self.label
            .to_lowercase()
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>()
            .trim_matches('-')
            .to_string()
    }

    /// Parse a markdown string with YAML frontmatter into a `WebhookDoc`.
    pub fn parse(input: &str) -> Result<Self, WebhookDocError> {
        if !input.starts_with("---") {
            return Err(WebhookDocError::InvalidFrontmatter(
                "missing opening ---".to_string(),
            ));
        }

        let after_first = &input[3..];
        let end_idx = after_first
            .find("\n---")
            .ok_or_else(|| WebhookDocError::InvalidFrontmatter("missing closing ---".to_string()))?;

        let frontmatter_str = &after_first[..end_idx];
        // Skip "---" (3) + frontmatter (end_idx) + "\n---" (4) + "\n" (1)
        let body_start = 3 + end_idx + 5;
        let body = if body_start <= input.len() {
            &input[body_start..]
        } else {
            ""
        };

        let frontmatter: serde_yaml::Value = serde_yaml::from_str(frontmatter_str)
            .map_err(|e| WebhookDocError::InvalidFrontmatter(e.to_string()))?;

        let label = frontmatter
            .get("label")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WebhookDocError::MissingField("label".to_string()))?
            .to_string();

        let token = frontmatter
            .get("token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WebhookDocError::MissingField("token".to_string()))?
            .to_string();

        let event_filter = frontmatter
            .get("event_filter")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let enabled = frontmatter
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let secret_ref = frontmatter
            .get("secret_ref")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(WebhookDoc {
            label,
            token,
            event_filter,
            enabled,
            secret_ref,
            body: body.to_string(),
        })
    }

    /// Load a `WebhookDoc` from a markdown file.
    pub fn load_from_file(path: &std::path::Path) -> Result<Self, WebhookDocError> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| WebhookDocError::IoError(format!("{}: {e}", path.display())))?;
        Self::parse(&content)
    }

    /// Serialize back to markdown with YAML frontmatter.
    pub fn to_markdown(&self) -> String {
        let mut fm = String::new();
        fm.push_str(&format!("label: {}\n", self.label));
        fm.push_str(&format!("token: {}\n", self.token));
        if let Some(ref ef) = self.event_filter {
            fm.push_str(&format!("event_filter: {}\n", ef));
        }
        fm.push_str(&format!("enabled: {}\n", self.enabled));
        if let Some(ref sr) = self.secret_ref {
            fm.push_str(&format!("secret_ref: {}\n", sr));
        }

        let mut out = String::new();
        out.push_str("---\n");
        out.push_str(&fm);
        out.push_str("---\n");
        out.push_str(&self.body);
        out
    }

    /// Save the webhook doc to a file.
    pub fn save_to_file(&self, path: &std::path::Path) -> Result<(), WebhookDocError> {
        let content = self.to_markdown();
        std::fs::write(path, content)
            .map_err(|e| WebhookDocError::IoError(format!("{}: {e}", path.display())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_happy_path() {
        let input = "---\nlabel: GitHub Push Events\ntoken: tok-123\nevent_filter: push,pull_request\nenabled: true\nsecret_ref: webhook_secret_github\n---\n# Instructions\n\nHandle push events.\n";
        let doc = WebhookDoc::parse(input).unwrap();
        assert_eq!(doc.label, "GitHub Push Events");
        assert_eq!(doc.token, "tok-123");
        assert_eq!(doc.event_filter.as_deref(), Some("push,pull_request"));
        assert!(doc.enabled);
        assert_eq!(doc.secret_ref.as_deref(), Some("webhook_secret_github"));
        assert!(doc.body.contains("# Instructions"));
        assert!(doc.body.contains("Handle push events."));
    }

    #[test]
    fn parse_missing_label() {
        let input = "---\ntoken: tok\n---\nbody";
        let err = WebhookDoc::parse(input).unwrap_err();
        assert!(matches!(err, WebhookDocError::MissingField(_)));
    }

    #[test]
    fn parse_missing_token() {
        let input = "---\nlabel: Test\n---\nbody";
        let err = WebhookDoc::parse(input).unwrap_err();
        assert!(matches!(err, WebhookDocError::MissingField(_)));
    }

    #[test]
    fn parse_defaults() {
        let input = "---\nlabel: Minimal\ntoken: tok\n---\n";
        let doc = WebhookDoc::parse(input).unwrap();
        assert!(doc.enabled);
        assert!(doc.event_filter.is_none());
        assert!(doc.secret_ref.is_none());
        assert!(doc.body.is_empty());
    }

    #[test]
    fn parse_empty_body() {
        let input = "---\nlabel: No Body\ntoken: tok\n---\n";
        let doc = WebhookDoc::parse(input).unwrap();
        assert!(doc.body.is_empty());
    }

    #[test]
    fn slug_from_label() {
        let doc = WebhookDoc {
            label: "GitHub Push Events".into(),
            token: "t".into(),
            event_filter: None,
            enabled: true,
            secret_ref: None,
            body: String::new(),
        };
        assert_eq!(doc.slug(), "github-push-events");
    }

    #[test]
    fn round_trip() {
        let doc = WebhookDoc {
            label: "Test Hook".into(),
            token: "abc-123".into(),
            event_filter: Some("push".into()),
            enabled: true,
            secret_ref: Some("webhook_secret_test".into()),
            body: "# Instructions\n\nDo stuff.\n".into(),
        };
        let md = doc.to_markdown();
        let parsed = WebhookDoc::parse(&md).unwrap();
        assert_eq!(parsed.label, doc.label);
        assert_eq!(parsed.token, doc.token);
        assert_eq!(parsed.event_filter, doc.event_filter);
        assert_eq!(parsed.enabled, doc.enabled);
        assert_eq!(parsed.secret_ref, doc.secret_ref);
        assert_eq!(parsed.body, doc.body);
    }

    #[test]
    fn save_and_load_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("WEBHOOK.md");
        let doc = WebhookDoc {
            label: "File Test".into(),
            token: "file-tok".into(),
            event_filter: None,
            enabled: true,
            secret_ref: None,
            body: "body content\n".into(),
        };
        doc.save_to_file(&path).unwrap();
        let loaded = WebhookDoc::load_from_file(&path).unwrap();
        assert_eq!(loaded.label, "File Test");
        assert_eq!(loaded.token, "file-tok");
        assert_eq!(loaded.body, "body content\n");
    }

    #[test]
    fn rejects_no_frontmatter() {
        let input = "Just some text without frontmatter";
        let err = WebhookDoc::parse(input).unwrap_err();
        assert!(matches!(err, WebhookDocError::InvalidFrontmatter(_)));
    }

    #[test]
    fn disabled_webhook() {
        let input = "---\nlabel: Disabled\ntoken: tok\nenabled: false\n---\nbody";
        let doc = WebhookDoc::parse(input).unwrap();
        assert!(!doc.enabled);
    }
}
