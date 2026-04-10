//! Lightweight HTTP-only browse primitives.
//!
//! `browse.fetch` does a plain reqwest fetch (no JS rendering) and `browse.extract`
//! parses HTML offline. For JS-rendered pages, screenshots, interaction, and
//! crawling, see the `browser.*` namespace backed by the Playwright sidecar.

use async_trait::async_trait;
use moxxy_core::NetworkMode;
use std::path::PathBuf;
use std::time::Duration;

use crate::html_text;
use crate::registry::{Primitive, PrimitiveError};

// ---------------------------------------------------------------------------
// Shared: browser-like HTTP client builder
// ---------------------------------------------------------------------------

/// Build a reqwest client with realistic browser headers and cookie support.
pub fn build_browser_client(timeout: Duration) -> Result<reqwest::Client, PrimitiveError> {
    use reqwest::header::{self, HeaderMap, HeaderValue};

    let mut headers = HeaderMap::new();
    headers.insert(
        header::ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ),
    );
    headers.insert(
        header::ACCEPT_LANGUAGE,
        HeaderValue::from_static("en-US,en;q=0.5"),
    );
    headers.insert(
        header::HeaderName::from_static("sec-fetch-dest"),
        HeaderValue::from_static("document"),
    );
    headers.insert(
        header::HeaderName::from_static("sec-fetch-mode"),
        HeaderValue::from_static("navigate"),
    );
    headers.insert(
        header::HeaderName::from_static("sec-fetch-site"),
        HeaderValue::from_static("none"),
    );
    headers.insert(
        header::HeaderName::from_static("sec-fetch-user"),
        HeaderValue::from_static("?1"),
    );
    headers.insert(
        header::HeaderName::from_static("upgrade-insecure-requests"),
        HeaderValue::from_static("1"),
    );

    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
             AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/123.0.0.0 Safari/537.36",
        )
        .default_headers(headers)
        .cookie_store(true)
        .build()
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("HTTP client error: {e}")))
}

// ---------------------------------------------------------------------------
// Shared: domain allowlist check
// ---------------------------------------------------------------------------

fn is_domain_allowed(allowlist_path: &std::path::Path, domain: &str) -> bool {
    let file = moxxy_core::AllowlistFile::load(allowlist_path);
    let allows = file.allows("http_domain");
    let denials = file.denials("http_domain");
    let allowed = crate::defaults::merge_with_defaults_and_denials(allows, denials, "http_domain");
    crate::url_policy::is_domain_allowed(domain, &allowed)
}

/// Check domain against allowlist, respecting NetworkMode.
fn check_domain(
    allowlist_path: &std::path::Path,
    network_mode: NetworkMode,
    url: &str,
    domain: &str,
    primitive_name: &str,
) -> Option<serde_json::Value> {
    match network_mode {
        NetworkMode::Unsafe => {
            tracing::debug!(url, %domain, "Unsafe mode — skipping domain allowlist check");
            None
        }
        NetworkMode::Safe => {
            if !is_domain_allowed(allowlist_path, domain) {
                tracing::info!(url, %domain, "Domain not in allowlist — prompting agent to ask user");
                Some(serde_json::json!({
                    "status": "domain_not_allowed",
                    "domain": domain,
                    "url": url,
                    "action_required": format!(
                        "Domain '{}' is not in the allowlist. \
                         Use `user.ask` to ask the user whether to allow access to this domain. \
                         If approved, call `allowlist.add` with list_type \"http_domain\" and entry \"{}\" \
                         to add it, then retry this {} call.",
                        domain, domain, primitive_name
                    )
                }))
            } else {
                None
            }
        }
    }
}

// ---------------------------------------------------------------------------
// browse.fetch
// ---------------------------------------------------------------------------

/// HTTP fetch with browser-like headers, clean text extraction, and link discovery.
pub struct BrowseFetchPrimitive {
    allowlist_path: PathBuf,
    timeout: Duration,
    max_response_bytes: usize,
    network_mode: NetworkMode,
}

impl BrowseFetchPrimitive {
    pub fn new(
        allowlist_path: PathBuf,
        timeout: Duration,
        max_response_bytes: usize,
        network_mode: NetworkMode,
    ) -> Self {
        Self {
            allowlist_path,
            timeout,
            max_response_bytes,
            network_mode,
        }
    }

    pub fn is_domain_allowed(&self, domain: &str) -> bool {
        is_domain_allowed(&self.allowlist_path, domain)
    }
}

#[async_trait]
impl Primitive for BrowseFetchPrimitive {
    fn name(&self) -> &str {
        "browse.fetch"
    }

    fn description(&self) -> &str {
        "Fast HTTP fetch (no JS execution). Returns clean readable text, extracted links, and \
         optional CSS-selected content. For JS-rendered pages use browser.navigate + browser.read."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to fetch"},
                "selector": {"type": "string", "description": "Optional CSS selector to extract specific content"},
                "include_html": {"type": "boolean", "description": "Include raw HTML in response (default false)"}
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

        if let Some(blocked) = check_domain(
            &self.allowlist_path,
            self.network_mode,
            url,
            &domain,
            "browse.fetch",
        ) {
            return Ok(blocked);
        }

        tracing::info!(url, %domain, "Fetching URL");

        let client = build_browser_client(self.timeout)?;

        let resp = client.get(url).send().await.map_err(|e| {
            if e.is_timeout() {
                PrimitiveError::Timeout
            } else {
                PrimitiveError::ExecutionFailed(format!("Fetch failed: {e}"))
            }
        })?;

        let status = resp.status().as_u16();
        let bytes = resp.bytes().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("Failed to read response: {e}"))
        })?;

        if bytes.len() > self.max_response_bytes {
            return Err(PrimitiveError::SizeLimitExceeded);
        }

        let body = String::from_utf8_lossy(&bytes).to_string();

        let (text, links) = html_text::extract_text_and_links(&body, url);
        let title = extract_title(&body);

        let selected_text = params["selector"]
            .as_str()
            .map(|sel| extract_by_selector(&body, sel));

        let include_html = params["include_html"].as_bool().unwrap_or(false);

        let mut result = serde_json::json!({
            "status": status,
            "url": url,
            "body_length": body.len(),
            "text": &text,
            "links": links.iter().map(|l| serde_json::json!({"url": &l.url, "text": &l.text})).collect::<Vec<_>>(),
        });

        if let Some(t) = title {
            result["title"] = serde_json::Value::String(t);
        }
        if let Some(text) = selected_text {
            result["selected_text"] = serde_json::Value::String(text);
        }
        if include_html {
            result["body"] = serde_json::Value::String(body.clone());
        }

        Ok(result)
    }
}

// ---------------------------------------------------------------------------
// browse.extract — pure HTML parsing, no network
// ---------------------------------------------------------------------------

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

    fn is_concurrent_safe(&self) -> bool {
        true
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
                    serde_json::Value::String(format!("invalid selector: {selector_str}")),
                );
            }
        }

        Ok(serde_json::json!({ "data": data }))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        Err(_) => format!("invalid selector: {selector_str}"),
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
                "selectors": { "heading": "h1", "description": "p.desc" }
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
    async fn browse_fetch_safe_mode_returns_prompt_for_disallowed_domain() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("allowlists.yaml");
        let mut file = moxxy_core::AllowlistFile::default();
        file.add_allow("http_domain", "allowed.com".into());
        file.save(&path).unwrap();

        let prim =
            BrowseFetchPrimitive::new(path, Duration::from_secs(5), 1024 * 1024, NetworkMode::Safe);
        let result = prim
            .invoke(serde_json::json!({"url": "https://evil.com/page"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "domain_not_allowed");
        assert_eq!(result["domain"], "evil.com");
        assert!(
            result["action_required"]
                .as_str()
                .unwrap()
                .contains("user.ask")
        );
    }

    #[tokio::test]
    async fn browse_fetch_allows_default_domains() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("allowlists.yaml");
        std::fs::write(&path, "").unwrap();

        let prim =
            BrowseFetchPrimitive::new(path, Duration::from_secs(5), 1024 * 1024, NetworkMode::Safe);
        assert!(prim.is_domain_allowed("github.com"));
        assert!(prim.is_domain_allowed("stackoverflow.com"));
        assert!(!prim.is_domain_allowed("random-unknown.com"));
    }

    #[test]
    fn browser_client_builds_successfully() {
        let client = build_browser_client(Duration::from_secs(10));
        assert!(client.is_ok());
    }
}
