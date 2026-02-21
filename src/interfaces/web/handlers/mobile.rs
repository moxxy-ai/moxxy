use axum::{
    Json,
    extract::{Path, State},
};

use super::super::AppState;

pub async fn pair_mobile_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        let vault = crate::core::vault::SecretsVault::new(mem.get_db());

        // Generate a high entropy 256-bit equivalent string using two UUIDv4s
        let token =
            format!("MX_MOB_{}_{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4()).replace("-", "");

        match vault.set_secret("mobile_key", &token).await {
            Ok(_) => {
                // In a real environment, the host would be derived dynamically.
                let qr_payload = format!("moxxy://pair?host=wss://localhost:3003&key={}", token);
                Json(serde_json::json!({ "success": true, "key": token, "qr_payload": qr_payload }))
            }
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
