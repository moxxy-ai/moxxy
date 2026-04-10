//! BFS crawler that drives the Playwright sidecar.
//!
//! Opens an ephemeral session, reuses a single tab across navigations, walks
//! discovered links breadth-first respecting depth/page caps. Replacement for
//! the old `browse.crawl` with configurable limits and JS-rendering support.

use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use moxxy_core::NetworkMode;

use crate::browser::BrowserManager;
use crate::html_text;
use crate::registry::{Primitive, PrimitiveError};

const HARD_MAX_DEPTH: u32 = 10;
const HARD_MAX_PAGES: u32 = 200;
const PER_PAGE_TIMEOUT: Duration = Duration::from_secs(30);

pub struct BrowserCrawlPrimitive {
    manager: Arc<BrowserManager>,
    allowlist_path: PathBuf,
    network_mode: NetworkMode,
}

impl BrowserCrawlPrimitive {
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

    fn is_domain_allowed(&self, host: &str) -> bool {
        if matches!(self.network_mode, NetworkMode::Unsafe) {
            return true;
        }
        let file = moxxy_core::AllowlistFile::load(&self.allowlist_path);
        let allows = file.allows("http_domain");
        let denials = file.denials("http_domain");
        let allowed =
            crate::defaults::merge_with_defaults_and_denials(allows, denials, "http_domain");
        crate::url_policy::is_domain_allowed(host, &allowed)
    }
}

#[async_trait]
impl Primitive for BrowserCrawlPrimitive {
    fn name(&self) -> &str {
        "browser.crawl"
    }

    fn description(&self) -> &str {
        "Crawl a website BFS using a real browser (JS-rendered). Configurable depth and page \
         limits. Returns clean readability text per page. Use this when the target site is \
         JS-heavy; for plain HTML use browse.crawl. Auto-creates and closes its own session."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Starting URL"},
                "max_depth": {"type": "integer", "description": "Default 1, hard cap 10"},
                "max_pages": {"type": "integer", "description": "Default 5, hard cap 200"},
                "same_domain": {"type": "boolean", "description": "Default true"},
                "wait_until": {"type": "string", "enum": ["load", "domcontentloaded", "networkidle"]}
            },
            "required": ["url"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let start_url = params["url"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'url'".into()))?
            .to_string();

        let max_depth = params["max_depth"]
            .as_u64()
            .unwrap_or(1)
            .min(HARD_MAX_DEPTH as u64) as u32;
        let max_pages = params["max_pages"]
            .as_u64()
            .unwrap_or(5)
            .min(HARD_MAX_PAGES as u64) as u32;
        let same_domain = params["same_domain"].as_bool().unwrap_or(true);
        let wait_until = params["wait_until"].as_str().unwrap_or("load").to_string();

        let start_host = crate::url_policy::extract_host(&start_url)
            .ok_or_else(|| PrimitiveError::InvalidParams("cannot parse start URL".into()))?;

        if !self.is_domain_allowed(&start_host) {
            return Ok(serde_json::json!({
                "status": "domain_not_allowed",
                "domain": start_host,
                "url": start_url,
                "action_required": format!(
                    "Domain '{}' is not in the allowlist. \
                     Use `user.ask` to ask the user whether to allow access to this domain. \
                     If approved, call `allowlist.add` with list_type \"http_domain\" and \
                     entry \"{}\" to add it, then retry browser.crawl.",
                    start_host, start_host
                )
            }));
        }

        // Open an ephemeral session for the crawl. We always close it afterwards
        // (best-effort) to avoid leaking BrowserContexts.
        let session = self
            .manager
            .request("session.create", serde_json::json!({}), None)
            .await?;
        let session_id = session["session_id"]
            .as_str()
            .ok_or_else(|| {
                PrimitiveError::ExecutionFailed("session.create missing session_id".into())
            })?
            .to_string();

        let result = self
            .crawl_inner(
                &session_id,
                &start_url,
                &start_host,
                max_depth,
                max_pages,
                same_domain,
                &wait_until,
            )
            .await;

        // Best-effort close.
        let _ = self
            .manager
            .request(
                "session.close",
                serde_json::json!({ "session_id": session_id }),
                None,
            )
            .await;

        result
    }
}

impl BrowserCrawlPrimitive {
    #[allow(clippy::too_many_arguments)]
    async fn crawl_inner(
        &self,
        session_id: &str,
        start_url: &str,
        start_host: &str,
        max_depth: u32,
        max_pages: u32,
        same_domain: bool,
        wait_until: &str,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let mut visited: HashSet<String> = HashSet::new();
        let mut queue: VecDeque<(String, u32)> = VecDeque::new();
        let mut pages_out: Vec<serde_json::Value> = Vec::new();
        let mut page_id: Option<String> = None;

        queue.push_back((start_url.to_string(), 0));

        while let Some((url, depth)) = queue.pop_front() {
            if pages_out.len() >= max_pages as usize {
                break;
            }
            let normalised = normalise_url(&url);
            if !visited.insert(normalised) {
                continue;
            }
            let Some(host) = crate::url_policy::extract_host(&url) else {
                continue;
            };
            if same_domain && host != start_host {
                continue;
            }
            if !self.is_domain_allowed(&host) {
                continue;
            }

            // Navigate (reusing the single tab when possible).
            let mut goto_params = serde_json::json!({
                "session_id": session_id,
                "url": url,
                "wait_until": wait_until,
            });
            if let Some(pid) = &page_id {
                goto_params["page_id"] = serde_json::json!(pid);
            }
            let goto = match self
                .manager
                .request("page.goto", goto_params, Some(PER_PAGE_TIMEOUT))
                .await
            {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(url = %url, error = %e, "crawl navigate failed, skipping");
                    continue;
                }
            };
            if page_id.is_none() {
                page_id = goto["page_id"].as_str().map(|s| s.to_string());
            }
            let status = goto["status"].as_u64();

            // Read content.
            let read = match self
                .manager
                .request(
                    "page.read",
                    serde_json::json!({ "page_id": page_id }),
                    Some(PER_PAGE_TIMEOUT),
                )
                .await
            {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(url = %url, error = %e, "crawl read failed, skipping");
                    continue;
                }
            };
            let html = read["html"].as_str().unwrap_or("").to_string();
            let title = read["title"].as_str().unwrap_or("").to_string();
            let final_url = read["final_url"].as_str().unwrap_or(&url).to_string();
            let (text, links) = html_text::extract_text_and_links(&html, &final_url);

            pages_out.push(serde_json::json!({
                "url": url,
                "final_url": final_url,
                "status": status,
                "depth": depth,
                "title": title,
                "text": text,
                "links_found": links.len(),
            }));

            if depth < max_depth {
                for link in &links {
                    let n = normalise_url(&link.url);
                    if !visited.contains(&n) {
                        queue.push_back((link.url.clone(), depth + 1));
                    }
                }
            }
        }

        Ok(serde_json::json!({
            "pages_crawled": pages_out.len(),
            "pages": pages_out,
        }))
    }
}

fn normalise_url(raw: &str) -> String {
    match url::Url::parse(raw) {
        Ok(mut u) => {
            u.set_fragment(None);
            let mut s = u.to_string();
            if s.ends_with('/') && s.len() > 1 {
                s.pop();
            }
            s
        }
        Err(_) => raw.to_string(),
    }
}
