use axum::{
    Router,
    body::Body,
    http::{HeaderValue, Method, Request, header},
    middleware,
    middleware::Next,
    routing::{get, post},
};
use tower_http::cors::CorsLayer;

use super::AppState;
use super::auth;
use super::handlers::{
    agents, channels, chat, config, mcp, memory, mobile, orchestrate, orchestrator_config,
    orchestrator_templates, proxy, schedules, skills, tokens, vault, webhooks,
};

fn build_localhost_cors(api_port: u16, web_port: u16) -> CorsLayer {
    let origins: Vec<HeaderValue> = [
        format!("http://127.0.0.1:{}", api_port),
        format!("http://localhost:{}", api_port),
        format!("http://127.0.0.1:{}", web_port),
        format!("http://localhost:{}", web_port),
    ]
    .iter()
    .filter_map(|o| o.parse().ok())
    .collect();

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::DELETE,
            Method::PATCH,
            Method::OPTIONS,
        ])
        .allow_headers(tower_http::cors::Any)
}

pub fn build_api_router(state: AppState) -> Router {
    // Public routes that bypass auth (external services authenticate via HMAC signatures)
    let public_routes = Router::new()
        .route(
            "/api/webhooks/{agent}/{event_source}",
            post(webhooks::webhook_endpoint),
        )
        .layer(middleware::from_fn(security_headers))
        .with_state(state.clone());

    let authed_routes = Router::new()
        .route(
            "/api/agents",
            get(agents::get_agents).post(agents::create_agent_endpoint),
        )
        .route(
            "/api/agents/{agent}",
            axum::routing::delete(agents::delete_agent_endpoint),
        )
        .route(
            "/api/agents/{agent}/vault",
            get(vault::get_vault_keys).post(vault::set_vault_secret),
        )
        .route(
            "/api/agents/{agent}/vault/{key}",
            get(vault::get_vault_secret).delete(vault::delete_vault_secret),
        )
        .route("/api/agents/{agent}/channels", get(channels::get_channels))
        .route(
            "/api/agents/{agent}/channels/telegram/token",
            post(channels::set_telegram_token),
        )
        .route(
            "/api/agents/{agent}/channels/telegram/pair",
            post(channels::pair_telegram),
        )
        .route(
            "/api/agents/{agent}/channels/telegram/revoke",
            post(channels::revoke_telegram_pairing),
        )
        .route(
            "/api/agents/{agent}/channels/telegram/send",
            post(channels::send_telegram_message),
        )
        .route(
            "/api/agents/{agent}/channels/telegram",
            axum::routing::delete(channels::disconnect_telegram),
        )
        .route(
            "/api/agents/{agent}/channels/telegram/stt",
            post(channels::set_telegram_stt),
        )
        .route(
            "/api/agents/{agent}/channels/discord/token",
            post(channels::set_discord_token),
        )
        .route(
            "/api/agents/{agent}/channels/discord/send",
            post(channels::send_discord_message),
        )
        .route(
            "/api/agents/{agent}/channels/discord/listen-channels",
            get(channels::get_discord_listen_channels).post(channels::add_discord_listen_channel),
        )
        .route(
            "/api/agents/{agent}/channels/discord/listen-channels/remove",
            post(channels::remove_discord_listen_channel),
        )
        .route(
            "/api/agents/{agent}/channels/discord/list-channels",
            get(channels::list_discord_channels),
        )
        .route(
            "/api/agents/{agent}/channels/discord/listen-mode",
            get(channels::get_discord_listen_mode).post(channels::set_discord_listen_mode),
        )
        .route(
            "/api/agents/{agent}/channels/discord",
            axum::routing::delete(channels::disconnect_discord),
        )
        .route(
            "/api/agents/{agent}/channels/whatsapp/config",
            post(channels::set_whatsapp_config),
        )
        .route(
            "/api/agents/{agent}/channels/whatsapp/send",
            post(channels::send_whatsapp_message),
        )
        .route(
            "/api/agents/{agent}/channels/whatsapp",
            axum::routing::delete(channels::disconnect_whatsapp),
        )
        .route(
            "/api/agents/{agent}/restart",
            post(agents::restart_agent_endpoint),
        )
        .route(
            "/api/agents/{agent}/pair_mobile",
            get(mobile::pair_mobile_endpoint),
        )
        .route(
            "/api/agents/{agent}/schedules",
            get(schedules::get_schedules_endpoint)
                .post(schedules::create_schedule_endpoint)
                .delete(schedules::delete_all_schedules_endpoint),
        )
        .route(
            "/api/agents/{agent}/schedules/{schedule_name}",
            axum::routing::delete(schedules::delete_schedule_endpoint),
        )
        .route(
            "/api/agents/{agent}/webhooks",
            get(webhooks::get_webhooks_endpoint).post(webhooks::create_webhook_endpoint),
        )
        .route(
            "/api/agents/{agent}/webhooks/{webhook_name}",
            axum::routing::delete(webhooks::delete_webhook_endpoint)
                .patch(webhooks::update_webhook_endpoint),
        )
        .route(
            "/api/agents/{agent}/memory/short",
            get(memory::get_short_term_memory),
        )
        .route(
            "/api/agents/{agent}/session/messages",
            get(memory::get_session_messages),
        )
        .route(
            "/api/agents/{agent}/llm",
            get(config::get_llm_info).post(config::set_llm_endpoint),
        )
        .route(
            "/api/agents/{agent}/skills",
            get(skills::get_skills_endpoint),
        )
        .route(
            "/api/agents/{agent}/create_skill",
            post(skills::create_skill_endpoint),
        )
        .route(
            "/api/agents/{agent}/install_skill",
            post(skills::install_skill_endpoint),
        )
        .route(
            "/api/agents/{agent}/upgrade_skill",
            post(skills::upgrade_skill_endpoint),
        )
        .route(
            "/api/agents/{agent}/install_openclaw_skill",
            post(skills::install_openclaw_skill_endpoint),
        )
        .route(
            "/api/agents/{agent}/skills/{skill_name}",
            axum::routing::delete(skills::remove_skill_endpoint)
                .patch(skills::modify_skill_endpoint),
        )
        .route(
            "/api/agents/{agent}/mcp",
            get(mcp::get_mcp_servers_endpoint).post(mcp::add_mcp_server_endpoint),
        )
        .route(
            "/api/agents/{agent}/mcp/{server_name}",
            axum::routing::delete(mcp::delete_mcp_server_endpoint),
        )
        .route("/api/memory/swarm", get(memory::get_swarm_memory))
        .route("/api/providers", get(config::get_providers_endpoint))
        .route(
            "/api/providers/custom",
            get(config::get_custom_providers_endpoint).post(config::add_custom_provider_endpoint),
        )
        .route(
            "/api/providers/custom/{provider_id}",
            axum::routing::delete(config::delete_custom_provider_endpoint),
        )
        .route(
            "/api/config/global",
            get(config::get_global_config_endpoint).post(config::set_global_config_endpoint),
        )
        .route(
            "/api/gateway/restart",
            post(config::restart_gateway_endpoint),
        )
        .route("/api/logs", get(super::sse_logs_endpoint));

    let mut authed_routes = authed_routes
        .route("/api/host/execute_bash", post(proxy::execute_bash))
        .route("/api/host/execute_python", post(proxy::execute_python));

    #[cfg(target_os = "macos")]
    {
        authed_routes = authed_routes.route(
            "/api/host/execute_applescript",
            post(proxy::execute_applescript),
        );
    }
    #[cfg(target_os = "windows")]
    {
        authed_routes = authed_routes.route(
            "/api/host/execute_powershell",
            post(proxy::execute_powershell),
        );
    }

    let authed_routes = authed_routes
        .route(
            "/api/agents/{agent}/delegate",
            post(webhooks::delegate_endpoint),
        )
        .route(
            "/api/agents/{agent}/orchestrate/config",
            get(orchestrator_config::get_orchestrator_config)
                .post(orchestrator_config::set_orchestrator_config),
        )
        .route(
            "/api/agents/{agent}/orchestrate/templates",
            get(orchestrator_templates::list_orchestrator_templates)
                .post(orchestrator_templates::upsert_orchestrator_template),
        )
        .route(
            "/api/agents/{agent}/orchestrate/templates/{template_id}",
            get(orchestrator_templates::get_orchestrator_template)
                .patch(orchestrator_templates::patch_orchestrator_template)
                .delete(orchestrator_templates::delete_orchestrator_template),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs",
            get(orchestrate::list_orchestration_jobs).post(orchestrate::start_orchestration_job),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs/run",
            post(orchestrate::start_orchestration_job_run),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs/{job_id}",
            get(orchestrate::get_orchestration_job),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs/{job_id}/workers",
            get(orchestrate::list_orchestration_workers),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs/{job_id}/tasks",
            get(orchestrate::list_orchestration_tasks),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs/{job_id}/tasks/{task_id}",
            get(orchestrate::get_orchestration_task),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs/{job_id}/events",
            get(orchestrate::list_orchestration_events),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs/{job_id}/stream",
            get(orchestrate::stream_orchestration_events),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs/{job_id}/cancel",
            post(orchestrate::cancel_orchestration_job),
        )
        .route(
            "/api/agents/{agent}/orchestrate/jobs/{job_id}/actions/approve-merge",
            post(orchestrate::approve_orchestration_merge),
        )
        .route("/api/agents/{agent}/chat", post(chat::chat_endpoint))
        .route(
            "/api/agents/{agent}/chat/stream",
            post(chat::chat_stream_endpoint),
        )
        .route(
            "/api/agents/{agent}/tokens",
            get(tokens::list_tokens).post(tokens::create_token),
        )
        .route(
            "/api/agents/{agent}/tokens/{token_id}",
            axum::routing::delete(tokens::delete_token),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ))
        .layer(middleware::from_fn(security_headers))
        .layer(build_localhost_cors(state.api_port, state.web_port))
        .with_state(state.clone());

    public_routes.merge(authed_routes)
}

async fn security_headers(req: Request<Body>, next: Next) -> axum::response::Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        ),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::{
        ContainerRegistry, LlmRegistry, MemoryRegistry, RunMode, ScheduledJobRegistry,
        SchedulerRegistry, SkillRegistry, VaultRegistry,
    };
    use crate::core::lifecycle::LifecycleComponent;
    use axum::http::StatusCode;
    use serde_json;
    use std::collections::HashSet;
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tower::util::ServiceExt;

    fn empty_state() -> AppState {
        let registry: MemoryRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let skill_registry: SkillRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let llm_registry: LlmRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let container_registry: ContainerRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let vault_registry: VaultRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let scheduler_registry: SchedulerRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let scheduled_job_registry: ScheduledJobRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let (log_tx, _) = tokio::sync::broadcast::channel(16);

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
            api_host: "127.0.0.1".to_string(),
            api_port: 17890,
            web_port: 3001,
            internal_token: "test-internal-token".to_string(),
        }
    }

    async fn state_with_memory() -> AppState {
        let mem = crate::core::memory::test_memory_system().await;
        let vault = Arc::new(crate::core::vault::SecretsVault::new(mem.get_db()));
        vault.initialize().await.expect("vault init");

        let mem_arc = Arc::new(Mutex::new(mem));
        let registry: MemoryRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        registry.lock().await.insert("default".to_string(), mem_arc);
        let skill_registry: SkillRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let llm_registry: LlmRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let container_registry: ContainerRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let vault_registry: VaultRegistry = Arc::new(Mutex::new(std::collections::HashMap::new()));
        vault_registry
            .lock()
            .await
            .insert("default".to_string(), vault);
        let scheduler_registry: SchedulerRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let scheduled_job_registry: ScheduledJobRegistry =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let (log_tx, _) = tokio::sync::broadcast::channel(16);

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
            api_host: "127.0.0.1".to_string(),
            api_port: 17890,
            web_port: 3001,
            internal_token: "test-internal-token".to_string(),
        }
    }

    async fn state_with_skills() -> AppState {
        let state = state_with_memory().await;
        let tmp = tempfile::tempdir().expect("temp dir");
        let workspace_dir = tmp.path().join("agents").join("default");
        std::fs::create_dir_all(&workspace_dir).expect("create workspace");

        let vault = {
            let reg = state.vault_registry.lock().await;
            reg.get("default").cloned().expect("vault")
        };

        let agent_dir = tmp.path().join("agents").join("default");
        let sandbox = crate::skills::native_executor::NativeExecutor::new(
            vault,
            "default".to_string(),
            agent_dir.clone(),
            "127.0.0.1".to_string(),
            17890,
            "test-token".to_string(),
        );
        let mut sm = crate::skills::SkillManager::new(Box::new(sandbox), agent_dir.clone());
        sm.on_init().await.expect("skill manager init");

        let mut skill_reg = state.skill_registry.lock().await;
        skill_reg.insert("default".to_string(), Arc::new(Mutex::new(sm)));
        drop(skill_reg);

        state
    }

    async fn json_request(
        app: Router,
        method: Method,
        path: &str,
        body: Option<serde_json::Value>,
        token: &str,
    ) -> (StatusCode, serde_json::Value) {
        let body = match body {
            Some(json) => Body::from(serde_json::to_string(&json).unwrap()),
            None => Body::empty(),
        };

        let req = Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json")
            .header("x-moxxy-internal-token", token)
            .body(body)
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&body_bytes).unwrap_or(serde_json::json!({}));
        (status, json)
    }

    #[tokio::test]
    async fn security_headers_present_on_responses() {
        let state = empty_state();
        let app = build_api_router(state.clone());

        let req = Request::builder()
            .method(Method::GET)
            .uri("/api/agents")
            .header("x-moxxy-internal-token", "test-internal-token")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(
            resp.headers().get("x-content-type-options").unwrap(),
            "nosniff"
        );
        assert_eq!(resp.headers().get("x-frame-options").unwrap(), "DENY");
        assert!(
            resp.headers()
                .get("content-security-policy")
                .unwrap()
                .to_str()
                .unwrap()
                .contains("default-src 'self'")
        );
    }

    #[tokio::test]
    async fn get_agents_returns_json() {
        let state = state_with_memory().await;
        let app = build_api_router(state);
        let (status, json) =
            json_request(app, Method::GET, "/api/agents", None, "test-internal-token").await;
        assert_eq!(status, StatusCode::OK);
        assert!(json.get("agents").is_some());
    }

    #[tokio::test]
    async fn get_schedules_returns_empty_list() {
        let state = state_with_memory().await;
        let app = build_api_router(state);
        let (status, json) = json_request(
            app,
            Method::GET,
            "/api/agents/default/schedules",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["success"], true);
        assert_eq!(json["schedules"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn get_webhooks_returns_empty_list() {
        let state = state_with_memory().await;
        let app = build_api_router(state);
        let (status, json) = json_request(
            app,
            Method::GET,
            "/api/agents/default/webhooks",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["success"], true);
        assert_eq!(json["webhooks"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn create_webhook_and_list_roundtrip() {
        let state = state_with_memory().await;

        let app = build_api_router(state.clone());
        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/webhooks",
            Some(serde_json::json!({
                "name": "gh-alerts",
                "source": "github",
                "secret": "",
                "prompt_template": "Process: {{body}}"
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["success"], true);
        assert!(json["webhook_url"].as_str().unwrap().contains("github"));

        let app = build_api_router(state);
        let (_, json) = json_request(
            app,
            Method::GET,
            "/api/agents/default/webhooks",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(json["webhooks"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn delete_webhook_roundtrip() {
        let state = state_with_memory().await;

        let app = build_api_router(state.clone());
        json_request(
            app,
            Method::POST,
            "/api/agents/default/webhooks",
            Some(serde_json::json!({
                "name": "temp",
                "source": "stripe",
                "secret": "",
                "prompt_template": "t"
            })),
            "test-internal-token",
        )
        .await;

        let app = build_api_router(state.clone());
        let (status, json) = json_request(
            app,
            Method::DELETE,
            "/api/agents/default/webhooks/temp",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["success"], true);

        let app = build_api_router(state);
        let (_, json) = json_request(
            app,
            Method::GET,
            "/api/agents/default/webhooks",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(json["webhooks"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn get_short_term_memory_returns_content() {
        let state = state_with_memory().await;
        let app = build_api_router(state);
        let (status, json) = json_request(
            app,
            Method::GET,
            "/api/agents/default/memory/short",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(json.get("content").is_some());
    }

    #[tokio::test]
    async fn get_session_messages_returns_success() {
        let state = state_with_memory().await;
        let app = build_api_router(state);
        let (status, json) = json_request(
            app,
            Method::GET,
            "/api/agents/default/session/messages",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["success"], true);
        assert!(json["messages"].as_array().is_some());
    }

    #[tokio::test]
    async fn authed_route_rejects_without_token() {
        let state = state_with_memory().await;
        {
            let reg = state.registry.lock().await;
            let mem_arc = reg.get("default").unwrap();
            let mem = mem_arc.lock().await;
            mem.create_api_token("test").await.unwrap();
        }
        let app = build_api_router(state);
        let req = Request::builder()
            .method(Method::GET)
            .uri("/api/agents")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn nonexistent_agent_returns_not_found_or_error() {
        let state = state_with_memory().await;
        let app = build_api_router(state);
        let (status, json) = json_request(
            app,
            Method::GET,
            "/api/agents/nonexistent/memory/short",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(json["content"].as_str().unwrap().contains("not found"));
    }

    #[tokio::test]
    async fn method_not_allowed_returns_405() {
        let state = empty_state();
        let app = build_api_router(state);
        let req = Request::builder()
            .method(Method::PATCH)
            .uri("/api/agents")
            .header("x-moxxy-internal-token", "test-internal-token")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn api_route_contract_has_all_expected_paths() {
        let mut paths: Vec<&'static str> = vec![
            "/api/webhooks/default/source",
            "/api/agents",
            "/api/agents/default",
            "/api/agents/default/vault",
            "/api/agents/default/vault/test",
            "/api/agents/default/channels",
            "/api/agents/default/channels/telegram/token",
            "/api/agents/default/channels/telegram/pair",
            "/api/agents/default/channels/telegram/revoke",
            "/api/agents/default/channels/telegram/send",
            "/api/agents/default/channels/telegram",
            "/api/agents/default/channels/telegram/stt",
            "/api/agents/default/channels/discord/token",
            "/api/agents/default/channels/discord/send",
            "/api/agents/default/channels/discord/listen-channels",
            "/api/agents/default/channels/discord/listen-channels/remove",
            "/api/agents/default/channels/discord/list-channels",
            "/api/agents/default/channels/discord/listen-mode",
            "/api/agents/default/channels/discord",
            "/api/agents/default/channels/whatsapp/config",
            "/api/agents/default/channels/whatsapp/send",
            "/api/agents/default/channels/whatsapp",
            "/api/agents/default/restart",
            "/api/agents/default/pair_mobile",
            "/api/agents/default/schedules",
            "/api/agents/default/schedules/nightly_digest",
            "/api/agents/default/webhooks",
            "/api/agents/default/webhooks/alpha",
            "/api/agents/default/memory/short",
            "/api/agents/default/session/messages",
            "/api/agents/default/llm",
            "/api/agents/default/skills",
            "/api/agents/default/create_skill",
            "/api/agents/default/install_skill",
            "/api/agents/default/upgrade_skill",
            "/api/agents/default/install_openclaw_skill",
            "/api/agents/default/skills/sample_skill",
            "/api/agents/default/mcp",
            "/api/agents/default/mcp/server_a",
            "/api/memory/swarm",
            "/api/providers",
            "/api/providers/custom",
            "/api/providers/custom/custom_provider",
            "/api/config/global",
            "/api/gateway/restart",
            "/api/logs",
        ];
        #[cfg(target_os = "macos")]
        paths.push("/api/host/execute_applescript");
        #[cfg(target_os = "windows")]
        paths.push("/api/host/execute_powershell");
        paths.extend([
            "/api/host/execute_bash",
            "/api/host/execute_python",
            "/api/agents/default/delegate",
            "/api/agents/default/chat",
            "/api/agents/default/chat/stream",
            "/api/agents/default/tokens",
            "/api/agents/default/tokens/token_1",
        ]);

        let expected_len = if cfg!(target_os = "macos") || cfg!(target_os = "windows") {
            54
        } else {
            53
        };
        assert_eq!(
            paths.len(),
            expected_len,
            "Expected {} API routes on this platform",
            expected_len
        );

        let unique: HashSet<&str> = paths.iter().copied().collect();
        assert_eq!(
            unique.len(),
            paths.len(),
            "Duplicate routes found in route contract"
        );

        let app = build_api_router(empty_state());
        for path in paths {
            let req = Request::builder()
                .method(Method::PUT)
                .uri(path)
                .body(Body::empty())
                .expect("request should build");
            let resp = app
                .clone()
                .oneshot(req)
                .await
                .expect("router oneshot should succeed");
            assert_ne!(
                resp.status(),
                StatusCode::NOT_FOUND,
                "Route missing from router: {}",
                path
            );
        }
    }

    #[tokio::test]
    async fn chat_stream_accepts_verbose_reasoning_field() {
        let state = empty_state();
        let app = build_api_router(state);
        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/chat/stream",
            Some(serde_json::json!({
                "prompt": "test",
                "verbose_reasoning": true
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["success"], false);
        assert_eq!(json["error"], "Agent not found");
    }

    #[tokio::test]
    async fn install_skill_with_run_sh_only_succeeds() {
        let state = state_with_skills().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/install_skill",
            Some(serde_json::json!({
                "new_manifest_content": "name = \"test_skill\"\ndescription = \"Test\"\nversion = \"1.0.0\"",
                "new_run_sh": "#!/bin/sh\necho ok",
                "new_skill_md": "# Test"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    }

    #[tokio::test]
    async fn install_skill_with_run_ps1_only_succeeds() {
        let state = state_with_skills().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/install_skill",
            Some(serde_json::json!({
                "new_manifest_content": r#"name = "test_windows_skill"
description = "Windows only"
version = "1.0.0"
entrypoint = "run.ps1"
run_command = "powershell"
platform = "windows""#,
                "new_run_ps1": "$ErrorActionPreference = \"Stop\"\nWrite-Output \"ok\"",
                "new_skill_md": "# Windows Test"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    }

    #[tokio::test]
    async fn install_skill_with_both_scripts_succeeds() {
        let state = state_with_skills().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/install_skill",
            Some(serde_json::json!({
                "new_manifest_content": "name = \"test_cross\"\ndescription = \"Cross\"\nversion = \"1.0.0\"\nplatform = \"all\"",
                "new_run_sh": "#!/bin/sh\necho ok",
                "new_run_ps1": "$ErrorActionPreference = \"Stop\"\nWrite-Output \"ok\"",
                "new_skill_md": "# Cross"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    }

    #[tokio::test]
    async fn install_skill_with_neither_script_fails() {
        let state = state_with_skills().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/install_skill",
            Some(serde_json::json!({
                "new_manifest_content": "name = \"test\"\ndescription = \"Test\"\nversion = \"1.0.0\"",
                "new_skill_md": "# Test"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(false));
        let err = json.get("error").and_then(|v| v.as_str()).unwrap_or("");
        assert!(
            err.contains("run.sh") || err.contains("run.ps1"),
            "expected run.sh or run.ps1 in error: {}",
            err
        );
    }

    #[tokio::test]
    async fn create_skill_with_invalid_platform_returns_error() {
        let state = state_with_skills().await;
        let llm = crate::core::llm::LlmManager::new();
        {
            let mut reg = state.llm_registry.lock().await;
            reg.insert(
                "default".to_string(),
                std::sync::Arc::new(tokio::sync::RwLock::new(llm)),
            );
        }
        let app = build_api_router(state);

        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/create_skill",
            Some(serde_json::json!({
                "name": "test_skill",
                "description": "Test",
                "platform": "invalid_platform"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(false));
        let err = json.get("error").and_then(|v| v.as_str()).unwrap_or("");
        assert!(
            err.to_lowercase().contains("invalid platform"),
            "expected invalid platform in error: {}",
            err
        );
    }

    #[tokio::test]
    async fn mcp_get_returns_empty_when_no_servers() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app,
            Method::GET,
            "/api/agents/default/mcp",
            None,
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
        let servers = json.get("mcp_servers").and_then(|v| v.as_array()).unwrap();
        assert!(servers.is_empty());
    }

    #[tokio::test]
    async fn mcp_add_and_list_and_delete() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        // Add MCP server (npx is in default allowlist)
        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/mcp",
            Some(serde_json::json!({
                "name": "test_server",
                "command": "npx",
                "args": "-y @modelcontextprotocol/server-filesystem",
                "env": "{}"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK, "add failed: {:?}", json);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));

        // List
        let (status, json) = json_request(
            app.clone(),
            Method::GET,
            "/api/agents/default/mcp",
            None,
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let servers = json.get("mcp_servers").and_then(|v| v.as_array()).unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(
            servers[0].get("name").and_then(|v| v.as_str()),
            Some("test_server")
        );

        // Delete
        let (status, json) = json_request(
            app.clone(),
            Method::DELETE,
            "/api/agents/default/mcp/test_server",
            None,
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));

        // List again - empty
        let (status, json) = json_request(
            app,
            Method::GET,
            "/api/agents/default/mcp",
            None,
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let servers = json.get("mcp_servers").and_then(|v| v.as_array()).unwrap();
        assert!(servers.is_empty());
    }

    #[tokio::test]
    async fn mcp_add_rejects_empty_name_and_command() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/mcp",
            Some(serde_json::json!({
                "name": "",
                "command": "npx",
                "args": "[]",
                "env": "{}"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(false));
        assert!(json.get("error").is_some());

        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/mcp",
            Some(serde_json::json!({
                "name": "ok",
                "command": "",
                "args": "[]",
                "env": "{}"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(false));
    }

    #[tokio::test]
    async fn mcp_add_rejects_generic_server_name() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        for generic in ["default", "mcp", "server", "MCP"] {
            let (status, json) = json_request(
                app.clone(),
                Method::POST,
                "/api/agents/default/mcp",
                Some(serde_json::json!({
                    "name": generic,
                    "command": "npx",
                    "args": "[]",
                    "env": "{}"
                })),
                "test-internal-token",
            )
            .await;

            assert_eq!(status, StatusCode::OK, "generic name {}", generic);
            assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(false));
            assert!(
                json.get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .contains("generic"),
                "expected generic name error for {}",
                generic
            );
        }
    }

    #[tokio::test]
    async fn mcp_add_rejects_invalid_server_name() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/mcp",
            Some(serde_json::json!({
                "name": "bad name with spaces",
                "command": "npx",
                "args": "[]",
                "env": "{}"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(false));
        assert!(
            json.get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .contains("letters, numbers")
        );

        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/mcp",
            Some(serde_json::json!({
                "name": "ok_name-123",
                "command": "npx",
                "args": "[]",
                "env": "{}"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    }

    #[tokio::test]
    async fn mcp_add_rejects_disallowed_command() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/mcp",
            Some(serde_json::json!({
                "name": "bad_server",
                "command": "curl",
                "args": "[]",
                "env": "{}"
            })),
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(false));
        assert!(
            json.get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .contains("not allowed")
        );
    }

    #[tokio::test]
    async fn mcp_get_returns_error_for_nonexistent_agent() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app,
            Method::GET,
            "/api/agents/nonexistent_agent/mcp",
            None,
            "test-internal-token",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(false));
        assert_eq!(
            json.get("error").and_then(|v| v.as_str()),
            Some("Agent not found")
        );
    }

    #[tokio::test]
    async fn orchestrator_config_endpoints_exist_and_roundtrip() {
        let state = state_with_memory().await;
        let app = build_api_router(state.clone());

        let (status, _json) = json_request(
            app.clone(),
            Method::GET,
            "/api/agents/default/orchestrate/config",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/config",
            Some(serde_json::json!({
                "default_template_id": "tpl-a",
                "default_worker_mode": "mixed",
                "default_max_parallelism": 11,
                "default_retry_limit": 1,
                "default_failure_policy": "auto_replan",
                "default_merge_policy": "manual_approval",
                "parallelism_warn_threshold": 5
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    }

    #[tokio::test]
    async fn orchestrator_template_crud_endpoints_exist() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/templates",
            Some(serde_json::json!({
                "template_id": "tpl-kanban",
                "name": "Kanban",
                "description": "d",
                "default_worker_mode": "mixed",
                "default_max_parallelism": 9,
                "default_retry_limit": 1,
                "default_failure_policy": "auto_replan",
                "default_merge_policy": "manual_approval",
                "spawn_profiles": [{
                    "role": "builder",
                    "persona": "builder persona",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "runtime_type": "native",
                    "image_profile": "base"
                }]
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));

        let (status, _json) = json_request(
            app.clone(),
            Method::GET,
            "/api/agents/default/orchestrate/templates",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, _json) = json_request(
            app.clone(),
            Method::PATCH,
            "/api/agents/default/orchestrate/templates/tpl-kanban",
            Some(serde_json::json!({"name": "Kanban v2"})),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, _json) = json_request(
            app,
            Method::DELETE,
            "/api/agents/default/orchestrate/templates/tpl-kanban",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn orchestrator_job_endpoints_exist() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/jobs",
            Some(serde_json::json!({
                "prompt": "Do complex job",
                "worker_mode": "mixed",
                "existing_agents": ["default"],
                "ephemeral": {"count": 1},
                "max_parallelism": 7
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
        let job_id = json
            .get("job_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        assert!(!job_id.is_empty());

        let (status, json) = json_request(
            app.clone(),
            Method::GET,
            "/api/agents/default/orchestrate/jobs",
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));

        let (status, _json) = json_request(
            app.clone(),
            Method::GET,
            &format!("/api/agents/default/orchestrate/jobs/{}", job_id),
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, _json) = json_request(
            app.clone(),
            Method::GET,
            &format!("/api/agents/default/orchestrate/jobs/{}/workers", job_id),
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, _json) = json_request(
            app.clone(),
            Method::GET,
            &format!("/api/agents/default/orchestrate/jobs/{}/events", job_id),
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, _json) = json_request(
            app.clone(),
            Method::POST,
            &format!("/api/agents/default/orchestrate/jobs/{}/cancel", job_id),
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    // --- Phase 1: Real worker execution (TDD) ---

    /// Phase 1.3: Workers must NOT have simulated output. Real execution only.
    #[tokio::test]
    async fn phase1_workers_must_not_be_simulated() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/jobs",
            Some(serde_json::json!({
                "prompt": "Reply with OK",
                "worker_mode": "existing",
                "existing_agents": ["default"]
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let job_id = json
            .get("job_id")
            .and_then(|v| v.as_str())
            .expect("job_id in response")
            .to_string();

        // Poll until job completes (or timeout)
        for _ in 0..50 {
            let (_, job_json) = json_request(
                app.clone(),
                Method::GET,
                &format!("/api/agents/default/orchestrate/jobs/{}", job_id),
                None,
                "test-internal-token",
            )
            .await;
            let job_status = job_json
                .get("job")
                .and_then(|j| j.get("status"))
                .and_then(|s| s.as_str())
                .unwrap_or("");
            if job_status == "completed" || job_status == "failed" {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        let (_, workers_json) = json_request(
            app.clone(),
            Method::GET,
            &format!("/api/agents/default/orchestrate/jobs/{}/workers", job_id),
            None,
            "test-internal-token",
        )
        .await;
        let workers = workers_json
            .get("workers")
            .and_then(|w| w.as_array())
            .expect("workers array");
        assert!(!workers.is_empty(), "must have at least one worker");
        for w in workers {
            let output = w.get("output").and_then(|o| o.as_str()).unwrap_or("");
            assert!(
                !output.contains("simulated worker completion"),
                "worker output must not be simulated: got {:?}",
                output
            );
        }
    }

    /// Phase 1.2: POST /jobs/run blocks until completion and returns workers.
    #[tokio::test]
    async fn phase1_jobs_run_blocks_and_returns_workers() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/jobs/run",
            Some(serde_json::json!({
                "prompt": "Reply with OK",
                "worker_mode": "existing",
                "existing_agents": ["default"]
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "jobs/run must return 200: {:?}",
            json
        );
        let workers = json
            .get("workers")
            .and_then(|w| w.as_array())
            .expect("response must include workers array");
        assert!(!workers.is_empty(), "must have at least one worker");
    }

    // --- Phase 2: Ephemeral agent spawning (TDD) ---

    /// Phase 2: Ephemeral workers must actually run; output must NOT be "not yet implemented".
    #[tokio::test]
    async fn phase2_ephemeral_worker_must_not_return_not_implemented() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/jobs/run",
            Some(serde_json::json!({
                "prompt": "Reply with the word EPHEMERAL_OK",
                "worker_mode": "ephemeral",
                "ephemeral": {"count": 1}
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "jobs/run must return 200: {:?}",
            json
        );
        let workers = json
            .get("workers")
            .and_then(|w| w.as_array())
            .expect("response must include workers array");
        assert!(
            !workers.is_empty(),
            "must have at least one ephemeral worker"
        );
        for w in workers {
            let output = w.get("output").and_then(|o| o.as_str()).unwrap_or("");
            assert!(
                !output.contains("Ephemeral workers not yet implemented"),
                "ephemeral worker must run real execution, not return 'not implemented': got {:?}",
                output
            );
        }
    }

    // --- Phase 3: Phased execution, checker gate (TDD) ---

    /// Phase 3: When phases ["builder", "checker"] with 1 ephemeral per phase, workers run
    /// sequentially with roles from phases; response includes role per worker.
    #[tokio::test]
    async fn phase3_phased_execution_runs_builder_then_checker() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/jobs/run",
            Some(serde_json::json!({
                "prompt": "Reply with BUILDER_OUTPUT",
                "worker_mode": "ephemeral",
                "ephemeral": {"count": 2},
                "phases": ["builder", "checker"]
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "jobs/run must return 200: {:?}",
            json
        );
        let workers = json
            .get("workers")
            .and_then(|w| w.as_array())
            .expect("response must include workers array");
        assert!(
            workers.len() >= 2,
            "phased execution must produce at least 2 workers (builder + checker), got {}",
            workers.len()
        );
        // With phases, first worker has role builder, second has role checker
        let w0_role = workers[0]
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let w1_role = workers[1]
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert_eq!(
            w0_role, "builder",
            "first worker must have role 'builder' when phases [builder, checker]"
        );
        assert_eq!(
            w1_role, "checker",
            "second worker must have role 'checker' when phases [builder, checker]"
        );
    }

    /// Phase 3: When checker worker output contains CHECKS_FAILED, job must fail (success: false).
    #[tokio::test]
    async fn phase3_checker_checks_failed_fails_job() {
        let state = state_with_memory().await;

        // Create template with checker that returns CHECKS_FAILED (requires LLM to comply)
        {
            let reg = state.registry.lock().await;
            let mem_arc = reg.get("default").unwrap();
            let mem = mem_arc.lock().await;
            let tpl = crate::core::orchestrator::OrchestratorTemplate {
                template_id: "phase3-checker-fail".to_string(),
                name: "Phase3 Checker Fail".to_string(),
                description: "For testing CHECKS_FAILED gate".to_string(),
                default_worker_mode: Some(crate::core::orchestrator::WorkerMode::Ephemeral),
                default_max_parallelism: None,
                default_retry_limit: None,
                default_failure_policy: None,
                default_merge_policy: None,
                spawn_profiles: vec![crate::core::orchestrator::SpawnProfile {
                    role: "checker".to_string(),
                    persona: "You are a checker. Reply with exactly: CHECKS_FAILED".to_string(),
                    provider: "openai".to_string(),
                    model: "gpt-4o-mini".to_string(),
                    runtime_type: "native".to_string(),
                    image_profile: "base".to_string(),
                }],
            };
            mem.upsert_orchestrator_template(&tpl).await.unwrap();
        }

        let app = build_api_router(state);
        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/jobs/run",
            Some(serde_json::json!({
                "prompt": "Run checks",
                "worker_mode": "ephemeral",
                "ephemeral": {"count": 1},
                "phases": ["checker"],
                "template_id": "phase3-checker-fail"
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "jobs/run must return 200: {:?}",
            json
        );

        let success = json
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let empty: Vec<serde_json::Value> = vec![];
        let workers = json
            .get("workers")
            .and_then(|w| w.as_array())
            .unwrap_or(&empty);

        let checker_output = workers
            .first()
            .and_then(|w| w.get("output").and_then(|o| o.as_str()))
            .unwrap_or("");
        if checker_output.contains("CHECKS_FAILED") {
            assert!(
                !success,
                "when checker returns CHECKS_FAILED, job must fail (success: false)"
            );
        }
    }

    #[tokio::test]
    async fn orchestrator_stream_emits_done_event() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/jobs",
            Some(serde_json::json!({
                "prompt": "stream me",
                "worker_mode": "existing",
                "existing_agents": ["default"]
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let job_id = json
            .get("job_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        assert!(!job_id.is_empty());

        let req = Request::builder()
            .method(Method::GET)
            .uri(format!(
                "/api/agents/default/orchestrate/jobs/{}/stream",
                job_id
            ))
            .header("x-moxxy-internal-token", "test-internal-token")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let body = String::from_utf8_lossy(&bytes);
        assert!(body.contains("\"type\":\"done\""));
    }

    #[tokio::test]
    async fn orchestrator_start_with_missing_model_key_returns_failure_not_crash() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        let _ = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/templates",
            Some(serde_json::json!({
                "template_id": "tpl-missing-key",
                "name": "Missing key",
                "description": "d",
                "default_worker_mode": "ephemeral",
                "spawn_profiles": [{
                    "role": "builder",
                    "persona": "builder",
                    "provider": "google",
                    "model": "gemini-2.5-flash",
                    "runtime_type": "native",
                    "image_profile": "base"
                }]
            })),
            "test-internal-token",
        )
        .await;

        let (status, json) = json_request(
            app,
            Method::POST,
            "/api/agents/default/orchestrate/jobs",
            Some(serde_json::json!({
                "prompt": "run with missing key",
                "template_id": "tpl-missing-key",
                "worker_mode": "ephemeral",
                "ephemeral": { "count": 1 }
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(false));
    }

    #[tokio::test]
    async fn orchestrator_full_e2e_lifecycle_flow() {
        let state = state_with_memory().await;
        let app = build_api_router(state);

        // 1) Provision provider key in agent vault (required by template spawn profile).
        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/vault",
            Some(serde_json::json!({
                "key": "openai_api_key",
                "value": "sk-test-e2e"
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));

        // 2) Configure orchestrator defaults for this agent.
        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/config",
            Some(serde_json::json!({
                "default_template_id": "tpl-e2e",
                "default_worker_mode": "mixed",
                "default_max_parallelism": 6,
                "default_retry_limit": 1,
                "default_failure_policy": "auto_replan",
                "default_merge_policy": "manual_approval",
                "parallelism_warn_threshold": 2
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));

        // 3) Create a template with an ephemeral spawn profile.
        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/templates",
            Some(serde_json::json!({
                "template_id": "tpl-e2e",
                "name": "E2E Template",
                "description": "full lifecycle test",
                "default_worker_mode": "mixed",
                "default_max_parallelism": 6,
                "default_retry_limit": 1,
                "default_failure_policy": "auto_replan",
                "default_merge_policy": "manual_approval",
                "spawn_profiles": [{
                    "role": "builder",
                    "persona": "build persona",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "runtime_type": "native",
                    "image_profile": "base"
                }]
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));

        // 4) Start a mixed-mode job (existing + ephemeral workers).
        let (status, json) = json_request(
            app.clone(),
            Method::POST,
            "/api/agents/default/orchestrate/jobs",
            Some(serde_json::json!({
                "prompt": "Build a taskee orchestrator e2e",
                "template_id": "tpl-e2e",
                "worker_mode": "mixed",
                "existing_agents": ["default"],
                "ephemeral": {"count": 2},
                "max_parallelism": 6
            })),
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
        let job_id = json
            .get("job_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        assert!(!job_id.is_empty());

        // 5) Job is queryable and reaches terminal state (poll for completion; job runs in background).
        for _ in 0..80 {
            let (status, json) = json_request(
                app.clone(),
                Method::GET,
                &format!("/api/agents/default/orchestrate/jobs/{}", job_id),
                None,
                "test-internal-token",
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            let job_status = json
                .get("job")
                .and_then(|j| j.get("status"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if matches!(job_status, "completed" | "failed") {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        // 6) Workers are persisted with stable IDs.
        let (status, json) = json_request(
            app.clone(),
            Method::GET,
            &format!("/api/agents/default/orchestrate/jobs/{}/workers", job_id),
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let workers = json
            .get("workers")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            workers.len() >= 2,
            "expected at least 2 workers, got {}",
            workers.len()
        );
        let worker_ids_first: Vec<String> = workers
            .iter()
            .filter_map(|w| w.get("worker_run_id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect();
        assert!(worker_ids_first.len() >= 2);

        let (status, json) = json_request(
            app.clone(),
            Method::GET,
            &format!("/api/agents/default/orchestrate/jobs/{}/workers", job_id),
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let workers_second = json
            .get("workers")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let worker_ids_second: Vec<String> = workers_second
            .iter()
            .filter_map(|w| w.get("worker_run_id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect();
        assert_eq!(worker_ids_first, worker_ids_second);

        // 7) Events include advisory + done and are queryable.
        let (status, json) = json_request(
            app.clone(),
            Method::GET,
            &format!("/api/agents/default/orchestrate/jobs/{}/events", job_id),
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let events = json
            .get("events")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(!events.is_empty());
        let event_types: Vec<String> = events
            .iter()
            .filter_map(|e| e.get("event_type").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect();
        assert!(event_types.iter().any(|t| t == "advisory"));
        assert!(event_types.iter().any(|t| t == "done"));

        // 8) Stream endpoint emits the full terminal stream including done.
        let req = Request::builder()
            .method(Method::GET)
            .uri(format!(
                "/api/agents/default/orchestrate/jobs/{}/stream",
                job_id
            ))
            .header("x-moxxy-internal-token", "test-internal-token")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let body = String::from_utf8_lossy(&bytes);
        assert!(body.contains("\"type\":\"advisory\""));
        assert!(body.contains("\"type\":\"done\""));

        // 9) Merge approval action stays callable and returns success.
        let (status, json) = json_request(
            app,
            Method::POST,
            &format!(
                "/api/agents/default/orchestrate/jobs/{}/actions/approve-merge",
                job_id
            ),
            None,
            "test-internal-token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    }
}
