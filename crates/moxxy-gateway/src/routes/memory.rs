use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use moxxy_core::{CompactionConfig, EligibleEntry, MemoryCompactor};
use moxxy_types::{EventEnvelope, EventType, TokenScope};
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct MemorySearchParams {
    pub q: Option<String>,
    pub tags: Option<String>,
}

pub async fn search_memory(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
    Query(params): Query<MemorySearchParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsRead)?;

    let db = state.db.lock().unwrap();

    // Verify agent exists
    db.agents()
        .find_by_id(&agent_id)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
            )
        })?;

    // Get all memory records for this agent
    let records = db.memory().find_by_agent(&agent_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": "Database error"})),
        )
    })?;

    // Filter by query string (substring match on markdown_path and tags)
    let query = params.q.unwrap_or_default().to_lowercase();
    let tag_filter: Vec<String> = params
        .tags
        .map(|t| t.split(',').map(|s| s.trim().to_lowercase()).collect())
        .unwrap_or_default();

    let filtered: Vec<serde_json::Value> = records
        .iter()
        .filter(|r| {
            if !query.is_empty() {
                let path_match = r.markdown_path.to_lowercase().contains(&query);
                let tags_match = r
                    .tags_json
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&query);
                if !path_match && !tags_match {
                    return false;
                }
            }
            if !tag_filter.is_empty() {
                let record_tags = r.tags_json.as_deref().unwrap_or("").to_lowercase();
                if !tag_filter.iter().any(|t| record_tags.contains(t)) {
                    return false;
                }
            }
            true
        })
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "agent_id": r.agent_id,
                "markdown_path": r.markdown_path,
                "tags": r.tags_json,
                "chunk_hash": r.chunk_hash,
                "status": r.status,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!(filtered)))
}

pub async fn compact_memory(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::AgentsWrite)?;

    let (records, workspace_root) = {
        let db = state.db.lock().unwrap();

        // Verify agent exists and get workspace_root
        let agent = db
            .agents()
            .find_by_id(&agent_id)
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "internal", "message": "Database error"})),
                )
            })?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({"error": "not_found", "message": "Agent not found"})),
                )
            })?;

        let records = db.memory().find_by_agent(&agent_id).map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": "Database error"})),
            )
        })?;

        (records, agent.workspace_root)
    };

    // Emit compact started event
    state.event_bus.emit(EventEnvelope::new(
        agent_id.clone(),
        None,
        None,
        0,
        EventType::MemoryCompactStarted,
        serde_json::json!({
            "agent_id": agent_id,
            "total_entries": records.len(),
        }),
    ));

    // Convert MemoryIndexRow to EligibleEntry
    let eligible_entries: Vec<EligibleEntry> = records
        .iter()
        .map(|r| EligibleEntry {
            id: r.id.clone(),
            agent_id: r.agent_id.clone(),
            markdown_path: r.markdown_path.clone(),
            tags_json: r.tags_json.clone(),
            created_at: r.created_at.clone(),
            status: r.status.clone(),
        })
        .collect();

    let compactor = MemoryCompactor::new(CompactionConfig::default());
    let groups = compactor.find_eligible(&eligible_entries, chrono::Utc::now());

    let workspace = std::path::PathBuf::from(&workspace_root);
    let memory_dir = workspace.join(".moxxy").join("memory");
    let archive_dir = workspace.join(".moxxy").join("archive");

    let mut results = Vec::new();
    for (tag, entries) in &groups {
        match compactor
            .compact_group(entries, tag, &memory_dir, &archive_dir, None)
            .await
        {
            Ok(result) => {
                // Update status in DB for compacted entries
                let db = state.db.lock().unwrap();
                for entry in entries {
                    let _ = db.memory().update_status(&entry.id, "archived");
                }
                results.push(serde_json::json!({
                    "group_tag": result.group_tag,
                    "entries_compacted": result.entries_compacted,
                    "summary_path": result.summary_path,
                    "archived_count": result.archived_count,
                }));
            }
            Err(e) => {
                results.push(serde_json::json!({
                    "group_tag": tag,
                    "error": e.to_string(),
                }));
            }
        }
    }

    // Emit compact completed event
    state.event_bus.emit(EventEnvelope::new(
        agent_id.clone(),
        None,
        None,
        0,
        EventType::MemoryCompactCompleted,
        serde_json::json!({
            "agent_id": agent_id,
            "groups_processed": groups.len(),
            "results": results,
        }),
    ));

    Ok(Json(serde_json::json!({
        "compacted_groups": results.len(),
        "results": results,
    })))
}
