use axum::{
    Json,
    extract::{Path, State},
};

use super::super::AppState;
use super::channels::find_agent_with_secret_value;

pub async fn get_agents(State(state): State<AppState>) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    let agents: Vec<String> = reg.keys().cloned().collect();
    Json(serde_json::json!({ "agents": agents }))
}

#[derive(serde::Deserialize)]
pub struct CreateAgentRequest {
    name: String,
    description: String,
    telegram_token: Option<String>,
    /// "native" (default) or "wasm"
    runtime_type: Option<String>,
    /// WASM image profile: "base", "networked", or "full"
    image_profile: Option<String>,
}

pub async fn create_agent_endpoint(
    State(state): State<AppState>,
    Json(payload): Json<CreateAgentRequest>,
) -> Json<serde_json::Value> {
    let name = payload.name;

    let home = dirs::home_dir().expect("Could not find home directory");
    let agents_dir = home.join(".moxxy").join("agents");
    let agent_workspace = agents_dir.join(&name);

    if agent_workspace.exists() {
        return Json(serde_json::json!({ "success": false, "error": "Agent already exists" }));
    }

    if let Err(e) = tokio::fs::create_dir_all(agent_workspace.join("skills"))
        .await
        .and(tokio::fs::create_dir_all(agent_workspace.join("workspace")).await)
    {
        return Json(
            serde_json::json!({ "success": false, "error": format!("Failed creating dirs: {}", e) }),
        );
    }

    if let Err(e) = tokio::fs::write(agent_workspace.join("persona.md"), &payload.description).await
    {
        return Json(
            serde_json::json!({ "success": false, "error": format!("Failed saving persona: {}", e) }),
        );
    }

    // Initialize Memory System to set secrets
    let memory_sys = match crate::core::memory::MemorySystem::new(&agent_workspace).await {
        Ok(m) => m,
        Err(e) => {
            return Json(
                serde_json::json!({ "success": false, "error": format!("Failed creating memory: {}", e) }),
            );
        }
    };

    {
        let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
        if let Err(e) = vault.initialize().await {
            return Json(
                serde_json::json!({ "success": false, "error": format!("Failed init vault: {}", e) }),
            );
        }
        if let Some(token) = payload.telegram_token
            && !token.is_empty()
        {
            if let Some(owner) =
                find_agent_with_secret_value(&state, "telegram_token", &token, &name).await
            {
                return Json(serde_json::json!({
                    "success": false,
                    "error": format!(
                        "This Telegram bot token is already bound to agent '{}'. One Telegram channel can only be bound to one agent.",
                        owner
                    )
                }));
            }
            let _ = vault.set_secret("telegram_token", &token).await;
        }

        // Inherit Master/Default LLM Configuration -- try 'default', then fallback to any existing agent
        let reg = state.registry.lock().await;
        let source_agent = reg.get("default").or_else(|| reg.values().next()).cloned();
        drop(reg);

        if let Some(source_mem) = source_agent {
            let source_db = source_mem.lock().await.get_db();
            let global_vault = crate::core::vault::SecretsVault::new(source_db);
            let keys_to_copy = [
                "llm_default_provider",
                "llm_default_model",
                "openai_api_key",
                "google_api_key",
                "zai_api_key",
            ];
            for key in keys_to_copy.iter() {
                match global_vault.get_secret(key).await {
                    Ok(Some(val)) => {
                        tracing::info!("Copying {} to new agent vault", key);
                        if let Err(e) = vault.set_secret(key, &val).await {
                            tracing::error!("Failed to set secret {}: {}", key, e);
                        }
                    }
                    Ok(None) => tracing::warn!("Key {} not found in source vault", key),
                    Err(e) => tracing::error!("Failed to read {} from source vault: {}", key, e),
                }
            }
        } else {
            tracing::warn!(
                "No existing agents found to inherit LLM configuration from. New agent will need manual configuration."
            );
        }
    }
    drop(memory_sys);

    // Write container.toml if runtime_type is wasm
    let runtime = payload.runtime_type.as_deref().unwrap_or("native");
    if runtime == "wasm" {
        let profile = payload.image_profile.as_deref().unwrap_or("base");
        let caps = crate::core::container::ImageProfile::default_capabilities(profile);
        let fs_list: Vec<String> = caps
            .filesystem
            .iter()
            .map(|p| format!("\"{}\"", p))
            .collect();
        let container_toml = format!(
            "[runtime]\ntype = \"wasm\"\nimage = \"agent_runtime.wasm\"\n\n[capabilities]\nfilesystem = [{}]\nnetwork = {}\nmax_memory_mb = {}\nenv_inherit = {}\n",
            fs_list.join(", "),
            caps.network,
            caps.max_memory_mb,
            caps.env_inherit
        );
        if let Err(e) =
            tokio::fs::write(agent_workspace.join("container.toml"), container_toml).await
        {
            tracing::error!("Failed to write container.toml: {}", e);
        } else {
            tracing::info!(
                "Wrote container.toml for WASM agent '{}' with profile '{}'",
                name,
                profile
            );
        }

        // Provision the embedded WASM image to ~/.moxxy/images/
        if let Err(e) = crate::core::container::ensure_wasm_image().await {
            tracing::error!("Failed to provision WASM image: {}", e);
        }
    }

    // Boot dynamically
    let rm = state.run_mode.clone();
    let reg_clone = state.registry.clone();
    let skill_reg_clone = state.skill_registry.clone();
    let llm_reg_clone = state.llm_registry.clone();
    let container_reg_clone = state.container_registry.clone();
    let scheduler_reg_clone = state.scheduler_registry.clone();
    let scheduled_job_reg_clone = state.scheduled_job_registry.clone();
    let log_tx_clone = state.log_tx.clone();
    let agent_name = name.clone();
    let api_host_clone = state.api_host.clone();
    let api_port = state.api_port;
    let web_port = state.web_port;

    tokio::spawn(async move {
        match crate::core::agent::AgentInstance::boot(
            agent_name.clone(),
            agent_workspace,
            rm,
            api_host_clone,
            api_port,
            web_port,
            reg_clone,
            skill_reg_clone,
            llm_reg_clone,
            container_reg_clone,
            scheduler_reg_clone,
            scheduled_job_reg_clone,
            log_tx_clone,
            state.internal_token.clone(),
        )
        .await
        {
            Ok(agent) => {
                if let Err(e) = agent.run().await {
                    tracing::error!("Dynamically spawned agent {} crashed: {}", agent_name, e);
                }
            }
            Err(e) => tracing::error!(
                "Failed to boot dynamically spawned agent {}: {}",
                agent_name,
                e
            ),
        }
    });

    Json(
        serde_json::json!({ "success": true, "message": format!("Agent {} provisioned and booted successfully", name) }),
    )
}

pub async fn delete_agent_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    if agent == "default" {
        return Json(
            serde_json::json!({ "success": false, "error": "Cannot delete the default agent." }),
        );
    }

    // Remove from all registries
    state.registry.lock().await.remove(&agent);
    state.skill_registry.lock().await.remove(&agent);
    state.llm_registry.lock().await.remove(&agent);
    state.container_registry.lock().await.remove(&agent);
    state.scheduler_registry.lock().await.remove(&agent);
    state.scheduled_job_registry.lock().await.remove(&agent);

    // Delete workspace directory
    let home = dirs::home_dir().expect("home dir");
    let agent_dir = home.join(".moxxy").join("agents").join(&agent);
    if agent_dir.exists()
        && let Err(e) = tokio::fs::remove_dir_all(&agent_dir).await
    {
        return Json(
            serde_json::json!({ "success": false, "error": format!("Removed from registries but failed to delete files: {}", e) }),
        );
    }

    Json(serde_json::json!({ "success": true, "message": format!("Agent '{}' deleted.", agent) }))
}

pub async fn restart_agent_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    // "Restart" clears the agent's STM session so it starts fresh.
    // A full process-level restart requires gateway restart.
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mut mem = mem_mutex.lock().await;
        let _ = mem.new_session();
        Json(
            serde_json::json!({ "success": true, "message": format!("Agent '{}' session restarted. Short-term memory cleared.", agent) }),
        )
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
