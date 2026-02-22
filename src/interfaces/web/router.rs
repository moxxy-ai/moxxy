use axum::{
    Router,
    routing::{get, post},
};
use tower_http::cors::CorsLayer;

use super::AppState;
use super::handlers::{
    agents, channels, chat, config, mcp, memory, mobile, proxy, schedules, skills, vault, webhooks,
};

pub fn build_api_router(state: AppState) -> Router {
    Router::new()
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
        .route("/api/logs", get(super::sse_logs_endpoint))
        .route(
            "/api/host/execute_applescript",
            post(proxy::execute_applescript),
        )
        .route("/api/host/execute_bash", post(proxy::execute_bash))
        .route("/api/host/execute_python", post(proxy::execute_python))
        .route(
            "/api/webhooks/{agent}/{event_source}",
            post(webhooks::webhook_endpoint),
        )
        .route(
            "/api/agents/{agent}/delegate",
            post(webhooks::delegate_endpoint),
        )
        .route("/api/agents/{agent}/chat", post(chat::chat_endpoint))
        .route(
            "/api/agents/{agent}/chat/stream",
            post(chat::chat_stream_endpoint),
        )
        .layer(CorsLayer::permissive())
        .with_state(state)
}
