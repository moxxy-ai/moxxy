use async_trait::async_trait;
use std::path::PathBuf;
use std::time::Duration;

use crate::registry::{Primitive, PrimitiveError};

/// Simple HTTP fetch with optional CSS selector extraction.
/// Uses reqwest directly = no browser needed.
pub struct BrowseFetchPrimitive {
    allowlist_path: PathBuf,
    timeout: Duration,
    max_response_bytes: usize,
}

impl BrowseFetchPrimitive {
    pub fn new(
        allowlist_path: PathBuf,
        timeout: Duration,
        max_response_bytes: usize,
    ) -> Self {
        Self {
            allowlist_path,
            timeout,
            max_response_bytes,
        }
    }

    fn is_domain_allowed(&self, domain: &str) -> bool {
        let file = moxxy_core::AllowlistFile::load(&self.allowlist_path);
        let allows = file.allows("http_domain");
        let denials = file.denials("http_domain");
        let allowed =
            crate::defaults::merge_with_defaults_and_denials(allows, denials, "http_domain");
        crate::url_policy::is_domain_allowed(domain, &allowed)
    }
}

#[async_trait]
impl Primitive for BrowseFetchPrimitive {
    fn name(&self) -> &str {
        "browse.fetch"
    }

    fn description(&self) -> &str {
        "Fetch a web page via HTTP and return its content. Optionally extract text via CSS selector."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to fetch"},
                "selector": {"type": "string", "description": "Optional CSS selector to extract specific content"}
            },
            "required": ["url"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let url = params["url"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'url' parameter".into()))?;

        let domain = crate::url_policy::extract_host(url)
            .ok_or_else(|| PrimitiveError::InvalidParams("cannot parse domain from URL".into()))?;

        if !self.is_domain_allowed(&domain) {
            tracing::warn!(url, %domain, "Browse fetch blocked = domain not in allowlist");
            return Err(PrimitiveError::AccessDenied(format!(
                "Domain '{}' not in allowlist",
                domain
            )));
        }

        tracing::info!(url, %domain, "Fetching URL");

        let client = reqwest::Client::builder()
            .timeout(self.timeout)
            .user_agent("Moxxy/1.0")
            .build()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("HTTP client error: {}", e)))?;

        let resp = client.get(url).send().await.map_err(|e| {
            if e.is_timeout() {
                PrimitiveError::Timeout
            } else {
                PrimitiveError::ExecutionFailed(format!("Fetch failed: {}", e))
            }
        })?;

        let status = resp.status().as_u16();
        let bytes = resp.bytes().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("Failed to read response: {}", e))
        })?;

        if bytes.len() > self.max_response_bytes {
            return Err(PrimitiveError::SizeLimitExceeded);
        }

        let body = String::from_utf8_lossy(&bytes).to_string();

        // Extract title from HTML
        let title = extract_title(&body);

        // Optional CSS selector extraction
        let selected_text = params["selector"]
            .as_str()
            .map(|sel| extract_by_selector(&body, sel));

        let mut result = serde_json::json!({
            "status": status,
            "url": url,
            "body_length": body.len(),
        });

        if let Some(t) = title {
            result["title"] = serde_json::Value::String(t);
        }

        if let Some(text) = selected_text {
            result["selected_text"] = serde_json::Value::String(text);
        }

        // Return truncated body for large pages
        let body_preview = if body.len() > 50_000 {
            format!("{}...[truncated]", &body[..50_000])
        } else {
            body
        };
        result["body"] = serde_json::Value::String(body_preview);

        Ok(result)
    }
}

/// Extract structured data from HTML using CSS selectors.
/// Pure parsing = no network requests.
pub struct BrowseExtractPrimitive;

impl BrowseExtractPrimitive {
    pub fn new() -> Self {
        Self
    }
}

impl Default for BrowseExtractPrimitive {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Primitive for BrowseExtractPrimitive {
    fn name(&self) -> &str {
        "browse.extract"
    }

    fn description(&self) -> &str {
        "Extract structured data from HTML using CSS selectors. Pure parsing, no network requests."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "html": {"type": "string", "description": "HTML content to parse"},
                "selectors": {"type": "object", "description": "Map of field names to CSS selectors"}
            },
            "required": ["html", "selectors"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let html = params["html"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'html' parameter".into()))?;

        let selectors = params["selectors"].as_object().ok_or_else(|| {
            PrimitiveError::InvalidParams("missing 'selectors' object parameter".into())
        })?;

        tracing::debug!(
            selectors_count = selectors.len(),
            html_len = html.len(),
            "Extracting from HTML"
        );

        let document = scraper::Html::parse_document(html);
        let mut data = serde_json::Map::new();

        for (field, selector_val) in selectors {
            let selector_str = selector_val.as_str().unwrap_or("");
            if let Ok(selector) = scraper::Selector::parse(selector_str) {
                let texts: Vec<String> = document
                    .select(&selector)
                    .map(|el| el.text().collect::<String>().trim().to_string())
                    .collect();

                if texts.len() == 1 {
                    data.insert(field.clone(), serde_json::Value::String(texts[0].clone()));
                } else {
                    data.insert(field.clone(), serde_json::json!(texts));
                }
            } else {
                data.insert(
                    field.clone(),
                    serde_json::Value::String(format!("invalid selector: {}", selector_str)),
                );
            }
        }

        Ok(serde_json::json!({ "data": data }))
    }
}

fn extract_title(html: &str) -> Option<String> {
    let doc = scraper::Html::parse_document(html);
    let selector = scraper::Selector::parse("title").ok()?;
    doc.select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
}

fn extract_by_selector(html: &str, selector_str: &str) -> String {
    let doc = scraper::Html::parse_document(html);
    match scraper::Selector::parse(selector_str) {
        Ok(selector) => doc
            .select(&selector)
            .map(|el| el.text().collect::<String>().trim().to_string())
            .collect::<Vec<_>>()
            .join("\n"),
        Err(_) => format!("invalid selector: {}", selector_str),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn browse_extract_parses_html() {
        let prim = BrowseExtractPrimitive::new();
        let html = r#"<html><head><title>Test</title></head><body><h1>Hello</h1><p class="desc">World</p></body></html>"#;
        let result = prim
            .invoke(serde_json::json!({
                "html": html,
                "selectors": {
                    "heading": "h1",
                    "description": "p.desc"
                }
            }))
            .await
            .unwrap();
        assert_eq!(result["data"]["heading"], "Hello");
        assert_eq!(result["data"]["description"], "World");
    }

    #[tokio::test]
    async fn browse_extract_handles_multiple_matches() {
        let prim = BrowseExtractPrimitive::new();
        let html = r#"<ul><li>A</li><li>B</li><li>C</li></ul>"#;
        let result = prim
            .invoke(serde_json::json!({
                "html": html,
                "selectors": { "items": "li" }
            }))
            .await
            .unwrap();
        let items = result["data"]["items"].as_array().unwrap();
        assert_eq!(items.len(), 3);
    }

    #[tokio::test]
    async fn browse_extract_requires_html_param() {
        let prim = BrowseExtractPrimitive::new();
        let result = prim
            .invoke(serde_json::json!({"selectors": {"h": "h1"}}))
            .await;
        assert!(result.is_err());
    }

    #[test]
    fn extract_title_from_html() {
        let html = "<html><head><title>My Page</title></head><body></body></html>";
        assert_eq!(extract_title(html), Some("My Page".into()));
    }

    #[test]
    fn extract_title_returns_none_for_missing() {
        let html = "<html><body>No title</body></html>";
        assert_eq!(extract_title(html), None);
    }

    #[tokio::test]
    async fn browse_fetch_blocks_disallowed_domain() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("allowlists.yaml");
        let mut file = moxxy_core::AllowlistFile::default();
        file.add_allow("http_domain", "allowed.com".into());
        file.save(&path).unwrap();

        let prim = BrowseFetchPrimitive::new(path, Duration::from_secs(5), 1024 * 1024);
        let result = prim
            .invoke(serde_json::json!({"url": "https://evil.com/page"}))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn browse_fetch_allows_default_domains() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("allowlists.yaml");
        // Empty file = only defaults
        std::fs::write(&path, "").unwrap();

        let prim = BrowseFetchPrimitive::new(path, Duration::from_secs(5), 1024 * 1024);
        // Default domains are allowed
        assert!(prim.is_domain_allowed("github.com"));
        assert!(prim.is_domain_allowed("stackoverflow.com"));
        // Unknown domains are blocked
        assert!(!prim.is_domain_allowed("random-unknown.com"));
    }
}
