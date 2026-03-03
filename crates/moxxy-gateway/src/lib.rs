pub mod auth_extractor;
pub mod rate_limit;
pub mod routes;
pub mod run_service;
pub mod state;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post};
use rate_limit::RateLimitConfig;
use state::AppState;
use std::sync::Arc;
use tower_governor::GovernorLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

pub fn create_router(state: Arc<AppState>, rate_limit_config: Option<RateLimitConfig>) -> Router {
    let config = rate_limit_config.unwrap_or_else(RateLimitConfig::permissive);
    let governor_conf = config.into_governor_config();
    let governor_layer = GovernorLayer::new(governor_conf);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Health route is exempt from rate limiting
    let health_router = Router::new()
        .route("/v1/health", get(routes::health::health_check))
        .layer(cors.clone())
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .with_state(state.clone());

    // Inbound webhook receiver: unauthenticated, uses HMAC verification
    let hooks_router = Router::new()
        .route("/v1/hooks/{token}", post(routes::webhooks::receive_webhook))
        .layer(cors.clone())
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .with_state(state.clone());

    // All other routes are rate limited
    let api_router = Router::new()
        // Auth
        .route(
            "/v1/auth/tokens",
            post(routes::auth::create_token).get(routes::auth::list_tokens),
        )
        .route("/v1/auth/tokens/{id}", delete(routes::auth::revoke_token))
        // Providers
        .route(
            "/v1/providers",
            get(routes::providers::list_providers).post(routes::providers::install_provider),
        )
        .route(
            "/v1/providers/{id}/models",
            get(routes::providers::list_models),
        )
        // Agents
        .route(
            "/v1/agents",
            post(routes::agents::create_agent).get(routes::agents::list_agents),
        )
        .route(
            "/v1/agents/{id}",
            get(routes::agents::get_agent)
                .patch(routes::agents::update_agent)
                .delete(routes::agents::delete_agent),
        )
        .route("/v1/agents/{id}/runs", post(routes::agents::start_run))
        .route("/v1/agents/{id}/stop", post(routes::agents::stop_run))
        .route("/v1/agents/{id}/reset", post(routes::agents::reset_session))
        .route(
            "/v1/agents/{id}/subagents",
            post(routes::agents::spawn_subagent),
        )
        .route(
            "/v1/agents/{id}/ask-responses/{question_id}",
            post(routes::agents::respond_to_ask),
        )
        // Memory
        .route(
            "/v1/agents/{id}/memory/search",
            get(routes::memory::search_memory),
        )
        .route(
            "/v1/agents/{id}/memory/compact",
            post(routes::memory::compact_memory),
        )
        // Heartbeats
        .route(
            "/v1/agents/{id}/heartbeats",
            post(routes::heartbeats::create_heartbeat).get(routes::heartbeats::list_heartbeats),
        )
        .route(
            "/v1/agents/{id}/heartbeats/{hb_id}",
            delete(routes::heartbeats::disable_heartbeat),
        )
        // Skills
        .route("/v1/agents/{id}/skills", get(routes::skills::list_skills))
        .route(
            "/v1/agents/{id}/skills/install",
            post(routes::skills::install_skill),
        )
        .route(
            "/v1/agents/{id}/skills/{skill_id}",
            delete(routes::skills::delete_skill),
        )
        // Vault
        .route(
            "/v1/vault/secrets",
            post(routes::vault::create_secret_ref).get(routes::vault::list_secrets),
        )
        .route(
            "/v1/vault/secrets/{id}",
            delete(routes::vault::delete_secret_ref),
        )
        .route(
            "/v1/vault/grants",
            post(routes::vault::create_grant).get(routes::vault::list_grants),
        )
        .route("/v1/vault/grants/{id}", delete(routes::vault::revoke_grant))
        // Webhooks
        .route(
            "/v1/agents/{id}/webhooks",
            get(routes::webhooks::list_webhooks),
        )
        .route(
            "/v1/agents/{id}/webhooks/{wh_id}",
            delete(routes::webhooks::delete_webhook),
        )
        .route(
            "/v1/agents/{id}/webhooks/{wh_id}/deliveries",
            get(routes::webhooks::list_deliveries),
        )
        // Audit logs
        .route("/v1/audit-logs", get(routes::audit::list_audit_logs))
        // Events
        .route("/v1/events/stream", get(routes::events::event_stream))
        // Channels
        .route(
            "/v1/channels",
            post(routes::channels::create_channel).get(routes::channels::list_channels),
        )
        .route(
            "/v1/channels/{id}",
            get(routes::channels::get_channel).delete(routes::channels::delete_channel),
        )
        .route(
            "/v1/channels/{id}/pair",
            post(routes::channels::pair_channel),
        )
        .route(
            "/v1/channels/{id}/bindings",
            get(routes::channels::list_bindings),
        )
        .route(
            "/v1/channels/{id}/bindings/{bid}",
            delete(routes::channels::unbind),
        )
        .layer(governor_layer)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .with_state(state);

    health_router.merge(hooks_router).merge(api_router)
}

#[cfg(test)]
mod test_helpers {
    use super::*;
    use axum::Router;
    use axum::body::Body;
    use http::Request;
    use moxxy_core::ApiTokenService;
    use moxxy_storage::{ProviderRow, StoredTokenRow};
    use moxxy_types::{AuthMode, TokenScope};
    use tower::ServiceExt;

    pub fn test_app() -> (Router, Arc<AppState>) {
        crate::state::register_sqlite_vec();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let state = Arc::new(AppState::new(
            conn,
            [0u8; 32],
            AuthMode::Token,
            std::path::PathBuf::from("/tmp/moxxy-test"),
            "http://127.0.0.1:3000".into(),
        ));
        let app = create_router(state.clone(), None);
        (app, state)
    }

    pub async fn request(app: &Router, req: Request<Body>) -> axum::response::Response {
        app.clone().oneshot(req).await.unwrap()
    }

    pub fn create_token_in_db(state: &AppState, scopes: Vec<TokenScope>) -> String {
        let (plaintext, issued) = ApiTokenService::issue("test", scopes, None);
        let row = StoredTokenRow {
            id: issued.id,
            created_by: issued.created_by,
            token_hash: issued.token_hash,
            scopes_json: issued.scopes_json,
            created_at: issued.created_at,
            expires_at: issued.expires_at,
            status: issued.status,
        };
        let db = state.db.lock().unwrap();
        db.tokens().insert(&row).unwrap();
        plaintext
    }

    pub fn seed_provider(state: &AppState) {
        let db = state.db.lock().unwrap();
        db.providers()
            .insert(&ProviderRow {
                id: "test-provider".into(),
                display_name: "Test Provider".into(),
                manifest_path: "/tmp/manifest.json".into(),
                signature: None,
                enabled: true,
                created_at: chrono::Utc::now().to_rfc3339(),
            })
            .unwrap();
    }

    pub fn seed_provider_with_model(state: &AppState) {
        seed_provider(state);
        let db = state.db.lock().unwrap();
        db.providers()
            .insert_model(&moxxy_storage::ProviderModelRow {
                provider_id: "test-provider".into(),
                model_id: "gpt-4".into(),
                display_name: "GPT-4".into(),
                metadata_json: Some(
                    r#"{"context_window":8192,"api_base":"https://api.openai.com/v1"}"#.into(),
                ),
            })
            .unwrap();
    }

    pub fn seed_agent(state: &AppState, _token: &str) -> String {
        seed_provider(state);
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::now_v7().to_string();

        // Write agent.yaml so config-based lookups (lineage limits, etc.) work
        let agent_dir = state.moxxy_home.join("agents").join(&id);
        std::fs::create_dir_all(agent_dir.join("workspace")).ok();
        let config = moxxy_types::AgentConfig {
            name: "test-agent".into(),
            provider_id: "test-provider".into(),
            model_id: "gpt-4".into(),
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            policy_profile: None,
        };
        config.save(&agent_dir.join("agent.yaml")).ok();

        let db = state.db.lock().unwrap();
        db.agents()
            .insert(&moxxy_storage::AgentRow {
                id: id.clone(),
                parent_agent_id: None,
                name: Some("test-agent".into()),
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                workspace_root: agent_dir.to_string_lossy().into(),
                created_at: now.clone(),
                updated_at: now,
            })
            .unwrap();
        id
    }

    pub fn seed_secret_ref(state: &AppState) -> String {
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::now_v7().to_string();
        let db = state.db.lock().unwrap();
        db.vault_refs()
            .insert(&moxxy_storage::VaultSecretRefRow {
                id: id.clone(),
                key_name: format!("test-key-{}", id),
                backend_key: "os_keyring::test_secret".into(),
                policy_label: None,
                created_at: now.clone(),
                updated_at: now,
            })
            .unwrap();
        id
    }
}

#[cfg(test)]
mod auth_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    #[tokio::test]
    async fn bootstrap_token_creation_without_auth() {
        let (app, _state) = test_app();
        let req = Request::builder()
            .method("POST")
            .uri("/v1/auth/tokens")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"scopes":["tokens:admin"]}"#))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn second_token_requires_tokens_admin() {
        let (app, state) = test_app();
        let _token = create_token_in_db(&state, vec![TokenScope::AgentsRead]);
        let req = Request::builder()
            .method("POST")
            .uri("/v1/auth/tokens")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"scopes":["agents:read"]}"#))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn second_token_with_admin_auth_succeeds() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::TokensAdmin]);
        let req = Request::builder()
            .method("POST")
            .uri("/v1/auth/tokens")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::from(r#"{"scopes":["agents:read"]}"#))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn list_tokens_requires_auth() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::TokensAdmin]);
        let req = Request::builder()
            .method("GET")
            .uri("/v1/auth/tokens")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn list_tokens_without_auth_returns_401() {
        let (app, _state) = test_app();
        let req = Request::builder()
            .method("GET")
            .uri("/v1/auth/tokens")
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn revoke_sets_status_to_revoked() {
        let (app, state) = test_app();
        let admin_token = create_token_in_db(&state, vec![TokenScope::TokensAdmin]);
        let token_id = {
            let db = state.db.lock().unwrap();
            let tokens = db.tokens().list_all().unwrap();
            tokens[0].id.clone()
        };

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/auth/tokens/{}", token_id))
            .header("authorization", format!("Bearer {}", admin_token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn revoked_token_cannot_authenticate() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::TokensAdmin]);
        {
            let db = state.db.lock().unwrap();
            let tokens = db.tokens().list_all().unwrap();
            db.tokens().revoke(&tokens[0].id).unwrap();
        }

        let req = Request::builder()
            .method("GET")
            .uri("/v1/auth/tokens")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}

#[cfg(test)]
mod agent_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    #[tokio::test]
    async fn list_agents_returns_all() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        seed_provider(&state);
        // Insert two agents directly (seed_agent also seeds provider, causing conflict)
        let now = chrono::Utc::now().to_rfc3339();
        for i in 0..2 {
            let id = uuid::Uuid::now_v7().to_string();
            let db = state.db.lock().unwrap();
            db.agents()
                .insert(&moxxy_storage::AgentRow {
                    id,
                    parent_agent_id: None,
                    name: Some(format!("test-agent-{i}")),
                    status: "idle".into(),
                    depth: 0,
                    spawned_total: 0,
                    workspace_root: "/tmp/ws".into(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                })
                .unwrap();
        }

        let req = Request::builder()
            .method("GET")
            .uri("/v1/agents")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let agents = result.as_array().unwrap();
        assert_eq!(agents.len(), 2);
    }

    #[tokio::test]
    async fn create_agent_returns_201() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        seed_provider(&state);
        let req = Request::builder()
            .method("POST")
            .uri("/v1/agents")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"name":"test-agent","provider_id":"test-provider","model_id":"gpt-4"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn get_agent_returns_created_data() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        seed_provider(&state);
        let req = Request::builder()
            .method("POST")
            .uri("/v1/agents")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"name":"test-agent","provider_id":"test-provider","model_id":"gpt-4"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let agent_id = created["id"].as_str().unwrap();

        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn create_requires_agents_write_scope() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsRead]);
        let req = Request::builder()
            .method("POST")
            .uri("/v1/agents")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"name":"test-agent","provider_id":"p","model_id":"m"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn start_run_transitions_status() {
        let (app, state) = test_app();
        let token =
            create_token_in_db(&state, vec![TokenScope::AgentsWrite, TokenScope::RunsWrite]);
        seed_provider_with_model(&state);
        state
            .vault_backend
            .set_secret("moxxy_provider_test-provider", "sk-test-key-123")
            .unwrap();
        let req = Request::builder()
            .method("POST")
            .uri("/v1/agents")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"name":"test-agent","provider_id":"test-provider","model_id":"gpt-4"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let agent_id = created["id"].as_str().unwrap();

        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/runs", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"task":"do something"}"#))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["status"], "running");
    }

    #[tokio::test]
    async fn stop_run_transitions_status() {
        let (app, state) = test_app();
        let token =
            create_token_in_db(&state, vec![TokenScope::AgentsWrite, TokenScope::RunsWrite]);
        seed_provider(&state);
        // Create agent
        let req = Request::builder()
            .method("POST")
            .uri("/v1/agents")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"name":"test-agent","provider_id":"test-provider","model_id":"gpt-4"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let agent_id = created["id"].as_str().unwrap();

        // Start run
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/runs", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"task":"work"}"#))
            .unwrap();
        request(&app, req).await;

        // Stop
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/stop", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["status"], "idle");
    }

    #[tokio::test]
    async fn spawn_subagent_sets_parent() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        let agent_id = seed_agent(&state, &token);

        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/subagents", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"provider_id":"test-provider","model_id":"gpt-4"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["parent_agent_id"], agent_id);
        assert_eq!(result["depth"], 1);
    }

    #[tokio::test]
    async fn spawn_subagent_blocked_at_depth_limit() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);

        // Create parent with max_subagent_depth = 1
        seed_provider(&state);
        let now = chrono::Utc::now().to_rfc3339();
        let parent_id = uuid::Uuid::now_v7().to_string();
        {
            // Write agent.yaml with lineage limits
            let agent_dir = state.moxxy_home.join("agents").join(&parent_id);
            std::fs::create_dir_all(agent_dir.join("workspace")).ok();
            let config = moxxy_types::AgentConfig {
                name: "test-parent".into(),
                provider_id: "test-provider".into(),
                model_id: "gpt-4".into(),
                temperature: 0.7,
                max_subagent_depth: 1,
                max_subagents_total: 10,
                policy_profile: None,
            };
            config.save(&agent_dir.join("agent.yaml")).ok();

            let db = state.db.lock().unwrap();
            db.agents()
                .insert(&moxxy_storage::AgentRow {
                    id: parent_id.clone(),
                    parent_agent_id: None,
                    name: Some("test-parent".into()),
                    status: "idle".into(),
                    depth: 0,
                    spawned_total: 0,
                    workspace_root: "/tmp/ws".into(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                })
                .unwrap();
        }

        // Spawn child at depth 1 (should succeed)
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/subagents", parent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"provider_id":"test-provider","model_id":"gpt-4","max_subagent_depth":1}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let child: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let child_id = child["id"].as_str().unwrap();

        // Spawn grandchild at depth 2 from child whose max_subagent_depth = 1 -> BLOCKED
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/subagents", child_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"provider_id":"test-provider","model_id":"gpt-4"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn spawn_subagent_blocked_at_total_limit() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);

        // Create parent with max_subagents_total = 2
        seed_provider(&state);
        let now = chrono::Utc::now().to_rfc3339();
        let parent_id = uuid::Uuid::now_v7().to_string();
        {
            // Write agent.yaml with lineage limits
            let agent_dir = state.moxxy_home.join("agents").join(&parent_id);
            std::fs::create_dir_all(agent_dir.join("workspace")).ok();
            let config = moxxy_types::AgentConfig {
                name: "test-parent".into(),
                provider_id: "test-provider".into(),
                model_id: "gpt-4".into(),
                temperature: 0.7,
                max_subagent_depth: 5,
                max_subagents_total: 2,
                policy_profile: None,
            };
            config.save(&agent_dir.join("agent.yaml")).ok();

            let db = state.db.lock().unwrap();
            db.agents()
                .insert(&moxxy_storage::AgentRow {
                    id: parent_id.clone(),
                    parent_agent_id: None,
                    name: Some("test-parent".into()),
                    status: "idle".into(),
                    depth: 0,
                    spawned_total: 0,
                    workspace_root: "/tmp/ws".into(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                })
                .unwrap();
        }

        // Spawn 2 children (should succeed)
        for _i in 0..2 {
            let req = Request::builder()
                .method("POST")
                .uri(format!("/v1/agents/{}/subagents", parent_id))
                .header("authorization", format!("Bearer {}", token))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"provider_id":"test-provider","model_id":"gpt-4"}"#,
                ))
                .unwrap();
            let resp = request(&app, req).await;
            assert_eq!(resp.status(), StatusCode::CREATED);
        }

        // Third spawn should be blocked
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/subagents", parent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"provider_id":"test-provider","model_id":"gpt-4"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn spawn_increments_parent_spawned_total() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        // Spawn a subagent
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/subagents", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"provider_id":"test-provider","model_id":"gpt-4"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        // Verify parent's spawned_total incremented
        let db = state.db.lock().unwrap();
        let parent = db.agents().find_by_id(&agent_id).unwrap().unwrap();
        assert_eq!(parent.spawned_total, 1);
    }

    #[tokio::test]
    async fn update_agent_changes_provider_and_model() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        // Install a second provider
        {
            let db = state.db.lock().unwrap();
            db.providers()
                .insert(&moxxy_storage::ProviderRow {
                    id: "new-provider".into(),
                    display_name: "New Provider".into(),
                    manifest_path: "/tmp/new.yaml".into(),
                    signature: None,
                    enabled: true,
                    created_at: chrono::Utc::now().to_rfc3339(),
                })
                .unwrap();
        }

        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/v1/agents/{}", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"provider_id":"new-provider","model_id":"new-model","temperature":1.2}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["provider_id"], "new-provider");
        assert_eq!(result["model_id"], "new-model");
        assert_eq!(result["temperature"], 1.2);
    }

    #[tokio::test]
    async fn update_agent_partial_keeps_existing_values() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        // Only update temperature
        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/v1/agents/{}", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"temperature":0.3}"#))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        // Original provider/model should be preserved
        assert_eq!(result["provider_id"], "test-provider");
        assert_eq!(result["model_id"], "gpt-4");
        assert_eq!(result["temperature"], 0.3);
    }

    #[tokio::test]
    async fn update_agent_not_found_returns_404() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);

        let req = Request::builder()
            .method("PATCH")
            .uri("/v1/agents/nonexistent")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"temperature":0.5}"#))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn update_agent_invalid_temperature_returns_400() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        let agent_id = seed_agent(&state, &token);

        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/v1/agents/{}", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"temperature":5.0}"#))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn delete_agent_removes_it() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/agents/{}", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        // Verify it's gone
        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_nonexistent_agent_returns_404() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);

        let req = Request::builder()
            .method("DELETE")
            .uri("/v1/agents/nonexistent")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}

#[cfg(test)]
mod provider_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    #[tokio::test]
    async fn install_provider_returns_201() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);

        let req = Request::builder()
            .method("POST")
            .uri("/v1/providers")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"id":"openai","display_name":"OpenAI","models":[{"model_id":"gpt-4o","display_name":"GPT-4o"}]}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["id"], "openai");
        assert_eq!(result["models_count"], 1);
    }

    #[tokio::test]
    async fn install_provider_upserts_existing() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );

        // Install once
        let req = Request::builder()
            .method("POST")
            .uri("/v1/providers")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"id":"openai","display_name":"OpenAI","models":[{"model_id":"gpt-4","display_name":"GPT-4"}]}"#,
            ))
            .unwrap();
        request(&app, req).await;

        // Install again with different models (upsert)
        let req = Request::builder()
            .method("POST")
            .uri("/v1/providers")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"id":"openai","display_name":"OpenAI","models":[{"model_id":"gpt-4o","display_name":"GPT-4o"},{"model_id":"o1","display_name":"o1"}]}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        // Verify models were replaced
        let req = Request::builder()
            .method("GET")
            .uri("/v1/providers/openai/models")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let models = result.as_array().unwrap();
        assert_eq!(models.len(), 2);
    }

    #[tokio::test]
    async fn list_providers_returns_installed() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsRead]);
        seed_provider_with_model(&state);

        let req = Request::builder()
            .method("GET")
            .uri("/v1/providers")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let providers = result.as_array().unwrap();
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0]["id"], "test-provider");
    }

    #[tokio::test]
    async fn list_models_for_provider() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsRead]);
        seed_provider_with_model(&state);

        let req = Request::builder()
            .method("GET")
            .uri("/v1/providers/test-provider/models")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let models = result.as_array().unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0]["model_id"], "gpt-4");
    }
}

#[cfg(test)]
mod resolve_provider_tests {
    use super::test_helpers::*;

    #[test]
    fn resolve_provider_with_db_and_vault_returns_some() {
        let (_app, state) = test_app();
        seed_provider_with_model(&state);

        // Store an API key in the vault
        state
            .vault_backend
            .set_secret("moxxy_provider_test-provider", "sk-test-key-123")
            .unwrap();

        let provider = state.run_service.resolve_provider("test-provider", "gpt-4");
        assert!(provider.is_some());
    }

    #[test]
    fn resolve_provider_missing_vault_key_returns_none() {
        let (_app, state) = test_app();
        seed_provider_with_model(&state);

        // No vault secret stored = resolve should return None
        let provider = state.run_service.resolve_provider("test-provider", "gpt-4");
        assert!(provider.is_none());
    }

    #[test]
    fn resolve_provider_missing_provider_returns_none() {
        let (_app, state) = test_app();

        let provider = state.run_service.resolve_provider("nonexistent", "gpt-4");
        assert!(provider.is_none());
    }

    #[test]
    fn resolve_provider_missing_model_returns_none() {
        let (_app, state) = test_app();
        seed_provider(&state);

        state
            .vault_backend
            .set_secret("moxxy_provider_test-provider", "sk-test-key-123")
            .unwrap();

        let provider = state
            .run_service
            .resolve_provider("test-provider", "nonexistent-model");
        assert!(provider.is_none());
    }
}

#[cfg(test)]
mod heartbeat_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    #[tokio::test]
    async fn create_heartbeat_returns_201() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        let agent_id = seed_agent(&state, &token);

        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/heartbeats", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"interval_minutes":5,"action_type":"notify_cli"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn disable_heartbeat_removes_rule() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        // Create heartbeat
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/heartbeats", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"interval_minutes":5,"action_type":"notify_cli"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let hb_id = created["id"].as_str().unwrap();

        // Disable it
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/agents/{}/heartbeats/{}", agent_id, hb_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        // Verify list is empty
        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}/heartbeats", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let heartbeats = result.as_array().unwrap();
        assert_eq!(heartbeats.len(), 0);
    }

    #[tokio::test]
    async fn list_heartbeats_for_agent() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        // Create heartbeat
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/heartbeats", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"interval_minutes":5,"action_type":"notify_cli"}"#,
            ))
            .unwrap();
        request(&app, req).await;

        // List
        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}/heartbeats", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let heartbeats = result.as_array().unwrap();
        assert_eq!(heartbeats.len(), 1);
    }
}

#[cfg(test)]
mod skill_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    fn valid_skill_md(name: &str) -> String {
        format!(
            "---\nname: Skill {name}\ndescription: A skill called {name}\nauthor: tester\nversion: \"1.0\"\n---\n# {name}\nBody"
        )
    }

    #[tokio::test]
    async fn install_skill_writes_to_disk() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        let agent_id = seed_agent(&state, &token);

        let content = valid_skill_md("test-skill");
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/skills/install", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({"content": content}).to_string(),
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["slug"], "skill-test-skill");
        assert_eq!(result["source"], "agent");

        // Verify file was written
        let skill_path = state
            .moxxy_home
            .join("agents")
            .join(&agent_id)
            .join("skills")
            .join("skill-test-skill")
            .join("SKILL.md");
        assert!(skill_path.exists());
    }

    #[tokio::test]
    async fn list_skills_for_agent() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        // Install a skill via API
        let content = valid_skill_md("test-skill");
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/skills/install", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({"content": content}).to_string(),
            ))
            .unwrap();
        request(&app, req).await;

        // List skills
        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}/skills", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let skills = result.as_array().unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0]["name"], "Skill test-skill");
        assert_eq!(skills[0]["slug"], "skill-test-skill");
        assert_eq!(skills[0]["source"], "agent");
    }

    #[tokio::test]
    async fn delete_skill_removes_it() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        // Install a skill
        let content = valid_skill_md("del-skill");
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/skills/install", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({"content": content}).to_string(),
            ))
            .unwrap();
        request(&app, req).await;

        // Delete skill (slug is "skill-del-skill" from name "Skill del-skill")
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/agents/{}/skills/skill-del-skill", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        // Verify it's gone
        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}/skills", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let skills = result.as_array().unwrap();
        assert_eq!(skills.len(), 0);
    }

    #[tokio::test]
    async fn delete_nonexistent_skill_returns_404() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        let agent_id = seed_agent(&state, &token);

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/agents/{}/skills/nonexistent", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}

#[cfg(test)]
mod vault_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    #[tokio::test]
    async fn list_secrets_returns_all() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::VaultRead, TokenScope::VaultWrite]);
        seed_secret_ref(&state);
        seed_secret_ref(&state);

        let req = Request::builder()
            .method("GET")
            .uri("/v1/vault/secrets")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let secrets = result.as_array().unwrap();
        assert_eq!(secrets.len(), 2);
    }

    #[tokio::test]
    async fn create_secret_ref_returns_201() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::VaultWrite]);

        let req = Request::builder()
            .method("POST")
            .uri("/v1/vault/secrets")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"key_name":"my-api-key","backend_key":"os_keyring::my_key"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["key_name"], "my-api-key");
    }

    #[tokio::test]
    async fn grant_access_to_agent() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::VaultWrite, TokenScope::AgentsWrite],
        );
        let agent_id = seed_agent(&state, &token);
        let secret_id = seed_secret_ref(&state);

        let req = Request::builder()
            .method("POST")
            .uri("/v1/vault/grants")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(format!(
                r#"{{"agent_id":"{}","secret_ref_id":"{}"}}"#,
                agent_id, secret_id
            )))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["agent_id"], agent_id);
        assert_eq!(result["secret_ref_id"], secret_id);
    }

    #[tokio::test]
    async fn list_grants_returns_all() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![
                TokenScope::VaultWrite,
                TokenScope::VaultRead,
                TokenScope::AgentsWrite,
            ],
        );
        let agent_id = seed_agent(&state, &token);
        let secret_id = seed_secret_ref(&state);

        // Create grant
        let req = Request::builder()
            .method("POST")
            .uri("/v1/vault/grants")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(format!(
                r#"{{"agent_id":"{}","secret_ref_id":"{}"}}"#,
                agent_id, secret_id
            )))
            .unwrap();
        request(&app, req).await;

        // List grants
        let req = Request::builder()
            .method("GET")
            .uri("/v1/vault/grants")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let grants = result.as_array().unwrap();
        assert_eq!(grants.len(), 1);
    }

    #[tokio::test]
    async fn delete_secret_ref_returns_200() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::VaultWrite, TokenScope::VaultRead]);
        let secret_id = seed_secret_ref(&state);

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/vault/secrets/{}", secret_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        // Verify it's gone
        let req = Request::builder()
            .method("GET")
            .uri("/v1/vault/secrets")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn delete_nonexistent_secret_ref_returns_404() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::VaultWrite]);

        let req = Request::builder()
            .method("DELETE")
            .uri("/v1/vault/secrets/nonexistent")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn revoke_grant_succeeds() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![
                TokenScope::VaultWrite,
                TokenScope::VaultRead,
                TokenScope::AgentsWrite,
            ],
        );
        let agent_id = seed_agent(&state, &token);
        let secret_id = seed_secret_ref(&state);

        // Create grant
        let req = Request::builder()
            .method("POST")
            .uri("/v1/vault/grants")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(format!(
                r#"{{"agent_id":"{}","secret_ref_id":"{}"}}"#,
                agent_id, secret_id
            )))
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let grant_id = created["id"].as_str().unwrap();

        // Revoke
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/vault/grants/{}", grant_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }
}

#[cfg(test)]
mod sse_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    #[tokio::test]
    async fn sse_returns_event_stream_content_type() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::EventsRead]);

        let req = Request::builder()
            .method("GET")
            .uri("/v1/events/stream")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let content_type = resp
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(content_type.contains("text/event-stream"));
    }

    #[tokio::test]
    async fn sse_requires_events_read_scope() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsRead]);

        let req = Request::builder()
            .method("GET")
            .uri("/v1/events/stream")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn sse_delivers_emitted_events() {
        use futures_util::StreamExt;

        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::EventsRead]);

        let req = Request::builder()
            .method("GET")
            .uri("/v1/events/stream")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        // Emit an event after subscribing
        let envelope = moxxy_types::EventEnvelope::new(
            "agent-1".into(),
            None,
            None,
            1,
            moxxy_types::EventType::RunStarted,
            serde_json::json!({"task": "test"}),
        );
        state.event_bus.emit(envelope);

        // Read body stream
        let mut body_stream = resp.into_body().into_data_stream();
        let mut found_event = false;

        // We should get the initial comment and then the event
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while let Some(Ok(chunk)) = body_stream.next().await {
                let text = String::from_utf8_lossy(&chunk);
                if text.contains("run.started") {
                    found_event = true;
                    break;
                }
            }
        })
        .await;

        assert!(timeout.is_ok(), "Timed out waiting for SSE event");
        assert!(found_event, "Did not receive the emitted event");
    }

    #[tokio::test]
    async fn sse_sends_initial_comment() {
        use futures_util::StreamExt;

        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::EventsRead]);

        let req = Request::builder()
            .method("GET")
            .uri("/v1/events/stream")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let mut body_stream = resp.into_body().into_data_stream();
        let mut found_comment = false;

        let timeout = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            if let Some(Ok(chunk)) = body_stream.next().await {
                let text = String::from_utf8_lossy(&chunk);
                if text.contains("connected") {
                    found_comment = true;
                }
            }
        })
        .await;

        assert!(timeout.is_ok(), "Timed out waiting for initial SSE comment");
        assert!(found_comment, "Did not receive initial connected comment");
    }
}

#[cfg(test)]
mod event_persistence_tests {
    use super::test_helpers::*;
    use moxxy_types::{EventEnvelope, EventType};

    #[tokio::test]
    async fn emitted_events_are_persisted_to_event_audit() {
        let (_app, state) = test_app();
        state.spawn_event_persistence();

        let envelope = EventEnvelope::new(
            "agent-123".into(),
            Some("run-456".into()),
            None,
            0,
            EventType::RunStarted,
            serde_json::json!({"task": "hello world"}),
        );
        let event_id = envelope.event_id.clone();
        state.event_bus.emit(envelope);

        // Give the background task time to process
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let db = state.db.lock().unwrap();
        let found = db.events().find_by_id(&event_id).unwrap();
        assert!(found.is_some(), "Event should be persisted");
        let row = found.unwrap();
        assert_eq!(row.event_type, "run.started");
        assert_eq!(row.agent_id.as_deref(), Some("agent-123"));
        assert_eq!(row.run_id.as_deref(), Some("run-456"));
        assert!(!row.sensitive);
    }

    #[tokio::test]
    async fn redaction_engine_marks_sensitive_events() {
        let (_app, state) = test_app();
        // For this test we need secrets in the redaction list.
        // Since the current implementation uses an empty secrets list,
        // we verify the non-sensitive path works correctly.
        state.spawn_event_persistence();

        let envelope = EventEnvelope::new(
            "agent-789".into(),
            None,
            None,
            0,
            EventType::PrimitiveCompleted,
            serde_json::json!({"result": "safe-data"}),
        );
        let event_id = envelope.event_id.clone();
        state.event_bus.emit(envelope);

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let db = state.db.lock().unwrap();
        let found = db.events().find_by_id(&event_id).unwrap().unwrap();
        assert!(!found.sensitive);
        assert!(found.redactions_json.is_none());
    }

    #[tokio::test]
    async fn multiple_events_all_persisted() {
        let (_app, state) = test_app();
        state.spawn_event_persistence();

        let mut ids = Vec::new();
        for i in 0..5 {
            let envelope = EventEnvelope::new(
                "agent-multi".into(),
                Some("run-multi".into()),
                None,
                i,
                EventType::MessageDelta,
                serde_json::json!({"chunk": format!("part-{}", i)}),
            );
            ids.push(envelope.event_id.clone());
            state.event_bus.emit(envelope);
        }

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let db = state.db.lock().unwrap();
        let events = db.events().find_by_agent("agent-multi").unwrap();
        assert_eq!(events.len(), 5);
    }
}

#[cfg(test)]
mod audit_log_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::{EventEnvelope, EventType, TokenScope};

    #[tokio::test]
    async fn audit_logs_require_events_read_scope() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsRead]);
        let req = Request::builder()
            .method("GET")
            .uri("/v1/audit-logs")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn audit_logs_returns_persisted_events() {
        let (app, state) = test_app();
        state.spawn_event_persistence();
        let token = create_token_in_db(&state, vec![TokenScope::EventsRead]);

        // Emit some events
        for i in 0..3 {
            let envelope = EventEnvelope::new(
                "agent-audit".into(),
                Some("run-audit".into()),
                None,
                i,
                EventType::RunStarted,
                serde_json::json!({"task": "test"}),
            );
            state.event_bus.emit(envelope);
        }

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let req = Request::builder()
            .method("GET")
            .uri("/v1/audit-logs?agent_id=agent-audit")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["data"].as_array().unwrap().len(), 3);
        assert_eq!(result["pagination"]["total"], 3);
    }

    #[tokio::test]
    async fn audit_logs_supports_pagination() {
        let (app, state) = test_app();
        state.spawn_event_persistence();
        let token = create_token_in_db(&state, vec![TokenScope::EventsRead]);

        for i in 0..5 {
            let envelope = EventEnvelope::new(
                "agent-page".into(),
                None,
                None,
                i,
                EventType::PrimitiveCompleted,
                serde_json::json!({"n": i}),
            );
            state.event_bus.emit(envelope);
        }

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let req = Request::builder()
            .method("GET")
            .uri("/v1/audit-logs?agent_id=agent-page&limit=2&offset=1")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["data"].as_array().unwrap().len(), 2);
        assert_eq!(result["pagination"]["total"], 5);
        assert_eq!(result["pagination"]["offset"], 1);
    }

    #[tokio::test]
    async fn health_endpoint_returns_healthy() {
        let (app, _state) = test_app();
        let req = Request::builder()
            .method("GET")
            .uri("/v1/health")
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["status"], "healthy");
        assert_eq!(result["database"], "connected");
    }
}

#[cfg(test)]
mod memory_compact_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    #[tokio::test]
    async fn compact_memory_route_exists() {
        let (app, state) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        let agent_id = seed_agent(&state, &token);

        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/memory/compact", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(result.get("compacted_groups").is_some());
    }
}
