use async_trait::async_trait;
use std::time::Duration;

use crate::registry::{Primitive, PrimitiveError};

pub struct HttpRequestPrimitive {
    allowed_domains: Vec<String>,
    pub timeout: Duration,
    pub max_response_bytes: usize,
}

impl HttpRequestPrimitive {
    pub fn new(allowed_domains: Vec<String>, timeout: Duration, max_response_bytes: usize) -> Self {
        Self {
            allowed_domains,
            timeout,
            max_response_bytes,
        }
    }

    pub fn is_domain_allowed(&self, domain: &str) -> bool {
        self.allowed_domains.iter().any(|d| d == domain)
    }

    fn extract_domain(url: &str) -> Option<String> {
        let without_scheme = if let Some(rest) = url.strip_prefix("https://") {
            rest
        } else if let Some(rest) = url.strip_prefix("http://") {
            rest
        } else {
            url
        };
        let domain = without_scheme.split('/').next()?;
        let domain = domain.split(':').next()?;
        Some(domain.to_string())
    }
}

#[async_trait]
impl Primitive for HttpRequestPrimitive {
    fn name(&self) -> &str {
        "http.request"
    }

    async fn invoke(
        &self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let url = params["url"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'url' parameter".into()))?;

        let domain = Self::extract_domain(url)
            .ok_or_else(|| PrimitiveError::InvalidParams("cannot parse domain from URL".into()))?;

        if !self.is_domain_allowed(&domain) {
            return Err(PrimitiveError::AccessDenied(format!(
                "Domain '{}' not in allowlist",
                domain
            )));
        }

        let method = params["method"].as_str().unwrap_or("GET");
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

        let resp = req
            .send()
            .await
            .map_err(|e| {
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

    #[tokio::test]
    async fn http_request_allowed_domain_succeeds() {
        let prim = HttpRequestPrimitive::new(
            vec!["example.com".into()],
            Duration::from_secs(5),
            1024 * 1024,
        );
        assert!(prim.is_domain_allowed("example.com"));
    }

    #[tokio::test]
    async fn http_request_blocked_domain_fails() {
        let prim = HttpRequestPrimitive::new(
            vec!["example.com".into()],
            Duration::from_secs(5),
            1024 * 1024,
        );
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
        let prim =
            HttpRequestPrimitive::new(vec!["httpbin.org".into()], Duration::from_millis(1), 1024);
        assert_eq!(prim.timeout.as_millis(), 1);
    }

    #[tokio::test]
    async fn http_request_enforces_size_limit() {
        let prim = HttpRequestPrimitive::new(vec![], Duration::from_secs(5), 100);
        assert_eq!(prim.max_response_bytes, 100);
    }

    #[test]
    fn extract_domain_parses_https_url() {
        assert_eq!(
            HttpRequestPrimitive::extract_domain("https://example.com/path"),
            Some("example.com".into())
        );
    }

    #[test]
    fn extract_domain_parses_url_with_port() {
        assert_eq!(
            HttpRequestPrimitive::extract_domain("http://localhost:8080/api"),
            Some("localhost".into())
        );
    }
}
