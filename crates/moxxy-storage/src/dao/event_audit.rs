use crate::rows::EventAuditRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct EventAuditDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> EventAuditDao<'a> {
    pub fn insert(&self, row: &EventAuditRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO event_audit (event_id, ts, agent_id, run_id, parent_run_id,
                 sequence, event_type, payload_json, redactions_json, sensitive, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    row.event_id,
                    row.ts,
                    row.agent_id,
                    row.run_id,
                    row.parent_run_id,
                    row.sequence,
                    row.event_type,
                    row.payload_json,
                    row.redactions_json,
                    row.sensitive,
                    row.created_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, event_id: &str) -> Result<Option<EventAuditRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT event_id, ts, agent_id, run_id, parent_run_id,
                 sequence, event_type, payload_json, redactions_json, sensitive, created_at
                 FROM event_audit WHERE event_id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![event_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(
                r.map_err(|e| StorageError::QueryFailed(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }

    /// Fetch events for an agent within `[ts_min, ts_max]` inclusive. Both
    /// bounds are millisecond epoch timestamps, matching `EventEnvelope.ts`.
    pub fn find_by_agent_in_range(
        &self,
        agent_id: &str,
        ts_min: i64,
        ts_max: i64,
    ) -> Result<Vec<EventAuditRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT event_id, ts, agent_id, run_id, parent_run_id,
                 sequence, event_type, payload_json, redactions_json, sensitive, created_at
                 FROM event_audit
                 WHERE agent_id = ?1 AND ts >= ?2 AND ts <= ?3
                 ORDER BY ts ASC",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, ts_min, ts_max], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn find_by_agent(&self, agent_id: &str) -> Result<Vec<EventAuditRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT event_id, ts, agent_id, run_id, parent_run_id,
                 sequence, event_type, payload_json, redactions_json, sensitive, created_at
                 FROM event_audit WHERE agent_id = ?1 ORDER BY ts ASC",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn list_all(&self) -> Result<Vec<EventAuditRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT event_id, ts, agent_id, run_id, parent_run_id,
                 sequence, event_type, payload_json, redactions_json, sensitive, created_at
                 FROM event_audit ORDER BY ts ASC",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn find_by_run(&self, run_id: &str) -> Result<Vec<EventAuditRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT event_id, ts, agent_id, run_id, parent_run_id,
                 sequence, event_type, payload_json, redactions_json, sensitive, created_at
                 FROM event_audit WHERE run_id = ?1 ORDER BY sequence ASC",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![run_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn delete(&self, event_id: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute(
                "DELETE FROM event_audit WHERE event_id = ?1",
                params![event_id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn find_latest_ts_for_agent(&self, agent_id: &str) -> Result<Option<i64>, StorageError> {
        let mut stmt = self
            .conn
            .prepare("SELECT MAX(ts) FROM event_audit WHERE agent_id = ?1")
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let ts: Option<i64> = stmt
            .query_row(params![agent_id], |row| row.get(0))
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        Ok(ts)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventAuditRow> {
        Ok(EventAuditRow {
            event_id: row.get(0)?,
            ts: row.get(1)?,
            agent_id: row.get(2)?,
            run_id: row.get(3)?,
            parent_run_id: row.get(4)?,
            sequence: row.get(5)?,
            event_type: row.get(6)?,
            payload_json: row.get(7)?,
            redactions_json: row.get(8)?,
            sensitive: row.get(9)?,
            created_at: row.get(10)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    #[test]
    fn insert_and_find_by_id() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let event = fixture_event_audit_row();
        dao.insert(&event).unwrap();
        let found = dao.find_by_id(&event.event_id).unwrap().unwrap();
        assert_eq!(found.event_id, event.event_id);
        assert_eq!(found.event_type, event.event_type);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_agent() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let event = fixture_event_audit_row();
        dao.insert(&event).unwrap();
        let agent_id = event.agent_id.as_ref().unwrap();
        let found = dao.find_by_agent(agent_id).unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn list_all() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let e1 = fixture_event_audit_row();
        let mut e2 = fixture_event_audit_row();
        e2.event_id = uuid::Uuid::now_v7().to_string();
        e2.ts = e1.ts + 1;
        dao.insert(&e1).unwrap();
        dao.insert(&e2).unwrap();
        let all = dao.list_all().unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn sensitive_flag_persists() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let mut event = fixture_event_audit_row();
        event.sensitive = true;
        dao.insert(&event).unwrap();
        let found = dao.find_by_id(&event.event_id).unwrap().unwrap();
        assert!(found.sensitive);
    }

    #[test]
    fn find_by_run() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let mut event = fixture_event_audit_row();
        event.run_id = Some("run-123".to_string());
        dao.insert(&event).unwrap();

        let found = dao.find_by_run("run-123").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].event_id, event.event_id);

        let empty = dao.find_by_run("no-such-run").unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn delete_event() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let event = fixture_event_audit_row();
        dao.insert(&event).unwrap();
        dao.delete(&event.event_id).unwrap();
        let found = dao.find_by_id(&event.event_id).unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn delete_nonexistent_event_returns_not_found() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let result = dao.delete("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }

    #[test]
    fn find_latest_ts_for_agent_returns_max() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let agent_id = "agent-latest-ts";

        let mut e1 = fixture_event_audit_row();
        e1.agent_id = Some(agent_id.into());
        e1.ts = 100;

        let mut e2 = fixture_event_audit_row();
        e2.event_id = uuid::Uuid::now_v7().to_string();
        e2.agent_id = Some(agent_id.into());
        e2.ts = 300;

        let mut e3 = fixture_event_audit_row();
        e3.event_id = uuid::Uuid::now_v7().to_string();
        e3.agent_id = Some(agent_id.into());
        e3.ts = 200;

        dao.insert(&e1).unwrap();
        dao.insert(&e2).unwrap();
        dao.insert(&e3).unwrap();

        let latest = dao.find_latest_ts_for_agent(agent_id).unwrap();
        assert_eq!(latest, Some(300));
    }

    #[test]
    fn find_latest_ts_for_agent_returns_none_for_unknown() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let latest = dao.find_latest_ts_for_agent("unknown-agent").unwrap();
        assert_eq!(latest, None);
    }

    #[test]
    fn find_by_agent_orders_by_ts() {
        let db = TestDb::new();
        let dao = EventAuditDao { conn: db.conn() };
        let agent_id = "agent-order-test".to_string();

        let mut e1 = fixture_event_audit_row();
        e1.agent_id = Some(agent_id.clone());
        e1.ts = 200;

        let mut e2 = fixture_event_audit_row();
        e2.event_id = uuid::Uuid::now_v7().to_string();
        e2.agent_id = Some(agent_id.clone());
        e2.ts = 100;

        dao.insert(&e1).unwrap();
        dao.insert(&e2).unwrap();

        let found = dao.find_by_agent(&agent_id).unwrap();
        assert_eq!(found.len(), 2);
        assert!(found[0].ts <= found[1].ts);
    }
}
