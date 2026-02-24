use axum::{Json, extract::State};

use super::super::AppState;
use crate::platform::{NativePlatform, Platform};

#[derive(serde::Deserialize)]
pub struct AppleScriptRequest {
    script: String,
}

/// Validate that the internal token is present and correct.
/// Host proxy endpoints ALWAYS require authentication, regardless of run mode.
fn verify_internal_token(
    headers: &axum::http::HeaderMap,
    expected: &str,
) -> Result<(), Json<serde_json::Value>> {
    let auth_token = headers
        .get("X-Moxxy-Internal-Token")
        .and_then(|h| h.to_str().ok());
    if auth_token != Some(expected) {
        return Err(Json(
            serde_json::json!({ "success": false, "error": "401 Unauthorized: Internal token required for host proxy." }),
        ));
    }
    Ok(())
}

/// Validate that a cwd path is within the moxxy directory.
fn validate_cwd(cwd: &str) -> Result<(), Json<serde_json::Value>> {
    let cwd_path = std::path::Path::new(cwd);
    let canonical = cwd_path.canonicalize().map_err(|_| {
        Json(serde_json::json!({
            "success": false,
            "error": "403 Forbidden: cwd path does not exist or cannot be resolved."
        }))
    })?;
    let home = dirs::home_dir().expect("Could not find home directory");
    let moxxy_dir = home.join(".moxxy");
    if !canonical.starts_with(&moxxy_dir) {
        return Err(Json(
            serde_json::json!({ "success": false, "error": "403 Forbidden: cwd must be within the moxxy directory." }),
        ));
    }
    Ok(())
}

/// WARNING: This is the Host Proxy. It executes arbitrary AppleScript natively on the host macOS.
pub async fn execute_applescript(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<AppleScriptRequest>,
) -> Json<serde_json::Value> {
    if let Err(e) = verify_internal_token(&headers, &state.internal_token) {
        return e;
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
    if let Err(e) = verify_internal_token(&headers, &state.internal_token) {
        return e;
    }
    let mut cmd = NativePlatform::shell_inline(&payload.command);
    if let Some(ref cwd) = payload.cwd {
        if let Err(e) = validate_cwd(cwd) {
            return e;
        }
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
    if let Err(e) = verify_internal_token(&headers, &state.internal_token) {
        return e;
    }
    let mut cmd = tokio::process::Command::new("python3");
    cmd.arg("-c").arg(&payload.code);
    if let Some(ref cwd) = payload.cwd {
        if let Err(e) = validate_cwd(cwd) {
            return e;
        }
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
