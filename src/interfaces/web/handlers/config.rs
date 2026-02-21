use axum::{
    Json,
    extract::{Path, State},
};

use super::super::AppState;

pub async fn get_llm_info(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let llm_reg = state.llm_registry.lock().await;
    if let Some(llm_mutex) = llm_reg.get(&agent) {
        let llm = llm_mutex.lock().await;
        let (provider, model) = llm.get_active_info();
        Json(serde_json::json!({
            "success": true,
            "provider": provider.map(|p| format!("{:?}", p)),
            "model": model
        }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct SetLlmRequest {
    provider: String,
    model: String,
}

pub async fn set_llm_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<SetLlmRequest>,
) -> Json<serde_json::Value> {
    let p_type = match payload.provider.to_lowercase().as_str() {
        "openai" => crate::core::llm::ProviderType::OpenAI,
        "google" => crate::core::llm::ProviderType::Google,
        "z.ai" | "zai" => crate::core::llm::ProviderType::ZAi,
        _ => {
            return Json(
                serde_json::json!({ "success": false, "error": "Unknown provider. Supported: OpenAI, Google, ZAi" }),
            );
        }
    };

    // Update runtime
    let llm_reg = state.llm_registry.lock().await;
    if let Some(llm_mutex) = llm_reg.get(&agent) {
        let mut llm = llm_mutex.lock().await;
        llm.set_active(p_type, payload.model.clone());
    } else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    }
    drop(llm_reg);

    // Persist to vault
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let _ = vault
            .set_secret("llm_default_provider", &payload.provider)
            .await;
        let _ = vault.set_secret("llm_default_model", &payload.model).await;
    }

    Json(
        serde_json::json!({ "success": true, "message": format!("LLM set to {} / {}", payload.provider, payload.model) }),
    )
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct GlobalConfig {
    gateway_host: String,
    gateway_port: u16,
    web_ui_port: u16,
}

pub async fn get_global_config_endpoint(State(state): State<AppState>) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get("default") {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());

        let host = vault
            .get_secret("gateway_host")
            .await
            .unwrap_or(None)
            .unwrap_or_else(|| state.api_host.clone());
        let port = vault
            .get_secret("gateway_port")
            .await
            .unwrap_or(None)
            .and_then(|p| p.parse().ok())
            .unwrap_or(state.api_port);
        let web_port = vault
            .get_secret("web_ui_port")
            .await
            .unwrap_or(None)
            .and_then(|p| p.parse().ok())
            .unwrap_or(state.web_port);

        Json(serde_json::json!({
            "success": true,
            "gateway_host": host,
            "gateway_port": port,
            "web_ui_port": web_port
        }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Default agent not found" }))
    }
}

pub async fn set_global_config_endpoint(
    State(state): State<AppState>,
    Json(payload): Json<GlobalConfig>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get("default") {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());

        if let Err(e) = vault
            .set_secret("gateway_host", &payload.gateway_host)
            .await
        {
            return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
        }
        if let Err(e) = vault
            .set_secret("gateway_port", &payload.gateway_port.to_string())
            .await
        {
            return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
        }
        if let Err(e) = vault
            .set_secret("web_ui_port", &payload.web_ui_port.to_string())
            .await
        {
            return Json(serde_json::json!({ "success": false, "error": e.to_string() }));
        }

        Json(
            serde_json::json!({ "success": true, "message": "Global configuration saved. Restart the gateway to apply changes." }),
        )
    } else {
        Json(serde_json::json!({ "success": false, "error": "Default agent not found" }))
    }
}

pub async fn restart_gateway_endpoint() -> Json<serde_json::Value> {
    // Spawn the moxxy binary to perform gateway restart (stop + start),
    // then exit the current process so the new one takes over.
    match std::env::current_exe() {
        Ok(exe) => {
            // Spawn "moxxy gateway restart" in background
            match std::process::Command::new(&exe)
                .arg("gateway")
                .arg("restart")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
            {
                Ok(_) => {
                    // Give the response time to flush before we die
                    tokio::spawn(async {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        std::process::exit(0);
                    });
                    Json(serde_json::json!({ "success": true, "message": "Gateway restarting..." }))
                }
                Err(e) => Json(
                    serde_json::json!({ "success": false, "error": format!("Failed to spawn restart: {}", e) }),
                ),
            }
        }
        Err(e) => Json(
            serde_json::json!({ "success": false, "error": format!("Cannot find executable: {}", e) }),
        ),
    }
}
