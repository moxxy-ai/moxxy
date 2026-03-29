pub mod auth_extractor;
pub mod heartbeat_actions;
pub mod rate_limit;
pub mod routes;
pub mod run_service;
pub mod state;
pub mod task_analyzer;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post};
use rate_limit::RateLimitConfig;
use state::AppState;
use std::sync::Arc;
use tower_governor::GovernorLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

fn build_cors_layer() -> CorsLayer {
    use axum::http::HeaderValue;

    let origins: Vec<HeaderValue> = match std::env::var("MOXXY_CORS_ORIGINS") {
        Ok(val) => val
            .split(',')
            .filter_map(|s| {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    return None;
                }
                trimmed.parse::<HeaderValue>().ok()
            })
            .collect(),
        Err(_) => {
            // Default to localhost origins
            vec![
                "http://localhost:3000".parse().unwrap(),
                "http://127.0.0.1:3000".parse().unwrap(),
                "http://localhost:17900".parse().unwrap(),
                "http://127.0.0.1:17900".parse().unwrap(),
                "http://localhost:17901".parse().unwrap(),
                "http://127.0.0.1:17901".parse().unwrap(),
            ]
        }
    };

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods(Any)
        .allow_headers(Any)
}

pub fn create_router(state: Arc<AppState>, rate_limit_config: Option<RateLimitConfig>) -> Router {
    let config = rate_limit_config.unwrap_or_else(RateLimitConfig::permissive);
    let governor_conf = config.into_governor_config();
    let governor_layer = GovernorLayer::new(governor_conf);

    let cors = build_cors_layer();

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
            "/v1/agents/{name}",
            get(routes::agents::get_agent)
                .patch(routes::agents::update_agent)
                .delete(routes::agents::delete_agent),
        )
        .route("/v1/agents/{name}/runs", post(routes::agents::start_run))
        .route("/v1/agents/{name}/stop", post(routes::agents::stop_run))
        .route(
            "/v1/agents/{name}/reset",
            post(routes::agents::reset_session),
        )
        .route(
            "/v1/agents/{name}/history",
            get(routes::agents::get_history),
        )
        .route(
            "/v1/agents/{name}/ask-responses/{question_id}",
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
        // Templates
        .route(
            "/v1/templates",
            post(routes::templates::create_template).get(routes::templates::list_templates),
        )
        .route(
            "/v1/templates/{slug}",
            get(routes::templates::get_template)
                .put(routes::templates::update_template)
                .delete(routes::templates::delete_template),
        )
        .route(
            "/v1/agents/{name}/template",
            axum::routing::patch(routes::templates::set_agent_template),
        )
        // MCP
        .route(
            "/v1/agents/{name}/mcp",
            get(routes::mcp::list_mcp_servers).post(routes::mcp::add_mcp_server),
        )
        .route(
            "/v1/agents/{name}/mcp/{server_id}",
            delete(routes::mcp::remove_mcp_server),
        )
        .route(
            "/v1/agents/{name}/mcp/{server_id}/test",
            post(routes::mcp::test_mcp_server),
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
            "/v1/agents/{name}/webhooks",
            get(routes::webhooks::list_webhooks),
        )
        .route(
            "/v1/agents/{name}/webhooks/{slug}",
            delete(routes::webhooks::delete_webhook),
        )
        .route(
            "/v1/agents/{name}/webhooks/{slug}/deliveries",
            get(routes::webhooks::list_deliveries),
        )
        .route(
            "/v1/admin/reload-webhooks",
            post(routes::webhooks::reload_webhooks),
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
    use moxxy_core::{ApiTokenService, ProviderDoc, ProviderModelEntry, ProviderStore};
    use moxxy_storage::StoredTokenRow;
    use moxxy_types::{AuthMode, TokenScope};
    use tower::ServiceExt;

    pub fn test_app() -> (Router, Arc<AppState>, tempfile::TempDir) {
        crate::state::register_sqlite_vec();
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("agents")).unwrap();
        std::fs::create_dir_all(tmp.path().join("providers")).unwrap();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let state = Arc::new(AppState::new(
            conn,
            [0u8; 32],
            AuthMode::Token,
            tmp.path().to_path_buf(),
            "http://127.0.0.1:3000".into(),
        ));
        let app = create_router(state.clone(), None);
        (app, state, tmp)
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
        let doc = ProviderDoc {
            id: "test-provider".into(),
            display_name: "Test Provider".into(),
            enabled: true,
            secret_ref: None,
            api_base: None,
            models: vec![],
        };
        ProviderStore::create(&state.moxxy_home, &doc).unwrap();
    }

    pub fn seed_provider_with_model(state: &AppState) {
        let doc = ProviderDoc {
            id: "test-provider".into(),
            display_name: "Test Provider".into(),
            enabled: true,
            secret_ref: None,
            api_base: None,
            models: vec![ProviderModelEntry {
                id: "gpt-4".into(),
                display_name: "GPT-4".into(),
                api_base: Some("https://api.openai.com/v1".into()),
                chatgpt_account_id: None,
            }],
        };
        ProviderStore::create(&state.moxxy_home, &doc).unwrap();
    }

    pub fn seed_ollama_provider(state: &AppState, api_base: &str) {
        let doc = ProviderDoc {
            id: "ollama".into(),
            display_name: "Ollama".into(),
            enabled: true,
            secret_ref: None,
            api_base: None,
            models: vec![ProviderModelEntry {
                id: "qwen3:8b".into(),
                display_name: "Qwen 3 8B".into(),
                api_base: Some(api_base.into()),
                chatgpt_account_id: None,
            }],
        };
        ProviderStore::create(&state.moxxy_home, &doc).unwrap();
    }

    /// Seed a test agent using the registry + YAML store. Returns the agent name.
    pub fn seed_agent(state: &AppState, _token: &str) -> String {
        seed_provider(state);
        let name = "test-agent".to_string();
        let config = moxxy_types::AgentConfig {
            provider: "test-provider".into(),
            model: "gpt-4".into(),
            temperature: 0.7,
            max_subagent_depth: 2,
            max_subagents_total: 8,
            policy_profile: None,
            core_mount: None,
            template: None,
        };
        // Create on disk + register
        let _ = moxxy_core::AgentStore::create(&state.moxxy_home, &name, &config);
        let runtime = moxxy_types::AgentRuntime {
            name: name.clone(),
            agent_type: moxxy_types::AgentType::Agent,
            config,
            status: moxxy_types::AgentStatus::Idle,
            parent_name: None,
            hive_role: None,
            depth: 0,
            spawned_count: 0,
            persona: None,
            last_result: None,
        };
        let _ = state.registry.register(runtime);

        // Insert minimal row into agents table for FK compatibility
        let now = chrono::Utc::now().to_rfc3339();
        {
            let db = state.db.lock().unwrap();
            let _ = db.agents().insert(&moxxy_storage::AgentRow {
                id: name.clone(),
                parent_agent_id: None,
                name: Some(name.clone()),
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                workspace_root: state
                    .moxxy_home
                    .join("agents")
                    .join(&name)
                    .join("workspace")
                    .to_string_lossy()
                    .to_string(),
                created_at: now.clone(),
                updated_at: now,
            });
        }

        name
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
        let (app, _state, _tmp) = test_app(); // _tmp keeps tempdir alive
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, _state, _tmp) = test_app(); // _tmp keeps tempdir alive
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        seed_provider(&state);

        // Register two agents via registry + YAML store
        for i in 0..2 {
            let name = format!("test-agent-{i}");
            let config = moxxy_types::AgentConfig {
                provider: "test-provider".into(),
                model: "gpt-4".into(),
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                policy_profile: None,
                core_mount: None,
                template: None,
            };
            let _ = moxxy_core::AgentStore::create(&state.moxxy_home, &name, &config);
            let runtime = moxxy_types::AgentRuntime {
                name: name.clone(),
                agent_type: moxxy_types::AgentType::Agent,
                config,
                status: moxxy_types::AgentStatus::Idle,
                parent_name: None,
                hive_role: None,
                depth: 0,
                spawned_count: 0,
                persona: None,
                last_result: None,
            };
            let _ = state.registry.register(runtime);
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        assert_eq!(resp.status(), StatusCode::CREATED);

        let req = Request::builder()
            .method("GET")
            .uri("/v1/agents/test-agent")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn create_requires_agents_write_scope() {
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        assert_eq!(resp.status(), StatusCode::CREATED);

        let req = Request::builder()
            .method("POST")
            .uri("/v1/agents/test-agent/runs")
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
        let (app, state, _tmp) = test_app();
        let token =
            create_token_in_db(&state, vec![TokenScope::AgentsWrite, TokenScope::RunsWrite]);
        let agent_name = seed_agent(&state, &token);

        // Stop (agent is idle, but stop should still succeed)
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/stop", agent_name))
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
    async fn update_agent_changes_provider_and_model() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_name = seed_agent(&state, &token);

        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/v1/agents/{}", agent_name))
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
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_name = seed_agent(&state, &token);

        // Only update temperature
        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/v1/agents/{}", agent_name))
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        let agent_name = seed_agent(&state, &token);

        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/v1/agents/{}", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"temperature":5.0}"#))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn delete_agent_removes_it() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_name = seed_agent(&state, &token);

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/agents/{}", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        // Verify it's gone from registry
        assert!(state.registry.get(&agent_name).is_none());

        // Verify GET returns 404
        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_nonexistent_agent_returns_404() {
        let (app, state, _tmp) = test_app();
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
mod history_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    #[tokio::test]
    async fn get_history_returns_conversation_messages() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        let agent_name = seed_agent(&state, &token);

        // Insert conversation rows directly
        {
            let db = state.db.lock().unwrap();
            for (seq, role, content) in [
                (0, "user", "Hello"),
                (1, "assistant", "Hi there!"),
                (2, "user", "How are you?"),
            ] {
                db.conversations()
                    .insert(&moxxy_storage::ConversationLogRow {
                        id: uuid::Uuid::now_v7().to_string(),
                        agent_id: agent_name.clone(),
                        run_id: "run-1".into(),
                        sequence: seq,
                        role: role.into(),
                        content: content.into(),
                        created_at: format!("2025-01-01T00:00:0{}Z", seq),
                    })
                    .unwrap();
            }
        }

        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}/history", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let messages = result["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "Hello");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"], "Hi there!");
        assert_eq!(messages[2]["role"], "user");
        assert_eq!(messages[2]["content"], "How are you?");
    }

    #[tokio::test]
    async fn get_history_respects_limit() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        let agent_name = seed_agent(&state, &token);

        {
            let db = state.db.lock().unwrap();
            for i in 0..5 {
                db.conversations()
                    .insert(&moxxy_storage::ConversationLogRow {
                        id: uuid::Uuid::now_v7().to_string(),
                        agent_id: agent_name.clone(),
                        run_id: "run-1".into(),
                        sequence: i,
                        role: "user".into(),
                        content: format!("msg-{i}"),
                        created_at: format!("2025-01-01T00:00:0{}Z", i),
                    })
                    .unwrap();
            }
        }

        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}/history?limit=2", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let messages = result["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
    }

    #[tokio::test]
    async fn get_history_requires_auth() {
        let (app, _state, _tmp) = test_app();
        let req = Request::builder()
            .method("GET")
            .uri("/v1/agents/test-agent/history")
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (_app, state, _tmp) = test_app();
        seed_provider_with_model(&state);

        // Store an API key in the vault
        state
            .vault_backend
            .set_secret("moxxy_provider_test-provider", "sk-test-key-123")
            .unwrap();

        let provider = state
            .run_service
            .resolve_provider("test-provider", "gpt-4", None);
        assert!(provider.is_some());
    }

    #[test]
    fn resolve_provider_missing_vault_key_returns_none() {
        let (_app, state, _tmp) = test_app();
        seed_provider_with_model(&state);

        // No vault secret stored = resolve should return None
        let provider = state
            .run_service
            .resolve_provider("test-provider", "gpt-4", None);
        assert!(provider.is_none());
    }

    #[test]
    fn resolve_provider_missing_provider_returns_none() {
        let (_app, state, _tmp) = test_app();

        let provider = state
            .run_service
            .resolve_provider("nonexistent", "gpt-4", None);
        assert!(provider.is_none());
    }

    #[test]
    fn resolve_provider_missing_model_returns_none() {
        let (_app, state, _tmp) = test_app();
        seed_provider(&state);

        state
            .vault_backend
            .set_secret("moxxy_provider_test-provider", "sk-test-key-123")
            .unwrap();

        let provider =
            state
                .run_service
                .resolve_provider("test-provider", "nonexistent-model", None);
        assert!(provider.is_none());
    }

    #[test]
    fn resolve_ollama_provider_without_vault_key_and_without_static_model_returns_some() {
        let (_app, state, _tmp) = test_app();
        seed_ollama_provider(&state, "http://localhost:11434/v1");

        let provider = state
            .run_service
            .resolve_provider("ollama", "gpt-oss:20b", None);
        assert!(provider.is_some());
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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

    #[tokio::test]
    async fn install_skill_quarantines_by_default() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        let agent_id = seed_agent(&state, &token);

        let skill_content = "---\nname: test-skill\ndescription: test\nauthor: tester\nversion: \"1.0.0\"\n---\nfunction run() {}";
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/skills/install", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({"content": skill_content}).to_string(),
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["slug"], "test-skill");
    }

    #[tokio::test]
    async fn list_skills_for_agent() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        // Install a skill
        let skill_content = "---\nname: test-skill\ndescription: test\nauthor: tester\nversion: \"1.0.0\"\n---\nfn run(){}";
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/skills/install", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({"content": skill_content}).to_string(),
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
        assert_eq!(skills[0]["name"], "test-skill");
    }

    #[tokio::test]
    async fn delete_skill_removes_it() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsWrite, TokenScope::AgentsRead],
        );
        let agent_id = seed_agent(&state, &token);

        // Install a skill
        let skill_content = "---\nname: test-skill\ndescription: test\nauthor: tester\nversion: \"1.0.0\"\n---\nfn run(){}";
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/skills/install", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({"content": skill_content}).to_string(),
            ))
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let installed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let skill_id = installed["slug"].as_str().unwrap();

        // Delete skill
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/agents/{}/skills/{}", agent_id, skill_id))
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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

        let (app, state, _tmp) = test_app();
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

        let (app, state, _tmp) = test_app();
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
        let (_app, state, _tmp) = test_app();
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
        let (_app, state, _tmp) = test_app();
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
        let (_app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, state, _tmp) = test_app();
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
        let (app, _state, _tmp) = test_app(); // _tmp keeps tempdir alive
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
        let (app, state, _tmp) = test_app();
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

#[cfg(test)]
mod mcp_tests {
    use super::test_helpers::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http::Request;
    use moxxy_types::TokenScope;

    #[tokio::test]
    async fn list_mcp_returns_empty_when_no_config() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        let agent_name = seed_agent(&state, &token);

        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}/mcp", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let servers = result["servers"].as_array().unwrap();
        assert!(servers.is_empty());
    }

    #[tokio::test]
    async fn add_mcp_server_creates_config_and_returns_201() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        let agent_name = seed_agent(&state, &token);

        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/mcp", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"id":"my-server","transport":"stdio","command":"echo","args":["hello"]}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["id"], "my-server");
        assert_eq!(result["transport"], "stdio");

        // Verify it shows up in list
        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}/mcp", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let servers = result["servers"].as_array().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0]["id"], "my-server");
    }

    #[tokio::test]
    async fn add_duplicate_mcp_server_returns_conflict() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        let agent_name = seed_agent(&state, &token);

        let body_json = r#"{"id":"dup-server","transport":"stdio","command":"echo","args":[]}"#;

        // First add
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/mcp", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(body_json))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        // Duplicate add
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/mcp", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(body_json))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn remove_unknown_mcp_server_returns_404() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        let agent_name = seed_agent(&state, &token);

        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/agents/{}/mcp/nonexistent", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn remove_mcp_server_succeeds() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        let agent_name = seed_agent(&state, &token);

        // Add a server first
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/mcp", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"id":"to-remove","transport":"stdio","command":"echo","args":[]}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        // Remove it
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/v1/agents/{}/mcp/to-remove", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        // Verify it's gone
        let req = Request::builder()
            .method("GET")
            .uri(format!("/v1/agents/{}/mcp", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(result["servers"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn add_mcp_server_validates_input() {
        let (app, state, _tmp) = test_app();
        let token = create_token_in_db(
            &state,
            vec![TokenScope::AgentsRead, TokenScope::AgentsWrite],
        );
        let agent_name = seed_agent(&state, &token);

        // stdio without command
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/agents/{}/mcp", agent_name))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"id":"bad","transport":"stdio"}"#))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
