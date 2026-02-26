mod ltm;
mod mcp;
mod orchestrator;
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
use crate::platform::{NativePlatform, Platform};

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
        NativePlatform::restrict_dir_permissions(&workspace_dir);

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
        let db = Connection::open(&db_path)?;
        NativePlatform::restrict_file_permissions(&db_path);

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
            "CREATE TABLE IF NOT EXISTS orchestrator_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                config_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS orchestrator_templates (
                template_id TEXT PRIMARY KEY,
                template_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS orchestrator_jobs (
                job_id TEXT PRIMARY KEY,
                agent_name TEXT NOT NULL,
                status TEXT NOT NULL,
                prompt TEXT NOT NULL,
                worker_mode TEXT NOT NULL,
                summary TEXT,
                error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                finished_at DATETIME
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS orchestrator_worker_runs (
                worker_run_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                worker_agent TEXT NOT NULL,
                worker_mode TEXT NOT NULL,
                task_prompt TEXT NOT NULL,
                status TEXT NOT NULL,
                attempt INTEGER NOT NULL,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                finished_at DATETIME,
                output TEXT,
                error TEXT
            )",
            [],
        )?;

        db.execute(
            "CREATE TABLE IF NOT EXISTS orchestrator_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_orchestrator_events_job_id_id ON orchestrator_events(job_id, id)",
            [],
        )?;
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_orchestrator_workers_job_id ON orchestrator_worker_runs(job_id)",
            [],
        )?;
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_orchestrator_jobs_status_created ON orchestrator_jobs(status, created_at)",
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
        let swarm_db_path = NativePlatform::data_dir().join("swarm.db");
        let global_db = Connection::open(&swarm_db_path)?;
        NativePlatform::restrict_file_permissions(&swarm_db_path);

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
    #[allow(dead_code)]
    pub fn restore_session(&mut self, session_id: String) {
        info!("Restoring STM session: {}", session_id);
        self.session_id = session_id;
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

/// Create an in-memory MemorySystem for testing. Avoids filesystem side-effects.
#[cfg(test)]
pub async fn test_memory_system() -> MemorySystem {
    use rusqlite::ffi::sqlite3_auto_extension;

    let tmpdir = std::env::temp_dir().join(format!("moxxy-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmpdir).expect("create temp dir");
    let stm_path = tmpdir.join("current.md");
    std::fs::write(&stm_path, "# Test STM\n\n").expect("write stm file");

    unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut std::os::raw::c_char,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> std::os::raw::c_int,
        >(sqlite_vec::sqlite3_vec_init as *const ())));
    }

    let db_path = tmpdir.join("memory.db");
    let db = Connection::open(&db_path).expect("open test db");

    db.execute(
        "CREATE TABLE IF NOT EXISTS short_term_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS scheduled_jobs (
            name TEXT PRIMARY KEY, cron TEXT NOT NULL,
            prompt TEXT NOT NULL, source TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS mcp_servers (
            name TEXT PRIMARY KEY, command TEXT NOT NULL,
            args TEXT NOT NULL, env TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS webhooks (
            name TEXT PRIMARY KEY, source TEXT NOT NULL UNIQUE,
            secret TEXT NOT NULL DEFAULT '', prompt_template TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS api_tokens (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS orchestrator_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            config_json TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS orchestrator_templates (
            template_id TEXT PRIMARY KEY,
            template_json TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS orchestrator_jobs (
            job_id TEXT PRIMARY KEY,
            agent_name TEXT NOT NULL,
            status TEXT NOT NULL,
            prompt TEXT NOT NULL,
            worker_mode TEXT NOT NULL,
            summary TEXT,
            error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            finished_at DATETIME
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS orchestrator_worker_runs (
            worker_run_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            worker_agent TEXT NOT NULL,
            worker_mode TEXT NOT NULL,
            task_prompt TEXT NOT NULL,
            status TEXT NOT NULL,
            attempt INTEGER NOT NULL,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            finished_at DATETIME,
            output TEXT,
            error TEXT
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS orchestrator_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_orchestrator_events_job_id_id ON orchestrator_events(job_id, id)",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_orchestrator_workers_job_id ON orchestrator_worker_runs(job_id)",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_orchestrator_jobs_status_created ON orchestrator_jobs(status, created_at)",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS vss_long_term_memory USING vec0(embedding float[1536])",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS long_term_docs (rowid INTEGER PRIMARY KEY, content TEXT NOT NULL)",
        [],
    )
    .unwrap();
    db.execute(
        "CREATE TABLE IF NOT EXISTS long_term_files (
            rowid INTEGER PRIMARY KEY, file_path TEXT UNIQUE,
            content TEXT NOT NULL, last_indexed DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .unwrap();

    let swarm_db = Connection::open(tmpdir.join("swarm.db")).expect("open swarm db");
    swarm_db
        .execute(
            "CREATE TABLE IF NOT EXISTS global_docs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_source TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .unwrap();

    MemorySystem {
        db: Arc::new(Mutex::new(db)),
        global_db: Arc::new(Mutex::new(swarm_db)),
        workspace_dir: tmpdir,
        session_id: uuid::Uuid::new_v4().to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

    // --- Session management ---

    #[tokio::test]
    async fn new_session_generates_unique_id() {
        let mut mem = test_memory_system().await;
        let old = mem.session_id().to_string();
        let returned_old = mem.new_session();
        assert_eq!(returned_old, old);
        assert_ne!(mem.session_id(), old);
    }

    #[tokio::test]
    async fn restore_session_reverts_to_previous_id() {
        let mut mem = test_memory_system().await;
        let first = mem.session_id().to_string();
        mem.new_session();
        assert_ne!(mem.session_id(), first);
        mem.restore_session(first.clone());
        assert_eq!(mem.session_id(), first);
    }

    // --- Scheduled Jobs CRUD ---

    #[tokio::test]
    async fn schedule_add_and_list() {
        let mem = test_memory_system().await;
        mem.add_scheduled_job("daily_digest", "0 0 9 * * *", "Check news", "api")
            .await
            .unwrap();
        let jobs = mem.get_all_scheduled_jobs().await.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].name, "daily_digest");
        assert_eq!(jobs[0].cron, "0 0 9 * * *");
        assert_eq!(jobs[0].prompt, "Check news");
        assert_eq!(jobs[0].source, "api");
    }

    #[tokio::test]
    async fn schedule_upsert_replaces_existing() {
        let mem = test_memory_system().await;
        mem.add_scheduled_job("job1", "0 0 * * * *", "old prompt", "api")
            .await
            .unwrap();
        mem.add_scheduled_job("job1", "0 30 * * * *", "new prompt", "cli")
            .await
            .unwrap();
        let jobs = mem.get_all_scheduled_jobs().await.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].cron, "0 30 * * * *");
        assert_eq!(jobs[0].prompt, "new prompt");
    }

    #[tokio::test]
    async fn schedule_remove_returns_false_for_nonexistent() {
        let mem = test_memory_system().await;
        assert!(!mem.remove_scheduled_job("ghost").await.unwrap());
    }

    #[tokio::test]
    async fn schedule_remove_deletes_job() {
        let mem = test_memory_system().await;
        mem.add_scheduled_job("temp", "0 0 * * * *", "p", "api")
            .await
            .unwrap();
        assert!(mem.remove_scheduled_job("temp").await.unwrap());
        assert_eq!(mem.get_all_scheduled_jobs().await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn schedule_remove_all_clears_everything() {
        let mem = test_memory_system().await;
        for i in 0..5 {
            mem.add_scheduled_job(&format!("j{}", i), "* * * * * *", "p", "api")
                .await
                .unwrap();
        }
        let count = mem.remove_all_scheduled_jobs().await.unwrap();
        assert_eq!(count, 5);
        assert_eq!(mem.get_all_scheduled_jobs().await.unwrap().len(), 0);
    }

    // --- Webhook CRUD ---

    #[tokio::test]
    async fn webhook_add_and_list() {
        let mem = test_memory_system().await;
        mem.add_webhook("alerts", "github", "Process: {{body}}")
            .await
            .unwrap();
        let wh = mem.get_all_webhooks().await.unwrap();
        assert_eq!(wh.len(), 1);
        assert_eq!(wh[0].name, "alerts");
        assert_eq!(wh[0].source, "github");
        assert!(wh[0].active);
    }

    #[tokio::test]
    async fn webhook_get_by_source() {
        let mem = test_memory_system().await;
        mem.add_webhook("gh", "github", "template").await.unwrap();
        let found = mem.get_webhook_by_source("github").await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "gh");
        assert!(
            mem.get_webhook_by_source("nonexistent")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn webhook_update_active_flag() {
        let mem = test_memory_system().await;
        mem.add_webhook("wh1", "src1", "template").await.unwrap();
        assert!(mem.update_webhook_active("wh1", false).await.unwrap());
        let wh = mem.get_webhook_by_source("src1").await.unwrap().unwrap();
        assert!(!wh.active);
        assert!(mem.update_webhook_active("wh1", true).await.unwrap());
        let wh = mem.get_webhook_by_source("src1").await.unwrap().unwrap();
        assert!(wh.active);
    }

    #[tokio::test]
    async fn webhook_update_active_nonexistent_returns_false() {
        let mem = test_memory_system().await;
        assert!(!mem.update_webhook_active("ghost", true).await.unwrap());
    }

    #[tokio::test]
    async fn webhook_remove() {
        let mem = test_memory_system().await;
        mem.add_webhook("rm_me", "src", "t").await.unwrap();
        assert!(mem.remove_webhook("rm_me").await.unwrap());
        assert!(!mem.remove_webhook("rm_me").await.unwrap());
    }

    // --- MCP Servers CRUD ---

    #[tokio::test]
    async fn mcp_add_and_list() {
        let mem = test_memory_system().await;
        mem.add_mcp_server(
            "fs-server",
            "npx",
            "[\"@modelcontextprotocol/server-filesystem\"]",
            "{}",
        )
        .await
        .unwrap();
        let servers = mem.get_all_mcp_servers().await.unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "fs-server");
        assert_eq!(servers[0].command, "npx");
    }

    #[tokio::test]
    async fn mcp_upsert_replaces_existing() {
        let mem = test_memory_system().await;
        mem.add_mcp_server("s1", "old-cmd", "[]", "{}")
            .await
            .unwrap();
        mem.add_mcp_server("s1", "new-cmd", "[\"arg\"]", "{\"K\":\"V\"}")
            .await
            .unwrap();
        let servers = mem.get_all_mcp_servers().await.unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].command, "new-cmd");
    }

    #[tokio::test]
    async fn mcp_remove() {
        let mem = test_memory_system().await;
        mem.add_mcp_server("temp", "cmd", "[]", "{}").await.unwrap();
        assert!(mem.remove_mcp_server("temp").await.unwrap());
        assert!(!mem.remove_mcp_server("temp").await.unwrap());
    }

    // --- STM ---

    #[tokio::test]
    async fn stm_append_and_read_for_session() {
        let mem = test_memory_system().await;
        let sid = mem.session_id().to_string();
        mem.append_stm_for_session(&sid, "user", "Hello")
            .await
            .unwrap();
        mem.append_stm_for_session(&sid, "assistant", "Hi there")
            .await
            .unwrap();
        let entries = mem.read_stm_for_session(&sid, 10).await.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].role, "user");
        assert_eq!(entries[0].content, "Hello");
        assert_eq!(entries[1].role, "assistant");
    }

    #[tokio::test]
    async fn stm_session_isolation() {
        let mem = test_memory_system().await;
        let s1 = "session-aaa";
        let s2 = "session-bbb";
        mem.append_stm_for_session(s1, "user", "from s1")
            .await
            .unwrap();
        mem.append_stm_for_session(s2, "user", "from s2")
            .await
            .unwrap();
        let entries_s1 = mem.read_stm_for_session(s1, 10).await.unwrap();
        let entries_s2 = mem.read_stm_for_session(s2, 10).await.unwrap();
        assert_eq!(entries_s1.len(), 1);
        assert_eq!(entries_s2.len(), 1);
        assert_eq!(entries_s1[0].content, "from s1");
        assert_eq!(entries_s2[0].content, "from s2");
    }

    #[tokio::test]
    async fn stm_truncates_long_content() {
        let mem = test_memory_system().await;
        let sid = mem.session_id().to_string();
        let long_text = "x".repeat(3000);
        mem.append_stm_for_session(&sid, "system", &long_text)
            .await
            .unwrap();
        let entries = mem.read_stm_for_session(&sid, 10).await.unwrap();
        assert!(entries[0].content.len() < 3000);
        assert!(entries[0].content.ends_with("... [truncated]"));
    }

    #[tokio::test]
    async fn stm_respects_limit() {
        let mem = test_memory_system().await;
        let sid = mem.session_id().to_string();
        for i in 0..10 {
            mem.append_stm_for_session(&sid, "user", &format!("msg {}", i))
                .await
                .unwrap();
        }
        let entries = mem.read_stm_for_session(&sid, 3).await.unwrap();
        assert_eq!(entries.len(), 3);
    }

    #[tokio::test]
    async fn stm_structured_since_returns_incremental() {
        let mem = test_memory_system().await;
        mem.append_short_term_memory("user", "first").await.unwrap();
        mem.append_short_term_memory("assistant", "second")
            .await
            .unwrap();
        let all = mem.read_stm_structured_since(0, 100, false).await.unwrap();
        assert_eq!(all.len(), 2);
        let after_first = mem
            .read_stm_structured_since(all[0].id, 100, false)
            .await
            .unwrap();
        assert_eq!(after_first.len(), 1);
        assert_eq!(after_first[0].content, "second");
    }

    // --- Swarm Memory ---

    #[tokio::test]
    async fn swarm_add_and_read() {
        let mem = test_memory_system().await;
        mem.add_swarm_memory("agent-a", "Discovered a new API pattern")
            .await
            .unwrap();
        let records = mem.read_swarm_memory(10).await.unwrap();
        assert_eq!(records.len(), 1);
        assert!(records[0].contains("agent-a"));
        assert!(records[0].contains("Discovered a new API pattern"));
    }

    #[tokio::test]
    async fn swarm_rejects_content_exceeding_limit() {
        let mem = test_memory_system().await;
        let huge = "x".repeat(2001);
        let result = mem.add_swarm_memory("agent-b", &huge).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("2000"));
    }

    #[tokio::test]
    async fn swarm_respects_read_limit() {
        let mem = test_memory_system().await;
        for i in 0..10 {
            mem.add_swarm_memory("agent", &format!("fact {}", i))
                .await
                .unwrap();
        }
        let records = mem.read_swarm_memory(3).await.unwrap();
        assert_eq!(records.len(), 3);
    }

    // --- API Tokens ---

    #[tokio::test]
    async fn token_create_and_validate() {
        let mem = test_memory_system().await;
        let (raw_token, record) = mem.create_api_token("test-key").await.unwrap();
        assert!(raw_token.starts_with("mxk_"));
        assert_eq!(record.name, "test-key");
        assert!(mem.validate_api_token(&raw_token).await.unwrap());
    }

    #[tokio::test]
    async fn token_validate_rejects_wrong_token() {
        let mem = test_memory_system().await;
        mem.create_api_token("real").await.unwrap();
        assert!(
            !mem.validate_api_token("mxk_fake123456789000")
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn token_list_returns_all_tokens() {
        let mem = test_memory_system().await;
        mem.create_api_token("key-1").await.unwrap();
        mem.create_api_token("key-2").await.unwrap();
        let tokens = mem.list_api_tokens().await.unwrap();
        assert_eq!(tokens.len(), 2);
    }

    #[tokio::test]
    async fn token_delete_removes_token() {
        let mem = test_memory_system().await;
        let (raw_token, record) = mem.create_api_token("ephemeral").await.unwrap();
        assert!(mem.delete_api_token(&record.id).await.unwrap());
        assert!(!mem.validate_api_token(&raw_token).await.unwrap());
    }

    #[tokio::test]
    async fn token_delete_nonexistent_returns_false() {
        let mem = test_memory_system().await;
        assert!(!mem.delete_api_token("no-such-id").await.unwrap());
    }

    #[tokio::test]
    async fn has_any_tokens_empty() {
        let mem = test_memory_system().await;
        assert!(!mem.has_any_api_tokens().await.unwrap());
    }

    #[tokio::test]
    async fn has_any_tokens_after_create() {
        let mem = test_memory_system().await;
        mem.create_api_token("k").await.unwrap();
        assert!(mem.has_any_api_tokens().await.unwrap());
    }

    #[tokio::test]
    async fn orchestrator_config_roundtrip() {
        let mem = test_memory_system().await;
        let cfg = crate::core::orchestrator::OrchestratorAgentConfig {
            default_template_id: Some("tpl-a".to_string()),
            default_worker_mode: crate::core::orchestrator::WorkerMode::Mixed,
            default_max_parallelism: Some(12),
            default_retry_limit: 1,
            default_failure_policy: crate::core::orchestrator::JobFailurePolicy::AutoReplan,
            default_merge_policy: crate::core::orchestrator::JobMergePolicy::ManualApproval,
            parallelism_warn_threshold: 5,
        };
        mem.set_orchestrator_config(&cfg).await.unwrap();
        let got = mem.get_orchestrator_config().await.unwrap().unwrap();
        assert_eq!(got.default_template_id.as_deref(), Some("tpl-a"));
        assert_eq!(got.default_max_parallelism, Some(12));
    }

    #[tokio::test]
    async fn orchestrator_templates_crud() {
        let mem = test_memory_system().await;
        let tpl = crate::core::orchestrator::OrchestratorTemplate {
            template_id: "tpl-kanban".to_string(),
            name: "Kanban".to_string(),
            description: "d".to_string(),
            default_worker_mode: Some(crate::core::orchestrator::WorkerMode::Mixed),
            default_max_parallelism: Some(9),
            default_retry_limit: Some(1),
            default_failure_policy: Some(crate::core::orchestrator::JobFailurePolicy::AutoReplan),
            default_merge_policy: Some(crate::core::orchestrator::JobMergePolicy::ManualApproval),
            spawn_profiles: vec![],
        };
        mem.upsert_orchestrator_template(&tpl).await.unwrap();
        let got = mem
            .get_orchestrator_template("tpl-kanban")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got.name, "Kanban");
        let list = mem.list_orchestrator_templates().await.unwrap();
        assert_eq!(list.len(), 1);
        assert!(
            mem.delete_orchestrator_template("tpl-kanban")
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn orchestrator_job_worker_event_persistence() {
        let mem = test_memory_system().await;
        let job = mem
            .create_orchestrator_job("default", "build this", "mixed")
            .await
            .unwrap();
        mem.add_orchestrator_worker_run(&job.job_id, "worker-a", "existing", "do x", "running", 1)
            .await
            .unwrap();
        mem.add_orchestrator_event(&job.job_id, "job_state_changed", r#"{"state":"planning"}"#)
            .await
            .unwrap();
        let workers = mem
            .list_orchestrator_worker_runs(&job.job_id)
            .await
            .unwrap();
        assert_eq!(workers.len(), 1);
        let events = mem
            .list_orchestrator_events(&job.job_id, 0, 100)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
    }
}
