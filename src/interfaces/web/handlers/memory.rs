use axum::{Json, extract::{Path, Query, State}};

use super::super::AppState;

pub async fn get_short_term_memory(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let m = mem_mutex.lock().await;
        let content = m
            .read_short_term_memory()
            .await
            .unwrap_or_else(|_| "Failed to read STM".to_string());
        Json(serde_json::json!({ "content": content }))
    } else {
        Json(serde_json::json!({ "content": "Agent not found" }))
    }
}

pub async fn get_swarm_memory(State(state): State<AppState>) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    // Since swarm memory is conceptually global but isolated by DB, we can default to the `default` agent's view.
    let mem_mutex = reg.get("default").or_else(|| reg.values().next());
    if let Some(mem_mutex) = mem_mutex {
        let m = mem_mutex.lock().await;
        let records = m.read_swarm_memory(50).await.unwrap_or_default();
        Json(serde_json::json!({ "records": records }))
    } else {
        Json(serde_json::json!({ "records": [] }))
    }
}

#[derive(serde::Deserialize)]
pub struct SessionMessagesQuery {
    after: Option<i64>,
    limit: Option<usize>,
}

pub async fn get_session_messages(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<SessionMessagesQuery>,
) -> Json<serde_json::Value> {
    let after = query.after.unwrap_or(0).max(0);
    let limit = query.limit.unwrap_or(200).clamp(1, 500);

    let reg = state.registry.lock().await;
    if let Some(mem_mutex) = reg.get(&agent) {
        let mem = mem_mutex.lock().await;
        match mem.read_stm_structured_since(after, limit, true).await {
            Ok(messages) => Json(serde_json::json!({ "success": true, "messages": messages })),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
