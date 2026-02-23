use axum::{
    Json,
    extract::{Path, State},
};

use super::super::AppState;

/// Default allowed MCP server commands. Users can extend this by creating
/// `~/.moxxy/allowed_mcp_commands.txt` with one command per line.
const DEFAULT_MCP_COMMANDS: &[&str] = &[
    "npx", "uvx", "node", "python", "python3", "docker", "deno", "bun",
];

fn is_mcp_command_allowed(command: &str) -> bool {
    let base_cmd = std::path::Path::new(command)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(command);

    if DEFAULT_MCP_COMMANDS.contains(&base_cmd) {
        return true;
    }

    // Check user-configured allowlist
    if let Some(home) = dirs::home_dir() {
        let allowlist_path = home.join(".moxxy").join("allowed_mcp_commands.txt");
        if let Ok(contents) = std::fs::read_to_string(&allowlist_path) {
            for line in contents.lines() {
                let line = line.trim();
                if !line.is_empty() && !line.starts_with('#') && line == base_cmd {
                    return true;
                }
            }
        }
    }

    false
}

fn allowed_commands_list() -> String {
    let mut cmds: Vec<String> = DEFAULT_MCP_COMMANDS.iter().map(|s| s.to_string()).collect();
    if let Some(home) = dirs::home_dir() {
        let allowlist_path = home.join(".moxxy").join("allowed_mcp_commands.txt");
        if let Ok(contents) = std::fs::read_to_string(&allowlist_path) {
            for line in contents.lines() {
                let line = line.trim();
                if !line.is_empty() && !line.starts_with('#') {
                    cmds.push(line.to_string());
                }
            }
        }
    }
    cmds.join(", ")
}

pub async fn get_mcp_servers_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;

    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        match mem.get_all_mcp_servers().await {
            Ok(servers) => Json(serde_json::json!({ "success": true, "mcp_servers": servers })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct AddMcpServerRequest {
    name: String,
    command: String,
    args: String,
    env: String,
}

pub async fn add_mcp_server_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<AddMcpServerRequest>,
) -> Json<serde_json::Value> {
    let server_name = payload.name.trim().to_string();
    let command = payload.command.trim().to_string();

    if server_name.is_empty() || command.is_empty() {
        return Json(serde_json::json!({
            "success": false,
            "error": "name and command are required"
        }));
    }

    if !is_mcp_command_allowed(&command) {
        return Json(serde_json::json!({
            "success": false,
            "error": format!(
                "Command '{}' is not allowed. Allowed: {}. Add custom commands to ~/.moxxy/allowed_mcp_commands.txt",
                command,
                allowed_commands_list()
            )
        }));
    }

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        match mem
            .add_mcp_server(&server_name, &command, &payload.args, &payload.env)
            .await
        {
            Ok(_) => Json(
                serde_json::json!({ "success": true, "message": "MCP Server added. Please reboot the agent to initialize it." }),
            ),
            Err(e) => Json(
                serde_json::json!({ "success": false, "error": format!("Database error: {}", e) }),
            ),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn delete_mcp_server_endpoint(
    Path((agent, server_name)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let server_name = server_name.trim().to_string();
    if server_name.is_empty() {
        return Json(serde_json::json!({
            "success": false,
            "error": "server name is required"
        }));
    }

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        match mem.remove_mcp_server(&server_name).await {
            Ok(true) => Json(
                serde_json::json!({ "success": true, "message": "MCP Server removed. Please reboot the agent to detach it." }),
            ),
            Ok(false) => {
                Json(serde_json::json!({ "success": false, "error": "MCP Server not found" }))
            }
            Err(e) => Json(
                serde_json::json!({ "success": false, "error": format!("Database error: {}", e) }),
            ),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
