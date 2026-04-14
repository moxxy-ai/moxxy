//! Session summary DAO — FTS5-indexed recall of past completed runs.
//!
//! Written by the post-run reflection pass, queried by the `session.recall`
//! primitive. The underlying table is an FTS5 virtual table created by
//! `migrations/0002_session_summaries.sql`.

use crate::rows::{SessionSummaryHit, SessionSummaryRow};
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct SessionSummaryDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> SessionSummaryDao<'a> {
    pub fn insert(&self, row: &SessionSummaryRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO session_summary \
                 (run_id, agent_id, user_id, ts, tool_call_count, task, summary) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    row.run_id,
                    row.agent_id,
                    row.user_id,
                    row.ts,
                    row.tool_call_count,
                    row.task,
                    row.summary,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    /// Full-text search over `task` + `summary` using FTS5 MATCH. Results are
    /// ordered by BM25 rank (best matches first). Filters:
    ///  - `agent_id_filter` scopes to a single agent (default for recall)
    ///  - `ts_min` / `ts_max` (seconds since epoch) — inclusive bounds.
    ///    Use `i64::MIN` / `i64::MAX` for an open bound.
    pub fn search(
        &self,
        query: &str,
        agent_id_filter: Option<&str>,
        ts_min: i64,
        ts_max: i64,
        limit: usize,
    ) -> Result<Vec<SessionSummaryHit>, StorageError> {
        // Build the WHERE clause dynamically. MATCH is always first for FTS5.
        // UNINDEXED columns (ts, agent_id) can be filtered in WHERE — slower
        // than a proper index but fine at our scale.
        let sql = match agent_id_filter {
            Some(_) => {
                "SELECT run_id, agent_id, user_id, ts, tool_call_count, task, summary, \
                        bm25(session_summary) AS rank \
                 FROM session_summary \
                 WHERE session_summary MATCH ?1 AND agent_id = ?2 \
                   AND ts BETWEEN ?3 AND ?4 \
                 ORDER BY rank ASC LIMIT ?5"
            }
            None => {
                "SELECT run_id, agent_id, user_id, ts, tool_call_count, task, summary, \
                        bm25(session_summary) AS rank \
                 FROM session_summary \
                 WHERE session_summary MATCH ?1 \
                   AND ts BETWEEN ?2 AND ?3 \
                 ORDER BY rank ASC LIMIT ?4"
            }
        };

        let mut stmt = self
            .conn
            .prepare(sql)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<SessionSummaryHit> {
            Ok(SessionSummaryHit {
                run_id: row.get(0)?,
                agent_id: row.get(1)?,
                user_id: row.get(2)?,
                ts: row.get(3)?,
                tool_call_count: row.get(4)?,
                task: row.get(5)?,
                summary: row.get(6)?,
                bm25_rank: row.get(7)?,
            })
        };

        let rows = match agent_id_filter {
            Some(agent_id) => stmt
                .query_map(
                    params![query, agent_id, ts_min, ts_max, limit as i64],
                    map_row,
                )
                .map_err(|e| StorageError::QueryFailed(e.to_string()))?
                .collect::<Result<Vec<_>, _>>(),
            None => stmt
                .query_map(params![query, ts_min, ts_max, limit as i64], map_row)
                .map_err(|e| StorageError::QueryFailed(e.to_string()))?
                .collect::<Result<Vec<_>, _>>(),
        };
        rows.map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    /// Return the most recent N summaries for an agent, newest first. Used by
    /// the insights endpoint's "what have you been working on lately" digest.
    pub fn recent_for_agent(
        &self,
        agent_id: &str,
        limit: usize,
    ) -> Result<Vec<SessionSummaryHit>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT run_id, agent_id, user_id, ts, tool_call_count, task, summary, 0.0 \
                 FROM session_summary \
                 WHERE agent_id = ?1 \
                 ORDER BY ts DESC LIMIT ?2",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, limit as i64], |row| {
                Ok(SessionSummaryHit {
                    run_id: row.get(0)?,
                    agent_id: row.get(1)?,
                    user_id: row.get(2)?,
                    ts: row.get(3)?,
                    tool_call_count: row.get(4)?,
                    task: row.get(5)?,
                    summary: row.get(6)?,
                    bm25_rank: row.get(7)?,
                })
            })
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    /// Count how many summaries exist for an agent. Cheap; used by insights
    /// and by tests.
    pub fn count_for_agent(&self, agent_id: &str) -> Result<i64, StorageError> {
        let count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_summary WHERE agent_id = ?1",
                params![agent_id],
                |r| r.get(0),
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;
    use rusqlite::Connection;

    fn setup_db() -> Database {
        let conn = Connection::open_in_memory().unwrap();
        // 0001 init (partial — just what we need)
        conn.execute_batch(include_str!("../../../../migrations/0001_init.sql"))
            .unwrap();
        // 0002 session summaries
        conn.execute_batch(include_str!(
            "../../../../migrations/0002_session_summaries.sql"
        ))
        .unwrap();
        Database::new(conn)
    }

    fn sample_row(run_id: &str, agent_id: &str, task: &str, summary: &str) -> SessionSummaryRow {
        SessionSummaryRow {
            run_id: run_id.into(),
            agent_id: agent_id.into(),
            user_id: Some("tg:42".into()),
            ts: 1_700_000_000,
            tool_call_count: 5,
            task: task.into(),
            summary: summary.into(),
        }
    }

    #[test]
    fn insert_and_search_by_task_content() {
        let db = setup_db();
        let dao = SessionSummaryDao { conn: db.conn() };
        dao.insert(&sample_row(
            "run-1",
            "alice",
            "summarize the Q1 financial report",
            "Fetched the PDF and extracted key numbers into a markdown summary.",
        ))
        .unwrap();
        dao.insert(&sample_row(
            "run-2",
            "alice",
            "book a flight to Tokyo",
            "Searched flights and proposed three options on United and ANA.",
        ))
        .unwrap();

        let hits = dao
            .search("financial report", Some("alice"), i64::MIN, i64::MAX, 10)
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].run_id, "run-1");
    }

    #[test]
    fn search_by_summary_content() {
        let db = setup_db();
        let dao = SessionSummaryDao { conn: db.conn() };
        dao.insert(&sample_row(
            "run-3",
            "bob",
            "investigate login errors",
            "Root-caused the 500 to a missing index on sessions.user_id; wrote a migration.",
        ))
        .unwrap();

        let hits = dao
            .search("migration index", Some("bob"), i64::MIN, i64::MAX, 10)
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].run_id, "run-3");
    }

    #[test]
    fn search_filters_by_agent() {
        let db = setup_db();
        let dao = SessionSummaryDao { conn: db.conn() };
        dao.insert(&sample_row(
            "r1",
            "alice",
            "deploy app",
            "Deployed to prod.",
        ))
        .unwrap();
        dao.insert(&sample_row(
            "r2",
            "bob",
            "deploy app",
            "Deployed to staging.",
        ))
        .unwrap();

        let alice_hits = dao
            .search("deploy", Some("alice"), i64::MIN, i64::MAX, 10)
            .unwrap();
        assert_eq!(alice_hits.len(), 1);
        assert_eq!(alice_hits[0].agent_id, "alice");

        let all_hits = dao.search("deploy", None, i64::MIN, i64::MAX, 10).unwrap();
        assert_eq!(all_hits.len(), 2);
    }

    #[test]
    fn search_respects_time_window() {
        let db = setup_db();
        let dao = SessionSummaryDao { conn: db.conn() };
        let old = SessionSummaryRow {
            run_id: "old".into(),
            agent_id: "alice".into(),
            user_id: None,
            ts: 1_000_000_000,
            tool_call_count: 1,
            task: "old task".into(),
            summary: "deployed something".into(),
        };
        let new = SessionSummaryRow {
            run_id: "new".into(),
            agent_id: "alice".into(),
            user_id: None,
            ts: 2_000_000_000,
            tool_call_count: 1,
            task: "new task".into(),
            summary: "deployed something".into(),
        };
        dao.insert(&old).unwrap();
        dao.insert(&new).unwrap();

        let recent = dao
            .search("deploy", Some("alice"), 1_500_000_000, i64::MAX, 10)
            .unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].run_id, "new");

        let past = dao
            .search("deploy", Some("alice"), 0, 1_500_000_000, 10)
            .unwrap();
        assert_eq!(past.len(), 1);
        assert_eq!(past[0].run_id, "old");
    }

    #[test]
    fn recent_for_agent_returns_newest_first() {
        let db = setup_db();
        let dao = SessionSummaryDao { conn: db.conn() };
        dao.insert(&SessionSummaryRow {
            run_id: "a".into(),
            agent_id: "alice".into(),
            user_id: None,
            ts: 100,
            tool_call_count: 1,
            task: "t1".into(),
            summary: "s1".into(),
        })
        .unwrap();
        dao.insert(&SessionSummaryRow {
            run_id: "b".into(),
            agent_id: "alice".into(),
            user_id: None,
            ts: 200,
            tool_call_count: 1,
            task: "t2".into(),
            summary: "s2".into(),
        })
        .unwrap();
        let recent = dao.recent_for_agent("alice", 5).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].run_id, "b");
        assert_eq!(recent[1].run_id, "a");
    }

    #[test]
    fn count_for_agent() {
        let db = setup_db();
        let dao = SessionSummaryDao { conn: db.conn() };
        dao.insert(&sample_row("r1", "alice", "task one", "summary one"))
            .unwrap();
        dao.insert(&sample_row("r2", "alice", "task two", "summary two"))
            .unwrap();
        dao.insert(&sample_row("r3", "bob", "task three", "summary three"))
            .unwrap();

        assert_eq!(dao.count_for_agent("alice").unwrap(), 2);
        assert_eq!(dao.count_for_agent("bob").unwrap(), 1);
        assert_eq!(dao.count_for_agent("nobody").unwrap(), 0);
    }
}
