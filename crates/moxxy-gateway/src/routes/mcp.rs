use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use moxxy_mcp::{McpClient, load_mcp_config, save_mcp_config};
use moxxy_types::TokenScope;
use moxxy_types::mcp::McpServerConfig;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

pub async fn list_mcp_servers(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let agent_dir = state.moxxy_home.join("agents").join(&name);
    let config = load_mcp_config(&agent_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )
    })?;

    let servers: Vec<serde_json::Value> = config
        .servers
        .iter()
        .map(|s| {
            serde_json::json!({
                "id": s.id,
                "transport": s.transport,
                "enabled": s.enabled,
                "command": s.command,
                "args": s.args,
                "url": s.url,
                "headers": s.headers.keys().map(|k| (k.clone(), "***".to_string())).collect::<std::collections::HashMap<_,_>>(),
                "env": s.env.keys().map(|k| (k.clone(), "***".to_string())).collect::<std::collections::HashMap<_,_>>(),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({ "servers": servers })))
}

pub async fn add_mcp_server(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(name): Path<String>,
    Json(body): Json<McpServerConfig>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    body.validate().map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "validation", "message": e})),
        )
    })?;

    let agent_dir = state.moxxy_home.join("agents").join(&name);
    if !agent_dir.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
        ));
    }

    let mut config = load_mcp_config(&agent_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )
    })?;

    if config.servers.iter().any(|s| s.id == body.id) {
        return Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "conflict",
                "message": format!("MCP server '{}' already exists", body.id)
            })),
        ));
    }

    config.servers.push(body.clone());

    save_mcp_config(&agent_dir, &config).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )
    })?;

    tracing::info!(agent = %name, server_id = %body.id, "MCP server added");

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": body.id,
            "transport": body.transport,
            "enabled": body.enabled,
            "command": body.command,
            "args": body.args,
            "url": body.url,
            "headers": body.headers.keys().collect::<Vec<_>>(),
            "env": body.env.keys().collect::<Vec<_>>(),
        })),
    ))
}

pub async fn remove_mcp_server(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((name, server_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let agent_dir = state.moxxy_home.join("agents").join(&name);
    let mut config = load_mcp_config(&agent_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )
    })?;

    let original_len = config.servers.len();
    config.servers.retain(|s| s.id != server_id);

    if config.servers.len() == original_len {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not_found", "message": "MCP server not found"})),
        ));
    }

    save_mcp_config(&agent_dir, &config).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )
    })?;

    tracing::info!(agent = %name, server_id = %server_id, "MCP server removed");

    Ok(Json(serde_json::json!({
        "message": "MCP server removed",
        "server_id": server_id
    })))
}

pub async fn test_mcp_server(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path((name, server_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let agent_dir = state.moxxy_home.join("agents").join(&name);
    let config = load_mcp_config(&agent_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )
    })?;

    let server_config = config
        .servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not_found", "message": "MCP server not found"})),
            )
        })?;

    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let client = McpClient::connect(server_config).await?;
        let tools: Vec<String> = client.tools().iter().map(|t| t.name.clone()).collect();
        client.shutdown().await?;
        Ok::<_, moxxy_mcp::McpError>(tools)
    })
    .await;

    match result {
        Ok(Ok(tools)) => Ok(Json(serde_json::json!({
            "status": "ok",
            "server_id": server_id,
            "tools": tools,
        }))),
        Ok(Err(e)) => Ok(Json(serde_json::json!({
            "status": "error",
            "server_id": server_id,
            "error": e.to_string(),
        }))),
        Err(_) => Ok(Json(serde_json::json!({
            "status": "error",
            "server_id": server_id,
            "error": "Connection timed out after 10 seconds",
        }))),
    }
}
