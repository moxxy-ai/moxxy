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
