use axum::{
    Json,
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

use super::AppState;

pub async fn require_auth(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    // 1. Internal token bypass (skills calling back)
    if let Some(header) = req.headers().get("x-moxxy-internal-token") {
        if let Ok(val) = header.to_str() {
            if val == state.internal_token {
                return next.run(req).await;
            }
        }
    }

    // 2. Check if any tokens exist across all agents
    let any_tokens_exist = {
        let reg = state.registry.lock().await;
        let mut found = false;
        for mem_mutex in reg.values() {
            let mem = mem_mutex.lock().await;
            if let Ok(true) = mem.has_any_api_tokens().await {
                found = true;
                break;
            }
        }
        found
    };

    // 3. No tokens configured → allow open access only on loopback (safe for local dev)
    if !any_tokens_exist {
        let is_loopback = state.api_host == "127.0.0.1"
            || state.api_host == "::1"
            || state.api_host == "localhost";
        if is_loopback {
            return next.run(req).await;
        }
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": "No API tokens configured. Create a token via the dashboard or API before exposing on a non-loopback address."
            })),
        )
            .into_response();
    }

    // 4. Extract bearer token
    let raw_token = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    let raw_token = match raw_token {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Missing or invalid Authorization header. Use: Bearer <token>" })),
            )
                .into_response();
        }
    };

    // 5. Determine if this is an agent-scoped route
    let path = req.uri().path().to_string();
    let agent_name = extract_agent_from_path(&path);

    let is_valid = {
        let reg = state.registry.lock().await;
        if let Some(agent) = &agent_name {
            // Agent-scoped: validate against that agent's tokens
            if let Some(mem_mutex) = reg.get(agent.as_str()) {
                let mem = mem_mutex.lock().await;
                mem.validate_api_token(&raw_token).await.unwrap_or(false)
            } else {
                false
            }
        } else {
            // Global route: valid if token matches ANY agent
            let mut valid = false;
            for mem_mutex in reg.values() {
                let mem = mem_mutex.lock().await;
                if let Ok(true) = mem.validate_api_token(&raw_token).await {
                    valid = true;
                    break;
                }
            }
            valid
        }
    };

    if is_valid {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or unauthorized API token" })),
        )
            .into_response()
    }
}

/// Extract agent name from paths like `/api/agents/{agent}/...`
fn extract_agent_from_path(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    // Pattern: api / agents / {agent} / ...
    if parts.len() >= 3 && parts[0] == "api" && parts[1] == "agents" {
        Some(parts[2].to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::{
        ContainerRegistry, LlmRegistry, MemoryRegistry, RunMode, ScheduledJobRegistry,
        SchedulerRegistry, SkillRegistry, VaultRegistry,
    };
    use axum::{Router, middleware, response::IntoResponse, routing::get};
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tower::util::ServiceExt;
    use uuid::Uuid;

    async fn test_state(api_host: &str, with_token: bool) -> (AppState, Option<String>) {
        let registry: MemoryRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let token = if with_token {
            let tempdir_path = unique_temp_dir();
            let mem = crate::core::memory::MemorySystem::new(&tempdir_path)
                .await
                .expect("memory should initialize");
            let (raw_token, _) = mem
                .create_api_token("test-token")
                .await
                .expect("api token should be created");
            registry
                .lock()
                .await
                .insert("default".to_string(), Arc::new(Mutex::new(mem)));
            Some(raw_token)
        } else {
            None
        };

        let skill_registry: SkillRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let llm_registry: LlmRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let container_registry: ContainerRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let vault_registry: VaultRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let scheduler_registry: SchedulerRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let scheduled_job_registry: ScheduledJobRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let (log_tx, _) = tokio::sync::broadcast::channel(8);

        (
            AppState {
                registry,
                skill_registry,
                llm_registry,
                container_registry,
                vault_registry,
                scheduler_registry,
                scheduled_job_registry,
                log_tx,
                run_mode: RunMode::Daemon,
                api_host: api_host.to_string(),
                api_port: 17890,
                web_port: 3001,
                internal_token: "internal-123".to_string(),
            },
            token,
        )
    }

    fn unique_temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("moxxy-auth-{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).expect("temp test dir should be created");
        path
    }

    fn protected_app(state: AppState) -> Router {
        Router::new()
            .route(
                "/api/agents/default/ping",
                get(|| async { axum::Json(json!({ "ok": true })).into_response() }),
            )
            .layer(middleware::from_fn_with_state(
                state.clone(),
                super::require_auth,
            ))
            .with_state(state)
    }

    async fn request_ping_status(app: Router, headers: Vec<(&str, String)>) -> StatusCode {
        let mut req_builder = Request::builder().uri("/api/agents/default/ping");
        for (k, v) in headers {
            req_builder = req_builder.header(k, v);
        }
        let req = req_builder
            .body(Body::empty())
            .expect("request should build");
        app.oneshot(req)
            .await
            .expect("oneshot should succeed")
            .status()
    }

    #[test]
    fn extract_agent_from_path_parses_agent_segments() {
        assert_eq!(
            super::extract_agent_from_path("/api/agents/default/chat"),
            Some("default".to_string())
        );
        assert_eq!(super::extract_agent_from_path("/api/providers"), None);
    }

    #[tokio::test]
    async fn no_tokens_on_loopback_allows_request() {
        let (state, _) = test_state("127.0.0.1", false).await;
        let app = protected_app(state);
        let status = request_ping_status(app, vec![]).await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn no_tokens_on_non_loopback_rejects_request() {
        let (state, _) = test_state("0.0.0.0", false).await;
        let app = protected_app(state);
        let status = request_ping_status(app, vec![]).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn token_present_requires_authorization_header() {
        let (state, _) = test_state("127.0.0.1", true).await;
        let app = protected_app(state);
        let status = request_ping_status(app, vec![]).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn valid_bearer_token_is_accepted() {
        let (state, token) = test_state("127.0.0.1", true).await;
        let token = token.expect("token should exist");
        let app = protected_app(state);
        let status =
            request_ping_status(app, vec![("authorization", format!("Bearer {}", token))]).await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn internal_token_header_bypasses_auth() {
        let (state, _) = test_state("127.0.0.1", true).await;
        let app = protected_app(state);
        let status = request_ping_status(
            app,
            vec![("x-moxxy-internal-token", "internal-123".to_string())],
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
}
