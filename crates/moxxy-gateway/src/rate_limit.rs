use governor::middleware::StateInformationMiddleware;
use std::fmt;
use std::hash::{Hash, Hasher};
use tower_governor::governor::{GovernorConfig, GovernorConfigBuilder};
use tower_governor::{GovernorError, key_extractor::KeyExtractor};

/// Rate limiting configuration with per-second and burst parameters.
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    pub per_second: u64,
    pub burst_size: u32,
    pub token_per_second: u64,
    pub token_burst_size: u32,
}

impl RateLimitConfig {
    /// Read configuration from environment variables with sensible defaults.
    /// Set MOXXY_RATE_LIMIT_DISABLED=true to use permissive limits (effectively disabled).
    pub fn from_env() -> Self {
        // Allow fully disabling rate limits (useful for local dev / loopback mode)
        let disabled = std::env::var("MOXXY_RATE_LIMIT_DISABLED")
            .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);

        if disabled {
            return Self::permissive();
        }

        Self {
            per_second: std::env::var("MOXXY_RATE_LIMIT_PER_SEC")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(100),
            burst_size: std::env::var("MOXXY_RATE_LIMIT_BURST")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(500),
            token_per_second: std::env::var("MOXXY_RATE_LIMIT_TOKEN_PER_SEC")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(50),
            token_burst_size: std::env::var("MOXXY_RATE_LIMIT_TOKEN_BURST")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(200),
        }
    }

    /// Returns very high limits suitable for tests (avoids spurious 429s).
    pub fn permissive() -> Self {
        Self {
            per_second: 10_000,
            burst_size: 100_000,
            token_per_second: 10_000,
            token_burst_size: 100_000,
        }
    }

    /// Build the GovernorConfig from this configuration using the BearerTokenExtractor.
    pub fn into_governor_config(
        &self,
    ) -> GovernorConfig<BearerTokenExtractor, StateInformationMiddleware> {
        GovernorConfigBuilder::default()
            .key_extractor(BearerTokenExtractor)
            .per_second(self.per_second)
            .burst_size(self.burst_size)
            .use_headers()
            .finish()
            .expect("Invalid rate limit config")
    }
}

/// A key used for rate limiting that can be either a bearer token or a fallback string (IP / anonymous).
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct RateLimitKey(String);

impl Hash for RateLimitKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}

impl fmt::Display for RateLimitKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Check if a peer IP is in the trusted proxies list.
/// Reads from MOXXY_TRUSTED_PROXIES env var (comma-separated IPs).
/// If not set, no proxies are trusted (x-forwarded-for is ignored).
fn is_trusted_proxy(ip: &std::net::IpAddr) -> bool {
    use std::sync::LazyLock;
    static TRUSTED_PROXIES: LazyLock<Vec<std::net::IpAddr>> = LazyLock::new(|| {
        std::env::var("MOXXY_TRUSTED_PROXIES")
            .unwrap_or_default()
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect()
    });
    TRUSTED_PROXIES.contains(ip)
}

/// Extracts rate-limiting keys from incoming requests.
///
/// Priority:
/// 1. Bearer token from the `Authorization` header
/// 2. Peer IP from ConnectInfo (with x-forwarded-for only if peer is a trusted proxy)
/// 3. Falls back to "anonymous"
#[derive(Debug, Clone)]
pub struct BearerTokenExtractor;

impl KeyExtractor for BearerTokenExtractor {
    type Key = RateLimitKey;

    fn extract<T>(&self, req: &axum::http::Request<T>) -> Result<Self::Key, GovernorError> {
        // Try Bearer token first
        if let Some(auth) = req.headers().get("authorization")
            && let Ok(value) = auth.to_str()
            && let Some(token) = value.strip_prefix("Bearer ")
        {
            return Ok(RateLimitKey(format!("token:{token}")));
        }

        // Try peer IP from ConnectInfo
        if let Some(connect_info) = req
            .extensions()
            .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        {
            let peer_ip = connect_info.0.ip();

            // Only trust x-forwarded-for if peer is in trusted proxies list
            if is_trusted_proxy(&peer_ip)
                && let Some(forwarded) = req.headers().get("x-forwarded-for")
                && let Ok(value) = forwarded.to_str()
                && let Some(ip) = value.split(',').next()
            {
                let trimmed = ip.trim();
                if !trimmed.is_empty() {
                    return Ok(RateLimitKey(format!("ip:{trimmed}")));
                }
            }

            return Ok(RateLimitKey(format!("ip:{peer_ip}")));
        }

        // Fallback to anonymous
        Ok(RateLimitKey("anonymous".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create_router;
    use crate::state::AppState;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;

    #[test]
    fn config_from_env_parses_correctly() {
        unsafe {
            std::env::set_var("MOXXY_RATE_LIMIT_PER_SEC", "50");
            std::env::set_var("MOXXY_RATE_LIMIT_BURST", "200");
            std::env::set_var("MOXXY_RATE_LIMIT_TOKEN_PER_SEC", "25");
            std::env::set_var("MOXXY_RATE_LIMIT_TOKEN_BURST", "120");
        }

        let config = RateLimitConfig::from_env();

        assert_eq!(config.per_second, 50);
        assert_eq!(config.burst_size, 200);
        assert_eq!(config.token_per_second, 25);
        assert_eq!(config.token_burst_size, 120);

        unsafe {
            std::env::remove_var("MOXXY_RATE_LIMIT_PER_SEC");
            std::env::remove_var("MOXXY_RATE_LIMIT_BURST");
            std::env::remove_var("MOXXY_RATE_LIMIT_TOKEN_PER_SEC");
            std::env::remove_var("MOXXY_RATE_LIMIT_TOKEN_BURST");
        }
    }

    fn test_app_with_rate_limit(config: RateLimitConfig) -> axum::Router {
        crate::state::register_sqlite_vec();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let state = Arc::new(AppState::new(
            conn,
            [0u8; 32],
            moxxy_types::AuthMode::Token,
            std::path::PathBuf::from("/tmp/moxxy-test"),
            "http://127.0.0.1:3000".into(),
        ));
        create_router(state, Some(config))
    }

    #[tokio::test]
    async fn health_check_not_rate_limited() {
        let config = RateLimitConfig {
            per_second: 1,
            burst_size: 1,
            token_per_second: 1,
            token_burst_size: 1,
        };
        let app = test_app_with_rate_limit(config);

        for _ in 0..200 {
            let req = Request::builder()
                .uri("/v1/health")
                .body(Body::empty())
                .unwrap();
            let resp = app.clone().oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
        }
    }

    #[tokio::test]
    async fn authenticated_endpoint_returns_429() {
        let config = RateLimitConfig {
            per_second: 1,
            burst_size: 2,
            token_per_second: 1,
            token_burst_size: 2,
        };
        let app = test_app_with_rate_limit(config);

        let mut got_429 = false;
        for _ in 0..10 {
            let req = Request::builder()
                .uri("/v1/agents")
                .body(Body::empty())
                .unwrap();
            let resp = app.clone().oneshot(req).await.unwrap();
            if resp.status() == StatusCode::TOO_MANY_REQUESTS {
                got_429 = true;
                break;
            }
        }
        assert!(got_429, "Expected at least one 429 response");
    }

    #[tokio::test]
    async fn rate_limit_headers_present_on_429() {
        let config = RateLimitConfig {
            per_second: 1,
            burst_size: 1,
            token_per_second: 1,
            token_burst_size: 1,
        };
        let app = test_app_with_rate_limit(config);

        // Exhaust the burst
        let req = Request::builder()
            .uri("/v1/agents")
            .body(Body::empty())
            .unwrap();
        let _ = app.clone().oneshot(req).await.unwrap();

        // This should be rate limited
        let req = Request::builder()
            .uri("/v1/agents")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            resp.headers().contains_key("retry-after"),
            "Expected retry-after header on 429 response"
        );
    }
}
