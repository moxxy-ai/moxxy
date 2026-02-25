use axum::{
    Json,
    extract::{Path, State},
};

use crate::core::llm::registry::ProviderRegistry;

use super::super::AppState;

pub async fn get_providers_endpoint() -> Json<serde_json::Value> {
    let registry = ProviderRegistry::load();
    Json(serde_json::json!({
        "success": true,
        "providers": registry.providers.iter().map(|p| {
            serde_json::json!({
                "id": p.id,
                "name": p.name,
                "default_model": p.default_model,
                "custom": p.custom,
                "vault_key": p.auth.vault_key,
                "base_url": p.base_url,
                "models": p.models.iter().map(|m| {
                    serde_json::json!({ "id": m.id, "name": m.name })
                }).collect::<Vec<_>>()
            })
        }).collect::<Vec<_>>()
    }))
}

pub async fn get_custom_providers_endpoint() -> Json<serde_json::Value> {
    let registry = ProviderRegistry::load();
    let custom: Vec<_> = registry.custom_providers().into_iter().cloned().collect();
    Json(serde_json::json!({ "success": true, "providers": custom }))
}

pub async fn add_custom_provider_endpoint(
    Json(payload): Json<crate::core::llm::registry::ProviderDef>,
) -> Json<serde_json::Value> {
    match ProviderRegistry::add_custom_provider(payload) {
        Ok(()) => Json(
            serde_json::json!({ "success": true, "message": "Custom provider added. Restart agents to use it." }),
        ),
        Err(e) => Json(serde_json::json!({ "success": false, "error": e })),
    }
}

pub async fn delete_custom_provider_endpoint(
    Path(provider_id): Path<String>,
) -> Json<serde_json::Value> {
    match ProviderRegistry::remove_custom_provider(&provider_id) {
        Ok(()) => {
            Json(serde_json::json!({ "success": true, "message": "Custom provider removed." }))
        }
        Err(e) => Json(serde_json::json!({ "success": false, "error": e })),
    }
}

pub async fn get_llm_info(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let llm_reg = state.llm_registry.lock().await;
    if let Some(llm_mutex) = llm_reg.get(&agent) {
        let llm = llm_mutex.read().await;
        let (provider, model) = llm.get_active_info();
        Json(serde_json::json!({
            "success": true,
            "provider": provider,
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
    let registry = ProviderRegistry::load();
    let normalized = payload.provider.to_lowercase();
    if registry.get_provider(&normalized).is_none() {
        let supported: Vec<&str> = registry.providers.iter().map(|p| p.name.as_str()).collect();
        return Json(
            serde_json::json!({ "success": false, "error": format!("Unknown provider. Supported: {}", supported.join(", ")) }),
        );
    }

    // Update runtime
    let llm_reg = state.llm_registry.lock().await;
    if let Some(llm_mutex) = llm_reg.get(&agent) {
        let mut llm = llm_mutex.write().await;
        llm.set_active(&normalized, payload.model.clone());
    } else {
        return Json(serde_json::json!({ "success": false, "error": "Agent not found" }));
    }
    drop(llm_reg);

    // Persist to vault
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());
        let _ = vault.set_secret("llm_default_provider", &normalized).await;
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
