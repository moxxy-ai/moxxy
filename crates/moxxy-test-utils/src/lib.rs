use rusqlite::Connection;

pub struct TestDb {
    conn: Connection,
}

impl TestDb {
    pub fn new() -> Self {
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
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
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
            "agents",
            "api_tokens",
            "event_audit",
            "heartbeats",
            "memory_index",
            "memory_vec",
            "provider_models",
            "providers",
            "skills",
            "vault_grants",
            "vault_secret_refs",
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
        assert!(count >= 11);
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
