use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use moxxy_core::RedactionEngine;
use moxxy_types::{EventType, TokenScope};
use std::collections::HashSet;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(serde::Deserialize, Default)]
pub struct EventStreamParams {
    pub agent_id: Option<String>,
    pub run_id: Option<String>,
}

pub async fn event_stream(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Query(params): Query<EventStreamParams>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::EventsRead)?;

    tracing::info!(agent_id = ?params.agent_id, run_id = ?params.run_id, "SSE event stream connected");

    let mut rx = state.event_bus.subscribe();
    let db = state.db.clone();
    let vault_backend = state.vault_backend.clone();

    let stream = async_stream::stream! {
        yield Ok::<_, Infallible>(Event::default().comment("connected"));

        // Track known sub-agent IDs so their events pass the filter
        let mut sub_agent_ids: HashSet<String> = HashSet::new();

        loop {
            match rx.recv().await {
                Ok(mut envelope) => {
                    if let Some(ref filter_agent) = params.agent_id {
                        let is_parent = &envelope.agent_id == filter_agent;
                        let is_child = sub_agent_ids.contains(&envelope.agent_id);
                        if !is_parent && !is_child {
                            continue;
                        }
                        // Track new sub-agents from SubagentSpawned events on the parent
                        if is_parent && envelope.event_type == EventType::SubagentSpawned
                            && let Some(child_id) = envelope.payload.get("sub_agent_id").and_then(|v| v.as_str())
                        {
                            sub_agent_ids.insert(child_id.to_string());
                        }
                    }
                    if let Some(ref filter_run) = params.run_id {
                        match &envelope.run_id {
                            Some(run_id) if run_id == filter_run => {}
                            _ => continue,
                        }
                    }

                    // Apply RedactionEngine before serializing (same logic as event persistence)
                    let secrets: Vec<String> = {
                        let db_guard = db.lock().ok();
                        if let Some(ref db_ref) = db_guard {
                            let grants = db_ref
                                .vault_grants()
                                .find_by_agent(&envelope.agent_id)
                                .unwrap_or_default();
                            let active_grants: Vec<_> =
                                grants.iter().filter(|g| g.revoked_at.is_none()).collect();
                            active_grants
                                .iter()
                                .filter_map(|g| {
                                    db_ref
                                        .vault_refs()
                                        .find_by_id(&g.secret_ref_id)
                                        .ok()
                                        .flatten()
                                })
                                .filter_map(|r| vault_backend.get_secret(&r.backend_key).ok())
                                .collect()
                        } else {
                            vec![]
                        }
                    };

                    if !secrets.is_empty() {
                        let (redacted_payload, _) =
                            RedactionEngine::redact(envelope.payload.clone(), &secrets);
                        envelope.payload = redacted_payload;
                    }

                    let event_type = serde_json::to_string(&envelope.event_type)
                        .unwrap_or_default()
                        .trim_matches('"')
                        .to_string();
                    let data = serde_json::to_string(&envelope).unwrap_or_default();
                    yield Ok::<_, Infallible>(
                        Event::default().event(event_type).data(data)
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(30))))
}
