use moxxy_core::EventBus;
use moxxy_storage::Database;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub event_bus: EventBus,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        // Run PRAGMAs via query (not execute_batch, which chokes on result-returning PRAGMAs)
        let _: String = conn
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .unwrap_or_else(|_| "delete".to_string());
        conn.execute_batch("PRAGMA foreign_keys = ON")
            .expect("Failed to enable foreign keys");

        // Run DDL (skip PRAGMA lines — already applied above)
        let sql = include_str!("../../../migrations/0001_init.sql");
        let ddl: String = sql
            .lines()
            .filter(|l| !l.trim_start().starts_with("PRAGMA"))
            .collect::<Vec<_>>()
            .join("\n");
        conn.execute_batch(&ddl).expect("Migration failed");

        Self {
            db: Arc::new(Mutex::new(Database::new(conn))),
            event_bus: EventBus::new(1024),
        }
    }
}
