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
        self.conn.execute_batch(sql).expect("Migration 0001 failed");
        let sql2 = include_str!("../../../migrations/0002_channels.sql");
        self.conn
            .execute_batch(sql2)
            .expect("Migration 0002 failed");
        let sql3 = include_str!("../../../migrations/0003_webhooks.sql");
        self.conn
            .execute_batch(sql3)
            .expect("Migration 0003 failed");
        let sql4 = include_str!("../../../migrations/0004_conversation_log.sql");
        self.conn
            .execute_batch(sql4)
            .expect("Migration 0004 failed");
        // Migration 0005: ALTER TABLE is not idempotent, so check if column exists first
        let has_status: bool = self
            .conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_index'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, String>(0)))
            .map(|sql| sql.contains("status"))
            .unwrap_or(false);
        if !has_status {
            let sql5 = include_str!("../../../migrations/0005_memory_vec0.sql");
            self.conn
                .execute_batch(sql5)
                .expect("Migration 0005 failed");
        }
        // Migration 0006: heartbeat cron columns
        let has_cron: bool = self
            .conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='heartbeats'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, String>(0)))
            .map(|sql| sql.contains("cron_expr"))
            .unwrap_or(false);
        if !has_cron {
            let sql6 = include_str!("../../../migrations/0006_heartbeat_cron.sql");
            self.conn
                .execute_batch(sql6)
                .expect("Migration 0006 failed");
        }
        // Migration 0008: agent name/persona columns
        let has_agent_name: bool = self
            .conn
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, String>(0)))
            .map(|sql| sql.contains("name"))
            .unwrap_or(false);
        if !has_agent_name {
            let sql8 = include_str!("../../../migrations/0008_agent_name_persona.sql");
            self.conn
                .execute_batch(sql8)
                .expect("Migration 0008 failed");
        }
        // Migration 0009: agent allowlists
        let sql9 = include_str!("../../../migrations/0009_agent_allowlists.sql");
        self.conn
            .execute_batch(sql9)
            .expect("Migration 0009 failed");
        // Migration 0010: inbound webhooks (drops and recreates webhook tables)
        let sql10 = include_str!("../../../migrations/0010_inbound_webhooks.sql");
        self.conn
            .execute_batch(sql10)
            .expect("Migration 0010 failed");
        self.conn
            .execute_batch(
                "CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec0 USING vec0(memory_id TEXT, embedding float[384])",
            )
            .expect("Failed to create memory_vec0");
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
            "heartbeats",
            "memory_index",
            "memory_vec",
            "provider_models",
            "providers",
            "skills",
            "vault_grants",
            "vault_secret_refs",
            "webhook_deliveries",
            "webhooks",
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
        assert!(count >= 18);
    }

    #[test]
    fn with_seed_runs_seed_function() {
        let db = TestDb::with_seed(|conn| {
            conn.execute(
                "INSERT INTO providers (id, display_name, manifest_path, enabled, created_at) VALUES ('p1', 'P1', '/p1', 1, '2025-01-01')",
                [],
            )
            .unwrap();
        });
        let count: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM providers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
