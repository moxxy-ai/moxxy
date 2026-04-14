//! Session recall primitive — FTS5 full-text search over past completed runs.
//!
//! The `session.recall` primitive gives the agent a window into its own
//! cross-session history. Summaries are written to the FTS5 index by the
//! post-run reflection pass (see `executor::reflection`). Queries are scoped
//! to the calling agent by default so agents cannot see each other's history.

use async_trait::async_trait;
use moxxy_storage::Database;
use std::sync::{Arc, Mutex};

use crate::registry::{Primitive, PrimitiveError};

/// Default number of results if `limit` is omitted.
const DEFAULT_RECALL_LIMIT: usize = 10;
/// Cap on `limit` to keep the context hit manageable.
const MAX_RECALL_LIMIT: usize = 50;

pub struct SessionRecallPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
}

impl SessionRecallPrimitive {
    pub fn new(db: Arc<Mutex<Database>>, agent_id: String) -> Self {
        Self { db, agent_id }
    }
}

#[async_trait]
impl Primitive for SessionRecallPrimitive {
    fn name(&self) -> &str {
        "session.recall"
    }

    fn description(&self) -> &str {
        "Search your own past completed runs by content. Uses FTS5 over session summaries written at reflection time. Returns run_id, task, summary, and timestamps for the best-matching past sessions."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Full-text search query (FTS5 MATCH syntax — plain words work, advanced operators like AND/OR/NEAR are supported)"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max number of hits to return (default 10, max 50)"
                },
                "include_other_agents": {
                    "type": "boolean",
                    "description": "If true, search across all agents' sessions (default false — recall is scoped to this agent)"
                },
                "days": {
                    "type": "integer",
                    "description": "Only match sessions from the last N days (default: no time filter). Mutually exclusive with ts_min/ts_max."
                },
                "ts_min": {
                    "type": "integer",
                    "description": "Inclusive lower bound on session timestamp (seconds since epoch)"
                },
                "ts_max": {
                    "type": "integer",
                    "description": "Inclusive upper bound on session timestamp (seconds since epoch)"
                }
            },
            "required": ["query"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let query = params
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'query'".into()))?
            .trim()
            .to_string();
        if query.is_empty() {
            return Err(PrimitiveError::InvalidParams(
                "query must be non-empty".into(),
            ));
        }

        let limit = params
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_RECALL_LIMIT)
            .min(MAX_RECALL_LIMIT);

        let cross_agent = params
            .get("include_other_agents")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let agent_filter = if cross_agent {
            None
        } else {
            Some(self.agent_id.as_str())
        };

        // Resolve time window: `days` is a convenience that trumps explicit
        // bounds if provided; otherwise use ts_min/ts_max or an open window.
        let (ts_min, ts_max) = if let Some(days) = params.get("days").and_then(|v| v.as_u64()) {
            let now = chrono::Utc::now().timestamp();
            (now - (days as i64) * 86_400, now)
        } else {
            let ts_min = params
                .get("ts_min")
                .and_then(|v| v.as_i64())
                .unwrap_or(i64::MIN);
            let ts_max = params
                .get("ts_max")
                .and_then(|v| v.as_i64())
                .unwrap_or(i64::MAX);
            (ts_min, ts_max)
        };

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        let hits = db
            .session_summaries()
            .search(&query, agent_filter, ts_min, ts_max, limit)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let results: Vec<serde_json::Value> = hits
            .iter()
            .map(|h| {
                serde_json::json!({
                    "run_id": h.run_id,
                    "agent_id": h.agent_id,
                    "user_id": h.user_id,
                    "ts": h.ts,
                    "tool_call_count": h.tool_call_count,
                    "task": h.task,
                    "summary": h.summary,
                    "bm25_rank": h.bm25_rank,
                })
            })
            .collect();

        Ok(serde_json::json!({
            "query": query,
            "scope": if cross_agent { "all_agents" } else { "this_agent" },
            "ts_min": ts_min,
            "ts_max": ts_max,
            "count": results.len(),
            "sessions": results,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_storage::SessionSummaryRow;
    use moxxy_test_utils::TestDb;

    fn setup() -> Arc<Mutex<Database>> {
        let tdb = TestDb::new();
        tdb.run_migrations();
        Arc::new(Mutex::new(Database::new(tdb.into_conn())))
    }

    fn insert(db: &Arc<Mutex<Database>>, run_id: &str, agent: &str, task: &str, summary: &str) {
        let row = SessionSummaryRow {
            run_id: run_id.into(),
            agent_id: agent.into(),
            user_id: None,
            ts: 1_700_000_000,
            tool_call_count: 3,
            task: task.into(),
            summary: summary.into(),
        };
        db.lock().unwrap().session_summaries().insert(&row).unwrap();
    }

    #[tokio::test]
    async fn recall_finds_own_session() {
        let db = setup();
        insert(
            &db,
            "run-1",
            "alice",
            "analyze Q1 sales data",
            "Pulled revenue figures by region and flagged the drop in EMEA.",
        );
        insert(
            &db,
            "run-2",
            "alice",
            "unrelated task",
            "Did something else.",
        );

        let prim = SessionRecallPrimitive::new(db, "alice".into());
        let result = prim
            .invoke(serde_json::json!({"query": "sales revenue"}))
            .await
            .unwrap();
        let sessions = result["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["run_id"], "run-1");
        assert_eq!(result["scope"], "this_agent");
    }

    #[tokio::test]
    async fn recall_scoped_to_agent_by_default() {
        let db = setup();
        insert(&db, "a-1", "alice", "deploy the api", "Deployed v3.");
        insert(&db, "b-1", "bob", "deploy the api", "Deployed v4.");

        let prim = SessionRecallPrimitive::new(db.clone(), "alice".into());
        let result = prim
            .invoke(serde_json::json!({"query": "deploy"}))
            .await
            .unwrap();
        let sessions = result["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["agent_id"], "alice");
    }

    #[tokio::test]
    async fn recall_crosses_agents_when_opted_in() {
        let db = setup();
        insert(&db, "a-1", "alice", "deploy the api", "Deployed v3.");
        insert(&db, "b-1", "bob", "deploy the api", "Deployed v4.");

        let prim = SessionRecallPrimitive::new(db, "alice".into());
        let result = prim
            .invoke(serde_json::json!({
                "query": "deploy",
                "include_other_agents": true,
            }))
            .await
            .unwrap();
        let sessions = result["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(result["scope"], "all_agents");
    }

    #[tokio::test]
    async fn recall_rejects_empty_query() {
        let db = setup();
        let prim = SessionRecallPrimitive::new(db, "alice".into());
        let result = prim.invoke(serde_json::json!({"query": "   "})).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn recall_with_days_filter_excludes_old() {
        let db = setup();
        // Two summaries, one recent, one ancient
        let row_recent = SessionSummaryRow {
            run_id: "recent".into(),
            agent_id: "alice".into(),
            user_id: None,
            ts: chrono::Utc::now().timestamp() - 3600, // 1h ago
            tool_call_count: 1,
            task: "deploy".into(),
            summary: "ran deploy yesterday".into(),
        };
        let row_old = SessionSummaryRow {
            run_id: "old".into(),
            agent_id: "alice".into(),
            user_id: None,
            ts: chrono::Utc::now().timestamp() - 90 * 86_400, // 90d ago
            tool_call_count: 1,
            task: "deploy".into(),
            summary: "ran deploy ages ago".into(),
        };
        db.lock()
            .unwrap()
            .session_summaries()
            .insert(&row_recent)
            .unwrap();
        db.lock()
            .unwrap()
            .session_summaries()
            .insert(&row_old)
            .unwrap();

        let prim = SessionRecallPrimitive::new(db, "alice".into());
        let result = prim
            .invoke(serde_json::json!({"query": "deploy", "days": 7}))
            .await
            .unwrap();
        let sessions = result["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["run_id"], "recent");
    }

    #[tokio::test]
    async fn recall_caps_limit() {
        let db = setup();
        for i in 0..60 {
            insert(
                &db,
                &format!("r-{i}"),
                "alice",
                "common task",
                "deploying the common service",
            );
        }
        let prim = SessionRecallPrimitive::new(db, "alice".into());
        let result = prim
            .invoke(serde_json::json!({"query": "deploying", "limit": 999}))
            .await
            .unwrap();
        let sessions = result["sessions"].as_array().unwrap();
        assert!(sessions.len() <= 50);
    }
}
