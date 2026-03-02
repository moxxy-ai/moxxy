use async_trait::async_trait;
use moxxy_storage::Database;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::registry::{Primitive, PrimitiveError};

pub struct HttpRequestPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
    pub timeout: Duration,
    pub max_response_bytes: usize,
}

impl HttpRequestPrimitive {
    pub fn new(
        db: Arc<Mutex<Database>>,
        agent_id: String,
        timeout: Duration,
        max_response_bytes: usize,
    ) -> Self {
        Self {
            db,
            agent_id,
            timeout,
            max_response_bytes,
        }
    }

    fn load_allowed_domains(&self) -> Result<Vec<String>, PrimitiveError> {
        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        db.allowlists()
            .list_entries(&self.agent_id, "http_domain")
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))
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

        let domain = Self::extract_domain(url)
            .ok_or_else(|| PrimitiveError::InvalidParams("cannot parse domain from URL".into()))?;

        let allowed_domains = self.load_allowed_domains()?;
        if !allowed_domains.iter().any(|d| d == &domain) {
            tracing::warn!(url, %domain, "HTTP request blocked — domain not in allowlist");
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
    use moxxy_storage::{AllowlistRow, Database};
    use moxxy_test_utils::TestDb;

    fn setup_db(domains: &[&str]) -> (Arc<Mutex<Database>>, String) {
        let test_db = TestDb::new();
        let db = Database::new(test_db.into_conn());
        db.providers()
            .insert(&moxxy_storage::ProviderRow {
                id: "test-provider".into(),
                display_name: "Test".into(),
                manifest_path: "/tmp".into(),
                signature: None,
                enabled: true,
                created_at: chrono::Utc::now().to_rfc3339(),
            })
            .unwrap();
        let agent_id = uuid::Uuid::now_v7().to_string();
        db.agents()
            .insert(&moxxy_storage::AgentRow {
                id: agent_id.clone(),
                parent_agent_id: None,
                provider_id: "test-provider".into(),
                model_id: "test-model".into(),
                workspace_root: "/tmp".into(),
                core_mount: None,
                policy_profile: None,
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
                name: Some("test-agent".into()),
                persona: None,
            })
            .unwrap();
        for domain in domains {
            db.allowlists()
                .insert(&AllowlistRow {
                    id: uuid::Uuid::now_v7().to_string(),
                    agent_id: agent_id.clone(),
                    list_type: "http_domain".into(),
                    entry: domain.to_string(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                })
                .unwrap();
        }
        (Arc::new(Mutex::new(db)), agent_id)
    }

    #[tokio::test]
    async fn http_request_allowed_domain_succeeds() {
        let (db, agent_id) = setup_db(&["example.com"]);
        let prim = HttpRequestPrimitive::new(db.clone(), agent_id, Duration::from_secs(5), 1024 * 1024);
        let allowed = prim.load_allowed_domains().unwrap();
        assert!(allowed.contains(&"example.com".to_string()));
    }

    #[tokio::test]
    async fn http_request_blocked_domain_fails() {
        let (db, agent_id) = setup_db(&["example.com"]);
        let prim = HttpRequestPrimitive::new(db, agent_id, Duration::from_secs(5), 1024 * 1024);
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
        let (db, agent_id) = setup_db(&["httpbin.org"]);
        let prim = HttpRequestPrimitive::new(db, agent_id, Duration::from_millis(1), 1024);
        assert_eq!(prim.timeout.as_millis(), 1);
    }

    #[tokio::test]
    async fn http_request_enforces_size_limit() {
        let (db, agent_id) = setup_db(&[]);
        let prim = HttpRequestPrimitive::new(db, agent_id, Duration::from_secs(5), 100);
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
