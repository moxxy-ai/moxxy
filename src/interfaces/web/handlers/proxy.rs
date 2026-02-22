use axum::{Json, extract::State};

use super::super::AppState;
use crate::core::agent::RunMode;

#[derive(serde::Deserialize)]
pub struct AppleScriptRequest {
    script: String,
}

/// WARNING: This is the Host Proxy. It executes arbitrary AppleScript natively on the host macOS.
pub async fn execute_applescript(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<AppleScriptRequest>,
) -> Json<serde_json::Value> {
    if state.run_mode != RunMode::Dev {
        let auth_token = headers
            .get("X-Moxxy-Internal-Token")
            .and_then(|h| h.to_str().ok());
        if auth_token != Some(&state.internal_token) {
            return Json(
                serde_json::json!({ "success": false, "error": "401 Unauthorized: Host Proxy is disabled outside of Dev Mode." }),
            );
        }
    }
    match tokio::process::Command::new("osascript")
        .arg("-e")
        .arg(&payload.script)
        .output()
        .await
    {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Json(serde_json::json!({ "success": true, "output": stdout }))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                Json(serde_json::json!({ "success": false, "error": stderr }))
            }
        }
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

#[derive(serde::Deserialize)]
pub struct BashRequest {
    command: String,
    /// Optional working directory for the command.
    cwd: Option<String>,
}

/// WARNING: This is the Host Proxy handling arbitrary bash execution natively on the host macOS.
pub async fn execute_bash(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<BashRequest>,
) -> Json<serde_json::Value> {
    if state.run_mode != RunMode::Dev {
        let auth_token = headers
            .get("X-Moxxy-Internal-Token")
            .and_then(|h| h.to_str().ok());
        if auth_token != Some(&state.internal_token) {
            return Json(
                serde_json::json!({ "success": false, "error": "401 Unauthorized: Host Proxy is disabled outside of Dev Mode." }),
            );
        }
    }
    let mut cmd = tokio::process::Command::new("bash");
    cmd.arg("-c").arg(&payload.command);
    if let Some(ref cwd) = payload.cwd {
        cmd.current_dir(cwd);
    }
    match cmd.output().await {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Json(serde_json::json!({ "success": true, "output": stdout }))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Json(serde_json::json!({ "success": false, "error": stderr, "output": stdout }))
            }
        }
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

#[derive(serde::Deserialize)]
pub struct PythonRequest {
    code: String,
    /// Optional working directory for the command.
    cwd: Option<String>,
}

/// WARNING: This is the Host Proxy handling arbitrary python execution natively on the host macOS.
pub async fn execute_python(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PythonRequest>,
) -> Json<serde_json::Value> {
    if state.run_mode != RunMode::Dev {
        let auth_token = headers
            .get("X-Moxxy-Internal-Token")
            .and_then(|h| h.to_str().ok());
        if auth_token != Some(&state.internal_token) {
            return Json(
                serde_json::json!({ "success": false, "error": "401 Unauthorized: Host Proxy is disabled outside of Dev Mode." }),
            );
        }
    }
    let mut cmd = tokio::process::Command::new("python3");
    cmd.arg("-c").arg(&payload.code);
    if let Some(ref cwd) = payload.cwd {
        cmd.current_dir(cwd);
    }
    match cmd.output().await {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Json(serde_json::json!({ "success": true, "output": stdout }))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Json(serde_json::json!({ "success": false, "error": stderr, "output": stdout }))
            }
        }
        Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}
