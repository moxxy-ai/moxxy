use rusqlite::Connection;

pub struct TestDb {
    conn: Connection,
}

impl Default for TestDb {
    fn default() -> Self {
        Self::new()
    }
}

impl TestDb {
    #[allow(clippy::missing_transmute_annotations)]
    pub fn new() -> Self {
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }
        let conn = Connection::open_in_memory().expect("Failed to create in-memory SQLite");
        let db = Self { conn };
        db.run_migrations();
        db
    }

    pub fn with_seed(seed_fn: impl FnOnce(&Connection)) -> Self {
        let db = Self::new();
        seed_fn(&db.conn);
        db
    }

    pub fn run_migrations(&self) {
        let sql = include_str!("../../../migrations/0001_init.sql");
        self.conn.execute_batch(sql).expect("Migration failed");
        self.conn
            .execute_batch(
                "CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec0 USING vec0(memory_id TEXT, embedding float[384])",
            )
            .expect("Failed to create memory_vec0");
        let sql_0002 = include_str!("../../../migrations/0002_session_summaries.sql");
        self.conn
            .execute_batch(sql_0002)
            .expect("Migration 0002 failed");
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn into_conn(self) -> Connection {
        self.conn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_creates_all_expected_tables() {
        let db = TestDb::new();
        let tables: Vec<String> = db
            .conn()
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        let expected = vec![
            "agent_allowlists",
            "agents",
            "api_tokens",
            "channel_bindings",
            "channel_pairing_codes",
            "channels",
            "conversation_log",
            "event_audit",
            "memory_index",
            "memory_vec",
            "vault_grants",
            "vault_secret_refs",
            "webhook_deliveries",
        ];
        for table in &expected {
            assert!(
                tables.contains(&table.to_string()),
                "Missing table: {}",
                table
            );
        }
    }

    #[test]
    fn test_db_has_memory_vec0_virtual_table() {
        let db = TestDb::new();
        let count: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='memory_vec0'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_db_migration_is_idempotent() {
        let db = TestDb::new();
        db.run_migrations();
        let count: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(count >= 16);
    }

    #[test]
    fn with_seed_runs_seed_function() {
        let db = TestDb::with_seed(|conn| {
            conn.execute(
                "INSERT INTO api_tokens (id, created_by, token_hash, scopes_json, created_at, status) VALUES ('t1', 'test', 'hash1', '[\"agents:read\"]', '2025-01-01', 'active')",
                [],
            )
            .unwrap();
        });
        let count: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM api_tokens", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
