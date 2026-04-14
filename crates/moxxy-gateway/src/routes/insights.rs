//! Insights endpoint — aggregates event history into a "what has this agent
//! been doing" digest. Answers `GET /v1/agents/:id/insights?days=N`.
//!
//! Reads from the existing `event_audit` table (populated by the
//! `spawn_event_persistence` background task) plus the FTS5-indexed
//! `session_summary` table (populated by the reflection pass).

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use moxxy_types::TokenScope;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct InsightsQuery {
    /// Lookback window in days, clamped to [1, 365]. Default 7.
    #[serde(default)]
    pub days: Option<u32>,
}

pub async fn agent_insights(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Path(agent_id): Path<String>,
    Query(q): Query<InsightsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::EventsRead)?;

    let days = q.days.unwrap_or(7).clamp(1, 365);
    let now_ms = chrono::Utc::now().timestamp_millis();
    let window_ms = (days as i64) * 24 * 3600 * 1000;
    let ts_min = now_ms - window_ms;

    let db = state.db.lock().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
        )
    })?;

    let events = db
        .events()
        .find_by_agent_in_range(&agent_id, ts_min, now_ms)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal", "message": e.to_string()})),
            )
        })?;

    // Counters. Using BTreeMap for deterministic output ordering.
    let mut by_type: BTreeMap<String, u64> = BTreeMap::new();
    let mut primitive_histogram: BTreeMap<String, u64> = BTreeMap::new();
    let mut skill_invocations: u64 = 0;
    let mut skills_synthesized: u64 = 0;
    let mut skills_approved: u64 = 0;
    let mut skills_approval_denied: u64 = 0;
    let mut skills_patched: u64 = 0;
    let mut reflections_completed: u64 = 0;
    let mut reflections_failed: u64 = 0;
    let mut lessons_stored: u64 = 0;
    let mut runs_started: u64 = 0;
    let mut runs_completed: u64 = 0;
    let mut runs_failed: u64 = 0;
    let mut runs_queued: u64 = 0;
    let mut runs_dequeued: u64 = 0;
    let mut channel_messages_received: u64 = 0;
    let mut unique_users = std::collections::HashSet::<String>::new();
    let mut last_event_ts: Option<i64> = None;

    for ev in &events {
        *by_type.entry(ev.event_type.clone()).or_insert(0) += 1;
        last_event_ts = Some(ev.ts);

        // Parse the payload once per event — most branches need at least one field.
        let payload: Option<serde_json::Value> = ev
            .payload_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());

        match ev.event_type.as_str() {
            "run.started" => runs_started += 1,
            "run.completed" => runs_completed += 1,
            "run.failed" => runs_failed += 1,
            "run.queued" => runs_queued += 1,
            "run.dequeued" => runs_dequeued += 1,
            "primitive.invoked" => {
                if let Some(p) = payload.as_ref()
                    && let Some(name) = p.get("name").and_then(|v| v.as_str())
                {
                    *primitive_histogram.entry(name.to_string()).or_insert(0) += 1;
                }
            }
            "skill.invoked" => skill_invocations += 1,
            "skill.synthesized" => skills_synthesized += 1,
            "skill.approved" => skills_approved += 1,
            "skill.approval_denied" => skills_approval_denied += 1,
            "skill.patched" => skills_patched += 1,
            "reflection.failed" => reflections_failed += 1,
            "reflection.completed" => {
                reflections_completed += 1;
                if let Some(p) = payload.as_ref()
                    && let Some(n) = p.get("lessons_stored").and_then(|v| v.as_u64())
                {
                    lessons_stored += n;
                }
            }
            "channel.message_received" => {
                channel_messages_received += 1;
                // The channel bridge writes sender info into the envelope; we
                // approximate unique users via payload.sender_name if present,
                // else fall back to distinct runs.
                if let Some(p) = payload.as_ref()
                    && let Some(n) = p.get("sender_name").and_then(|v| v.as_str())
                {
                    unique_users.insert(n.to_string());
                }
            }
            _ => {}
        }
    }

    // Top 10 primitives by count, sorted desc.
    let mut prim_ordered: Vec<(String, u64)> = primitive_histogram.into_iter().collect();
    prim_ordered.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let top_primitives: Vec<serde_json::Value> = prim_ordered
        .iter()
        .take(10)
        .map(|(name, count)| serde_json::json!({"name": name, "count": count}))
        .collect();

    // Total session summaries (all-time — the reflection pass is the only
    // writer, and FTS5 is cheap to count).
    let session_summaries_total = db.session_summaries().count_for_agent(&agent_id).ok();

    // Top 3 most recent session summaries — "what have you been working on
    // this week, in the agent's own words".
    let recent_sessions = db
        .session_summaries()
        .recent_for_agent(&agent_id, 3)
        .ok()
        .unwrap_or_default();
    let recent_sessions_json: Vec<serde_json::Value> = recent_sessions
        .iter()
        .filter(|s| s.ts >= ts_min / 1000 && s.ts <= now_ms / 1000)
        .map(|s| {
            serde_json::json!({
                "run_id": s.run_id,
                "ts": s.ts,
                "task": s.task,
                "summary": s.summary,
                "tool_call_count": s.tool_call_count,
            })
        })
        .collect();

    drop(db);

    Ok(Json(serde_json::json!({
        "agent_id": agent_id,
        "window": {
            "days": days,
            "ts_min": ts_min,
            "ts_max": now_ms,
        },
        "last_event_ts": last_event_ts,
        "totals": {
            "events": events.len(),
            "runs_started": runs_started,
            "runs_completed": runs_completed,
            "runs_failed": runs_failed,
            "runs_queued": runs_queued,
            "runs_dequeued": runs_dequeued,
            "channel_messages_received": channel_messages_received,
            "unique_channel_users_seen": unique_users.len(),
        },
        "learning": {
            "reflections_completed": reflections_completed,
            "reflections_failed": reflections_failed,
            "lessons_stored": lessons_stored,
            "skills_synthesized": skills_synthesized,
            "skills_approved": skills_approved,
            "skills_approval_denied": skills_approval_denied,
            "skills_patched": skills_patched,
            "session_summaries_total": session_summaries_total,
        },
        "tools": {
            "skill_invocations": skill_invocations,
            "top_primitives": top_primitives,
        },
        "recent_sessions": recent_sessions_json,
        "events_by_type": by_type,
    })))
}

#[cfg(test)]
mod tests {
    use moxxy_storage::{Database, EventAuditRow};
    use moxxy_test_utils::TestDb;

    fn setup() -> Database {
        let tdb = TestDb::new();
        tdb.run_migrations();
        Database::new(tdb.into_conn())
    }

    fn insert_event(
        db: &Database,
        agent: &str,
        ts: i64,
        event_type: &str,
        payload: serde_json::Value,
    ) {
        let row = EventAuditRow {
            event_id: uuid::Uuid::now_v7().to_string(),
            ts,
            agent_id: Some(agent.to_string()),
            run_id: None,
            parent_run_id: None,
            sequence: 0,
            event_type: event_type.to_string(),
            payload_json: Some(payload.to_string()),
            redactions_json: None,
            sensitive: false,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        db.events().insert(&row).unwrap();
    }

    #[tokio::test]
    async fn range_query_filters_out_old_events() {
        let db = setup();
        let now = chrono::Utc::now().timestamp_millis();
        let inside = now - 3600 * 1000; // 1h ago
        let outside = now - 30 * 24 * 3600 * 1000; // 30d ago

        insert_event(&db, "alice", inside, "run.started", serde_json::json!({}));
        insert_event(&db, "alice", outside, "run.started", serde_json::json!({}));

        // 7-day window should see only the 1h-ago event
        let events = db
            .events()
            .find_by_agent_in_range("alice", now - 7 * 24 * 3600 * 1000, now)
            .unwrap();
        assert_eq!(events.len(), 1);
    }
}
