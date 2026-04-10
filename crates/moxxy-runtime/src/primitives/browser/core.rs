//! Core read/render primitives: navigate, read, screenshot, extract, wait, eval, cookies.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use moxxy_core::NetworkMode;

use crate::browser::BrowserManager;
use crate::html_text;
use crate::registry::{Primitive, PrimitiveError};

// Re-use the same domain check helpers from the browse primitive — they live
// in browse.rs as private functions, so we re-implement the thin wrapper here.
fn check_domain_for(
    allowlist_path: &std::path::Path,
    network_mode: NetworkMode,
    url: &str,
    primitive_name: &str,
) -> Result<Option<serde_json::Value>, PrimitiveError> {
    let domain = crate::url_policy::extract_host(url)
        .ok_or_else(|| PrimitiveError::InvalidParams("cannot parse domain from URL".into()))?;
    if matches!(network_mode, NetworkMode::Unsafe) {
        return Ok(None);
    }
    let file = moxxy_core::AllowlistFile::load(allowlist_path);
    let allows = file.allows("http_domain");
    let denials = file.denials("http_domain");
    let allowed = crate::defaults::merge_with_defaults_and_denials(allows, denials, "http_domain");
    if crate::url_policy::is_domain_allowed(&domain, &allowed) {
        Ok(None)
    } else {
        Ok(Some(serde_json::json!({
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
        })))
    }
}

fn timeout_from_params(params: &serde_json::Value) -> Option<Duration> {
    params["timeout_ms"].as_u64().map(Duration::from_millis)
}

// ---------------------------------------------------------------------------
// browser.navigate
// ---------------------------------------------------------------------------

pub struct BrowserNavigatePrimitive {
    manager: Arc<BrowserManager>,
    allowlist_path: PathBuf,
    network_mode: NetworkMode,
}

impl BrowserNavigatePrimitive {
    pub fn new(
        manager: Arc<BrowserManager>,
        allowlist_path: PathBuf,
        network_mode: NetworkMode,
    ) -> Self {
        Self {
            manager,
            allowlist_path,
            network_mode,
        }
    }
}

#[async_trait]
impl Primitive for BrowserNavigatePrimitive {
    fn name(&self) -> &str {
        "browser.navigate"
    }
    fn description(&self) -> &str {
        "Navigate a browser session to a URL. Opens a new tab if `page_id` is omitted, \
         otherwise reuses the existing tab. Waits for `wait_until` (default: load). \
         Returns page_id, status, and final URL."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "url": {"type": "string"},
                "page_id": {"type": "string", "description": "Optional existing tab to reuse"},
                "wait_until": {
                    "type": "string",
                    "enum": ["load", "domcontentloaded", "networkidle", "commit"],
                    "description": "Default 'load'"
                },
                "timeout_ms": {"type": "integer"}
            },
            "required": ["session_id", "url"]
        })
    }
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let url = params["url"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'url'".into()))?;
        if let Some(blocked) = check_domain_for(
            &self.allowlist_path,
            self.network_mode,
            url,
            "browser.navigate",
        )? {
            return Ok(blocked);
        }
        let timeout = timeout_from_params(&params);
        self.manager.request("page.goto", params, timeout).await
    }
}

// ---------------------------------------------------------------------------
// browser.read
// ---------------------------------------------------------------------------

pub struct BrowserReadPrimitive {
    manager: Arc<BrowserManager>,
}

impl BrowserReadPrimitive {
    pub fn new(manager: Arc<BrowserManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Primitive for BrowserReadPrimitive {
    fn name(&self) -> &str {
        "browser.read"
    }
    fn description(&self) -> &str {
        "Read the current rendered content of a tab. Mode 'markdown' (default) returns clean \
         readability-style markdown plus extracted links and title. Mode 'text' returns plain text. \
         Mode 'html' returns the raw HTML (size-capped). Use this after browser.navigate."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "mode": {"type": "string", "enum": ["markdown", "text", "html"]},
                "max_bytes": {"type": "integer"}
            },
            "required": ["page_id"]
        })
    }
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let mode = params["mode"].as_str().unwrap_or("markdown").to_string();
        let mut sidecar_params = serde_json::json!({
            "page_id": params["page_id"],
        });
        if let Some(b) = params["max_bytes"].as_u64() {
            sidecar_params["max_bytes"] = serde_json::json!(b);
        }
        let raw = self
            .manager
            .request("page.read", sidecar_params, timeout_from_params(&params))
            .await?;
        let html = raw["html"].as_str().unwrap_or("").to_string();
        let title = raw["title"].as_str().unwrap_or("").to_string();
        let final_url = raw["final_url"].as_str().unwrap_or("").to_string();
        let truncated = raw["truncated"].as_bool().unwrap_or(false);
        let byte_length = raw["byte_length"].as_u64().unwrap_or(0);

        match mode.as_str() {
            "html" => Ok(serde_json::json!({
                "title": title,
                "html": html,
                "byte_length": byte_length,
                "truncated": truncated,
                "final_url": final_url,
            })),
            "text" | "markdown" => {
                let (text, links) = html_text::extract_text_and_links(&html, &final_url);
                Ok(serde_json::json!({
                    "title": title,
                    "text": text,
                    "links": links.iter().map(|l| serde_json::json!({"url": l.url, "text": l.text})).collect::<Vec<_>>(),
                    "byte_length": byte_length,
                    "truncated": truncated,
                    "final_url": final_url,
                }))
            }
            _ => Err(PrimitiveError::InvalidParams(format!(
                "unknown mode '{mode}'"
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// browser.screenshot
// ---------------------------------------------------------------------------

pub struct BrowserScreenshotPrimitive {
    manager: Arc<BrowserManager>,
    path_policy: moxxy_core::PathPolicy,
}

impl BrowserScreenshotPrimitive {
    pub fn new(manager: Arc<BrowserManager>, path_policy: moxxy_core::PathPolicy) -> Self {
        Self {
            manager,
            path_policy,
        }
    }
}

#[async_trait]
impl Primitive for BrowserScreenshotPrimitive {
    fn name(&self) -> &str {
        "browser.screenshot"
    }
    fn description(&self) -> &str {
        "Capture a PNG/JPEG screenshot of a tab or a specific element. By default returns base64; \
         pass `save_to` to write the file into the agent workspace and return just the path. \
         `full_page` captures beyond the viewport."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "full_page": {"type": "boolean"},
                "format": {"type": "string", "enum": ["png", "jpeg"]},
                "quality": {"type": "integer"},
                "save_to": {"type": "string", "description": "Workspace-relative path to save into"}
            },
            "required": ["page_id"]
        })
    }
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let mut sidecar_params = params.clone();
        if let Some(rel) = params["save_to"].as_str() {
            // Resolve through path policy so we never escape the workspace.
            let resolved = self.path_policy.resolve_path(Path::new(rel));
            self.path_policy
                .ensure_writable(&resolved)
                .map_err(|e| PrimitiveError::InvalidParams(format!("save_to denied: {e}")))?;
            sidecar_params["save_to_path"] = serde_json::json!(resolved.to_string_lossy());
            sidecar_params.as_object_mut().unwrap().remove("save_to");
        }
        self.manager
            .request(
                "page.screenshot",
                sidecar_params,
                timeout_from_params(&params),
            )
            .await
    }
}

// ---------------------------------------------------------------------------
// browser.extract
// ---------------------------------------------------------------------------

pub struct BrowserExtractPrimitive {
    manager: Arc<BrowserManager>,
}

impl BrowserExtractPrimitive {
    pub fn new(manager: Arc<BrowserManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Primitive for BrowserExtractPrimitive {
    fn name(&self) -> &str {
        "browser.extract"
    }
    fn description(&self) -> &str {
        "Extract structured data from the current rendered page using CSS selectors. \
         Distinct from `browse.extract` which parses raw HTML offline — this one runs \
         on the live page DOM after JS execution."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selectors": {"type": "object", "description": "Map of field name → CSS selector"}
            },
            "required": ["page_id", "selectors"]
        })
    }
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        self.manager.request("page.extract", params, None).await
    }
}

// ---------------------------------------------------------------------------
// browser.wait
// ---------------------------------------------------------------------------

pub struct BrowserWaitPrimitive {
    manager: Arc<BrowserManager>,
}

impl BrowserWaitPrimitive {
    pub fn new(manager: Arc<BrowserManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Primitive for BrowserWaitPrimitive {
    fn name(&self) -> &str {
        "browser.wait"
    }
    fn description(&self) -> &str {
        "Wait for a selector to appear/disappear, for a specific load state, or for a \
         fixed delay. Use selector waits for SPAs that lazy-load content."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "state": {"type": "string", "enum": ["attached", "detached", "visible", "hidden"]},
                "load_state": {"type": "string", "enum": ["load", "domcontentloaded", "networkidle"]},
                "delay_ms": {"type": "integer"},
                "timeout_ms": {"type": "integer"}
            },
            "required": ["page_id"]
        })
    }
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let timeout = timeout_from_params(&params);
        self.manager.request("page.wait_for", params, timeout).await
    }
}

// ---------------------------------------------------------------------------
// browser.eval
// ---------------------------------------------------------------------------

pub struct BrowserEvalPrimitive {
    manager: Arc<BrowserManager>,
}

impl BrowserEvalPrimitive {
    pub fn new(manager: Arc<BrowserManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Primitive for BrowserEvalPrimitive {
    fn name(&self) -> &str {
        "browser.eval"
    }
    fn description(&self) -> &str {
        "Evaluate a JavaScript expression in the page context and return its JSON-serializable \
         value. The expression is wrapped in an async IIFE so you can use await. POWERFUL — \
         only grant this primitive in skills that explicitly need it. Expression length capped \
         at 8 KiB."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "expression": {"type": "string"},
                "timeout_ms": {"type": "integer"}
            },
            "required": ["page_id", "expression"]
        })
    }
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let timeout = timeout_from_params(&params);
        self.manager.request("page.eval", params, timeout).await
    }
}

// ---------------------------------------------------------------------------
// browser.cookies
// ---------------------------------------------------------------------------

pub struct BrowserCookiesPrimitive {
    manager: Arc<BrowserManager>,
}

impl BrowserCookiesPrimitive {
    pub fn new(manager: Arc<BrowserManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Primitive for BrowserCookiesPrimitive {
    fn name(&self) -> &str {
        "browser.cookies"
    }
    fn description(&self) -> &str {
        "Get/set/clear cookies on the page's session context."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "action": {"type": "string", "enum": ["get", "set", "clear"]},
                "cookies": {"type": "array"}
            },
            "required": ["page_id", "action"]
        })
    }
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        self.manager.request("page.cookies", params, None).await
    }
}
