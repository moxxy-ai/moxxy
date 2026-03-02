pub mod auth_extractor;
pub mod routes;
pub mod state;

use axum::Router;
use axum::routing::{delete, get, post};
use state::AppState;
use std::sync::Arc;

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
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
        .route("/v1/agents/{id}", get(routes::agents::get_agent))
        .route("/v1/agents/{id}/runs", post(routes::agents::start_run))
        .route("/v1/agents/{id}/stop", post(routes::agents::stop_run))
        .route(
            "/v1/agents/{id}/subagents",
            post(routes::agents::spawn_subagent),
        )
        // Heartbeats
        .route(
            "/v1/agents/{id}/heartbeats",
            post(routes::heartbeats::create_heartbeat).get(routes::heartbeats::list_heartbeats),
        )
        // Skills
        .route(
            "/v1/agents/{id}/skills/install",
            post(routes::skills::install_skill),
        )
        .route(
            "/v1/agents/{id}/skills/approve/{skill_id}",
            post(routes::skills::approve_skill),
        )
        // Vault
        .route(
            "/v1/vault/secrets",
            post(routes::vault::create_secret_ref).get(routes::vault::list_secrets),
        )
        .route("/v1/vault/grants", post(routes::vault::create_grant))
        // Events
        .route("/v1/events/stream", get(routes::events::event_stream))
        .with_state(state)
}

#[cfg(test)]
mod test_helpers {
    use super::*;
    use axum::Router;
    use axum::body::Body;
    use http::Request;
    use moxxy_core::ApiTokenService;
    use moxxy_storage::{ProviderRow, StoredTokenRow};
    use moxxy_types::TokenScope;
    use tower::ServiceExt;

    pub fn test_app() -> (Router, Arc<AppState>) {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let state = Arc::new(AppState::new(conn));
        let app = create_router(state.clone());
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
                metadata_json: Some(r#"{"context_window":8192}"#.into()),
            })
            .unwrap();
    }

    pub fn seed_agent(state: &AppState, _token: &str) -> String {
        seed_provider(state);
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::now_v7().to_string();
        let db = state.db.lock().unwrap();
        db.agents()
            .insert(&moxxy_storage::AgentRow {
                id: id.clone(),
                parent_agent_id: None,
                provider_id: "test-provider".into(),
                model_id: "gpt-4".into(),
                workspace_root: "/tmp/ws".into(),
                core_mount: None,
                policy_profile: None,
                temperature: 0.7,
                max_subagent_depth: 2,
                max_subagents_total: 8,
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
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
        let db = state.db.lock().unwrap();
        let tokens = db.tokens().list_all().unwrap();
        let token_id = tokens[0].id.clone();
        drop(db);

        let req = Request::builder()
            .method("DELETE")
            .uri(&format!("/v1/auth/tokens/{}", token_id))
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
        let db = state.db.lock().unwrap();
        let tokens = db.tokens().list_all().unwrap();
        db.tokens().revoke(&tokens[0].id).unwrap();
        drop(db);

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
        for _ in 0..2 {
            let id = uuid::Uuid::now_v7().to_string();
            let db = state.db.lock().unwrap();
            db.agents()
                .insert(&moxxy_storage::AgentRow {
                    id,
                    parent_agent_id: None,
                    provider_id: "test-provider".into(),
                    model_id: "gpt-4".into(),
                    workspace_root: "/tmp/ws".into(),
                    core_mount: None,
                    policy_profile: None,
                    temperature: 0.7,
                    max_subagent_depth: 2,
                    max_subagents_total: 8,
                    status: "idle".into(),
                    depth: 0,
                    spawned_total: 0,
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
                r#"{"provider_id":"test-provider","model_id":"gpt-4","workspace_root":"/tmp/ws"}"#,
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
                r#"{"provider_id":"test-provider","model_id":"gpt-4","workspace_root":"/tmp/ws"}"#,
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
            .uri(&format!("/v1/agents/{}", agent_id))
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
                r#"{"provider_id":"p","model_id":"m","workspace_root":"/tmp"}"#,
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
        seed_provider(&state);
        let req = Request::builder()
            .method("POST")
            .uri("/v1/agents")
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"provider_id":"test-provider","model_id":"gpt-4","workspace_root":"/tmp/ws"}"#,
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
            .uri(&format!("/v1/agents/{}/runs", agent_id))
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
                r#"{"provider_id":"test-provider","model_id":"gpt-4","workspace_root":"/tmp/ws"}"#,
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
            .uri(&format!("/v1/agents/{}/runs", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"task":"work"}"#))
            .unwrap();
        request(&app, req).await;

        // Stop
        let req = Request::builder()
            .method("POST")
            .uri(&format!("/v1/agents/{}/stop", agent_id))
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
            .uri(&format!("/v1/agents/{}/subagents", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"provider_id":"test-provider","model_id":"gpt-4","workspace_root":"/tmp/sub"}"#,
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
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite, TokenScope::AgentsRead]);

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
            .uri(&format!("/v1/agents/{}/heartbeats", agent_id))
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
            .uri(&format!("/v1/agents/{}/heartbeats", agent_id))
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
            .uri(&format!("/v1/agents/{}/heartbeats", agent_id))
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
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        let agent_id = seed_agent(&state, &token);

        let req = Request::builder()
            .method("POST")
            .uri(&format!("/v1/agents/{}/skills/install", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"name":"test-skill","version":"1.0.0","content":"function run() {}"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::CREATED);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["status"], "quarantined");
    }

    #[tokio::test]
    async fn approve_skill_transitions_status() {
        let (app, state) = test_app();
        let token = create_token_in_db(&state, vec![TokenScope::AgentsWrite]);
        let agent_id = seed_agent(&state, &token);

        // Install skill
        let req = Request::builder()
            .method("POST")
            .uri(&format!("/v1/agents/{}/skills/install", agent_id))
            .header("authorization", format!("Bearer {}", token))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"name":"test-skill","version":"1.0.0","content":"function run() {}"}"#,
            ))
            .unwrap();
        let resp = request(&app, req).await;
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let installed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let skill_id = installed["id"].as_str().unwrap();

        // Approve skill
        let req = Request::builder()
            .method("POST")
            .uri(&format!(
                "/v1/agents/{}/skills/approve/{}",
                agent_id, skill_id
            ))
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap();
        let resp = request(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["status"], "approved");
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
