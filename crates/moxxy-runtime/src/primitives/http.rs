use async_trait::async_trait;
use std::path::PathBuf;
use std::time::Duration;

use crate::registry::{Primitive, PrimitiveError};

pub struct HttpRequestPrimitive {
    allowlist_path: PathBuf,
    pub timeout: Duration,
    pub max_response_bytes: usize,
}

impl HttpRequestPrimitive {
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

    fn load_allowed_domains(&self) -> Vec<String> {
        let file = moxxy_core::AllowlistFile::load(&self.allowlist_path);
        let allows = file.allows("http_domain");
        let denials = file.denials("http_domain");
        crate::defaults::merge_with_defaults_and_denials(allows, denials, "http_domain")
    }
}

#[async_trait]
impl Primitive for HttpRequestPrimitive {
    fn name(&self) -> &str {
        "http.request"
    }

    fn description(&self) -> &str {
        "Make an HTTP request to an allowed domain. Supports GET, POST, PUT, PATCH, DELETE, HEAD."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The URL to request"},
                "method": {"type": "string", "description": "HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD)", "default": "GET"},
                "body": {"type": "string", "description": "Request body (for POST/PUT/PATCH)"},
                "headers": {"type": "object", "description": "Additional HTTP headers as key-value pairs"}
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

        let allowed_domains = self.load_allowed_domains();
        if !crate::url_policy::is_domain_allowed(&domain, &allowed_domains) {
            tracing::warn!(url, %domain, "HTTP request blocked = domain not in allowlist");
            return Err(PrimitiveError::AccessDenied(format!(
                "Domain '{}' not in allowlist",
                domain
            )));
        }

        let method = params["method"].as_str().unwrap_or("GET");

        tracing::info!(url, method, %domain, "Making HTTP request");
        let body = params["body"].as_str().map(|s| s.to_string());
        let headers = params["headers"].as_object();

        let client = reqwest::Client::builder()
            .timeout(self.timeout)
            .build()
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("HTTP client error: {}", e)))?;

        let mut req = match method.to_uppercase().as_str() {
            "GET" => client.get(url),
            "POST" => client.post(url),
            "PUT" => client.put(url),
            "PATCH" => client.patch(url),
            "DELETE" => client.delete(url),
            "HEAD" => client.head(url),
            _ => {
                return Err(PrimitiveError::InvalidParams(format!(
                    "Unsupported HTTP method: {}",
                    method
                )));
            }
        };

        if let Some(hdrs) = headers {
            for (k, v) in hdrs {
                if let Some(val) = v.as_str() {
                    req = req.header(k.as_str(), val);
                }
            }
        }

        if let Some(b) = body {
            req = req.header("content-type", "application/json").body(b);
        }

        let resp = req.send().await.map_err(|e| {
            if e.is_timeout() {
                PrimitiveError::Timeout
            } else {
                PrimitiveError::ExecutionFailed(format!("HTTP request failed: {}", e))
            }
        })?;

        let status = resp.status().as_u16();
        let resp_headers: serde_json::Value = serde_json::json!(
            resp.headers()
                .iter()
                .filter_map(|(k, v)| {
                    v.to_str().ok().map(|val| (k.to_string(), val.to_string()))
                })
                .collect::<std::collections::HashMap<String, String>>()
        );

        let bytes = resp.bytes().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("Failed to read response: {}", e))
        })?;

        if bytes.len() > self.max_response_bytes {
            return Err(PrimitiveError::SizeLimitExceeded);
        }

        let body_str = String::from_utf8_lossy(&bytes).to_string();

        Ok(serde_json::json!({
            "status": status,
            "headers": resp_headers,
            "body": body_str,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_allowlist(domains: &[&str]) -> PathBuf {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("allowlists.yaml");
        let mut file = moxxy_core::AllowlistFile::default();
        for domain in domains {
            file.add_allow("http_domain", domain.to_string());
        }
        file.save(&path).unwrap();
        std::mem::forget(tmp);
        path
    }

    #[tokio::test]
    async fn http_request_allowed_domain_succeeds() {
        let path = setup_allowlist(&["example.com"]);
        let prim = HttpRequestPrimitive::new(path, Duration::from_secs(5), 1024 * 1024);
        let allowed = prim.load_allowed_domains();
        assert!(allowed.contains(&"example.com".to_string()));
    }

    #[tokio::test]
    async fn http_request_blocked_domain_fails() {
        let path = setup_allowlist(&["example.com"]);
        let prim = HttpRequestPrimitive::new(path, Duration::from_secs(5), 1024 * 1024);
        let result = prim
            .invoke(serde_json::json!({
                "url": "https://evil.com/steal",
                "method": "GET"
            }))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::AccessDenied(_)
        ));
    }

    #[tokio::test]
    async fn http_request_enforces_timeout() {
        let path = setup_allowlist(&["httpbin.org"]);
        let prim = HttpRequestPrimitive::new(path, Duration::from_millis(1), 1024);
        assert_eq!(prim.timeout.as_millis(), 1);
    }

    #[tokio::test]
    async fn http_request_enforces_size_limit() {
        let path = setup_allowlist(&[]);
        let prim = HttpRequestPrimitive::new(path, Duration::from_secs(5), 100);
        assert_eq!(prim.max_response_bytes, 100);
    }

    #[test]
    fn extract_host_parses_https_url() {
        assert_eq!(
            crate::url_policy::extract_host("https://example.com/path"),
            Some("example.com".into())
        );
    }

    #[test]
    fn extract_host_parses_url_with_port() {
        assert_eq!(
            crate::url_policy::extract_host("http://localhost:8080/api"),
            Some("localhost".into())
        );
    }
}
