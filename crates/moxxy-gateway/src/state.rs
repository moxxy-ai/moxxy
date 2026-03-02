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
        let sql = include_str!("../../../migrations/0001_init.sql");
        conn.execute_batch(sql).expect("Migration failed");
        Self {
            db: Arc::new(Mutex::new(Database::new(conn))),
            event_bus: EventBus::new(1024),
        }
    }
}
