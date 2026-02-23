mod ltm;
mod mcp;
mod schedule;
mod stm;
mod swarm;
mod tokens;
pub mod types;
mod webhook;

use anyhow::Result;
use async_trait::async_trait;
use rusqlite::{Connection, ffi::sqlite3_auto_extension};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Mutex;
use tracing::info;

use crate::core::lifecycle::LifecycleComponent;

pub struct MemorySystem {
    db: Arc<Mutex<Connection>>,
    global_db: Arc<Mutex<Connection>>,
    workspace_dir: PathBuf,
    session_id: String,
}

impl MemorySystem {
    pub async fn new<P: AsRef<Path>>(workspace_dir: P) -> Result<Self> {
        let workspace_dir = workspace_dir.as_ref().to_path_buf();
        if !workspace_dir.exists() {
            fs::create_dir_all(&workspace_dir).await?;
        }

        let stm_path = workspace_dir.join("current.md");
        if !stm_path.exists() {
            fs::write(&stm_path, "# Agent Short-Term Memory Context\n\n").await?;
        }

        // Load sqlite-vec extension globally for rusqlite
        unsafe {
            sqlite3_auto_extension(Some(std::mem::transmute::<
                *const (),
                unsafe extern "C" fn(
                    *mut rusqlite::ffi::sqlite3,
                    *mut *mut std::os::raw::c_char,
                    *const rusqlite::ffi::sqlite3_api_routines,
                ) -> std::os::raw::c_int,
            >(
                sqlite_vec::sqlite3_vec_init as *const ()
            )));
        }

        let db_path = workspace_dir.join("memory.db");
        let db = Connection::open(db_path)?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS short_term_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS scheduled_jobs (
                name TEXT PRIMARY KEY,
                cron TEXT NOT NULL,
                prompt TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS mcp_servers (
                name TEXT PRIMARY KEY,
                command TEXT NOT NULL,
                args TEXT NOT NULL,
                env TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS webhooks (
                name TEXT PRIMARY KEY,
                source TEXT NOT NULL UNIQUE,
                secret TEXT NOT NULL DEFAULT '',
                prompt_template TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS api_tokens (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        db.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS vss_long_term_memory USING vec0(
                embedding float[1536]
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS long_term_docs (
                rowid INTEGER PRIMARY KEY,
                content TEXT NOT NULL
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS long_term_files (
                rowid INTEGER PRIMARY KEY,
                file_path TEXT UNIQUE,
                content TEXT NOT NULL,
                last_indexed DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Swarm Intelligence: Global Knowledge Base shared across all agents
        let home = dirs::home_dir().expect("Could not find home directory");
        let swarm_db_path = home.join(".moxxy").join("swarm.db");
        let global_db = Connection::open(swarm_db_path)?;

        global_db.execute(
            "CREATE TABLE IF NOT EXISTS global_docs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_source TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            global_db: Arc::new(Mutex::new(global_db)),
            workspace_dir,
            session_id: uuid::Uuid::new_v4().to_string(),
        })
    }

    pub fn get_db(&self) -> Arc<Mutex<Connection>> {
        self.db.clone()
    }

    pub fn workspace_dir(&self) -> &Path {
        &self.workspace_dir
    }

    /// Start a new conversation session (new UUID).
    pub fn new_session(&mut self) -> String {
        let old = self.session_id.clone();
        self.session_id = uuid::Uuid::new_v4().to_string();
        info!("New STM session: {} (was: {})", self.session_id, old);
        old
    }

    /// Restore a previous session_id.
    pub fn restore_session(&mut self, session_id: String) {
        info!("Restoring STM session: {}", session_id);
        self.session_id = session_id;
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

#[async_trait]
impl LifecycleComponent for MemorySystem {
    async fn on_init(&mut self) -> Result<()> {
        info!("Memory System (Tiered SQLite VSS) initializing...");
        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        info!("Memory System starting...");
        // NOTE: Background mounts.toml file indexing has been removed for security.
        // Agents that need to index external files should use privileged skills explicitly.
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!("Memory System shutting down...");
        Ok(())
    }
}
