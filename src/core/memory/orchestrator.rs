use anyhow::Result;
use rusqlite::params;

use super::MemorySystem;
use super::types::{OrchestratorEventRecord, OrchestratorJobRecord, OrchestratorWorkerRunRecord};

impl MemorySystem {
    pub async fn set_orchestrator_config(
        &self,
        config: &crate::core::orchestrator::OrchestratorAgentConfig,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let json = serde_json::to_string(config)?;
        db.execute(
            "INSERT OR REPLACE INTO orchestrator_config (id, config_json, updated_at) VALUES (1, ?1, CURRENT_TIMESTAMP)",
            params![json],
        )?;
        Ok(())
    }

    pub async fn get_orchestrator_config(
        &self,
    ) -> Result<Option<crate::core::orchestrator::OrchestratorAgentConfig>> {
        let db = self.db.lock().await;
        let mut stmt =
            db.prepare("SELECT config_json FROM orchestrator_config WHERE id = 1 LIMIT 1")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            let json: String = row.get(0)?;
            let cfg = serde_json::from_str(&json)?;
            Ok(Some(cfg))
        } else {
            Ok(None)
        }
    }

    pub async fn upsert_orchestrator_template(
        &self,
        template: &crate::core::orchestrator::OrchestratorTemplate,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let json = serde_json::to_string(template)?;
        db.execute(
            "INSERT OR REPLACE INTO orchestrator_templates (template_id, template_json, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)",
            params![template.template_id, json],
        )?;
        Ok(())
    }

    pub async fn get_orchestrator_template(
        &self,
        template_id: &str,
    ) -> Result<Option<crate::core::orchestrator::OrchestratorTemplate>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT template_json FROM orchestrator_templates WHERE template_id = ?1 LIMIT 1",
        )?;
        let mut rows = stmt.query(params![template_id])?;
        if let Some(row) = rows.next()? {
            let json: String = row.get(0)?;
            Ok(Some(serde_json::from_str(&json)?))
        } else {
            Ok(None)
        }
    }

    pub async fn list_orchestrator_templates(
        &self,
    ) -> Result<Vec<crate::core::orchestrator::OrchestratorTemplate>> {
        let db = self.db.lock().await;
        let mut stmt = db
            .prepare("SELECT template_json FROM orchestrator_templates ORDER BY template_id ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            let json = row?;
            out.push(serde_json::from_str(&json)?);
        }
        Ok(out)
    }

    pub async fn delete_orchestrator_template(&self, template_id: &str) -> Result<bool> {
        let db = self.db.lock().await;
        let rows = db.execute(
            "DELETE FROM orchestrator_templates WHERE template_id = ?1",
            params![template_id],
        )?;
        Ok(rows > 0)
    }

    pub async fn create_orchestrator_job(
        &self,
        agent_name: &str,
        prompt: &str,
        worker_mode: &str,
    ) -> Result<OrchestratorJobRecord> {
        let job_id = uuid::Uuid::new_v4().to_string();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO orchestrator_jobs (job_id, agent_name, status, prompt, worker_mode) VALUES (?1, ?2, 'queued', ?3, ?4)",
            params![job_id, agent_name, prompt, worker_mode],
        )?;
        let rec = db.query_row(
            "SELECT job_id, agent_name, status, prompt, worker_mode, summary, error, created_at, updated_at, finished_at
             FROM orchestrator_jobs WHERE job_id = ?1",
            params![job_id],
            |row| {
                Ok(OrchestratorJobRecord {
                    job_id: row.get(0)?,
                    agent_name: row.get(1)?,
                    status: row.get(2)?,
                    prompt: row.get(3)?,
                    worker_mode: row.get(4)?,
                    summary: row.get(5)?,
                    error: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    finished_at: row.get(9)?,
                })
            },
        )?;
        Ok(rec)
    }

    pub async fn get_orchestrator_job(
        &self,
        job_id: &str,
    ) -> Result<Option<OrchestratorJobRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT job_id, agent_name, status, prompt, worker_mode, summary, error, created_at, updated_at, finished_at
             FROM orchestrator_jobs WHERE job_id = ?1 LIMIT 1",
        )?;
        let mut rows = stmt.query(params![job_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(OrchestratorJobRecord {
                job_id: row.get(0)?,
                agent_name: row.get(1)?,
                status: row.get(2)?,
                prompt: row.get(3)?,
                worker_mode: row.get(4)?,
                summary: row.get(5)?,
                error: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                finished_at: row.get(9)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn list_orchestrator_jobs(&self, limit: usize) -> Result<Vec<OrchestratorJobRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT job_id, agent_name, status, prompt, worker_mode, summary, error, created_at, updated_at, finished_at
             FROM orchestrator_jobs ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(OrchestratorJobRecord {
                job_id: row.get(0)?,
                agent_name: row.get(1)?,
                status: row.get(2)?,
                prompt: row.get(3)?,
                worker_mode: row.get(4)?,
                summary: row.get(5)?,
                error: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                finished_at: row.get(9)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub async fn update_orchestrator_job_status(
        &self,
        job_id: &str,
        status: &str,
        summary: Option<&str>,
        error: Option<&str>,
    ) -> Result<bool> {
        let db = self.db.lock().await;
        let mark_finished = matches!(status, "completed" | "failed" | "canceled");
        let rows = if mark_finished {
            db.execute(
                "UPDATE orchestrator_jobs
                 SET status = ?1, summary = COALESCE(?2, summary), error = COALESCE(?3, error), updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP
                 WHERE job_id = ?4",
                params![status, summary, error, job_id],
            )?
        } else {
            db.execute(
                "UPDATE orchestrator_jobs
                 SET status = ?1, summary = COALESCE(?2, summary), error = COALESCE(?3, error), updated_at = CURRENT_TIMESTAMP
                 WHERE job_id = ?4",
                params![status, summary, error, job_id],
            )?
        };
        Ok(rows > 0)
    }

    pub async fn add_orchestrator_worker_run(
        &self,
        job_id: &str,
        worker_agent: &str,
        worker_mode: &str,
        task_prompt: &str,
        status: &str,
        attempt: i64,
    ) -> Result<OrchestratorWorkerRunRecord> {
        let worker_run_id = uuid::Uuid::new_v4().to_string();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO orchestrator_worker_runs
             (worker_run_id, job_id, worker_agent, worker_mode, task_prompt, status, attempt, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)",
            params![worker_run_id, job_id, worker_agent, worker_mode, task_prompt, status, attempt],
        )?;

        let rec = db.query_row(
            "SELECT worker_run_id, job_id, worker_agent, worker_mode, task_prompt, status, attempt, started_at, finished_at, output, error
             FROM orchestrator_worker_runs WHERE worker_run_id = ?1",
            params![worker_run_id],
            |row| {
                Ok(OrchestratorWorkerRunRecord {
                    worker_run_id: row.get(0)?,
                    job_id: row.get(1)?,
                    worker_agent: row.get(2)?,
                    worker_mode: row.get(3)?,
                    task_prompt: row.get(4)?,
                    status: row.get(5)?,
                    attempt: row.get(6)?,
                    started_at: row.get(7)?,
                    finished_at: row.get(8)?,
                    output: row.get(9)?,
                    error: row.get(10)?,
                })
            },
        )?;
        Ok(rec)
    }

    pub async fn update_orchestrator_worker_run(
        &self,
        worker_run_id: &str,
        status: &str,
        output: Option<&str>,
        error: Option<&str>,
    ) -> Result<bool> {
        let db = self.db.lock().await;
        let finished = matches!(status, "succeeded" | "failed" | "canceled");
        let rows = if finished {
            db.execute(
                "UPDATE orchestrator_worker_runs
                 SET status = ?1, output = COALESCE(?2, output), error = COALESCE(?3, error), finished_at = CURRENT_TIMESTAMP
                 WHERE worker_run_id = ?4",
                params![status, output, error, worker_run_id],
            )?
        } else {
            db.execute(
                "UPDATE orchestrator_worker_runs
                 SET status = ?1, output = COALESCE(?2, output), error = COALESCE(?3, error)
                 WHERE worker_run_id = ?4",
                params![status, output, error, worker_run_id],
            )?
        };
        Ok(rows > 0)
    }

    pub async fn list_orchestrator_worker_runs(
        &self,
        job_id: &str,
    ) -> Result<Vec<OrchestratorWorkerRunRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT worker_run_id, job_id, worker_agent, worker_mode, task_prompt, status, attempt, started_at, finished_at, output, error
             FROM orchestrator_worker_runs WHERE job_id = ?1 ORDER BY started_at ASC",
        )?;
        let rows = stmt.query_map(params![job_id], |row| {
            Ok(OrchestratorWorkerRunRecord {
                worker_run_id: row.get(0)?,
                job_id: row.get(1)?,
                worker_agent: row.get(2)?,
                worker_mode: row.get(3)?,
                task_prompt: row.get(4)?,
                status: row.get(5)?,
                attempt: row.get(6)?,
                started_at: row.get(7)?,
                finished_at: row.get(8)?,
                output: row.get(9)?,
                error: row.get(10)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub async fn add_orchestrator_event(
        &self,
        job_id: &str,
        event_type: &str,
        payload_json: &str,
    ) -> Result<OrchestratorEventRecord> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO orchestrator_events (job_id, event_type, payload_json) VALUES (?1, ?2, ?3)",
            params![job_id, event_type, payload_json],
        )?;
        let id = db.last_insert_rowid();
        let rec = db.query_row(
            "SELECT id, job_id, event_type, payload_json, created_at FROM orchestrator_events WHERE id = ?1",
            params![id],
            |row| {
                Ok(OrchestratorEventRecord {
                    id: row.get(0)?,
                    job_id: row.get(1)?,
                    event_type: row.get(2)?,
                    payload_json: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )?;
        Ok(rec)
    }

    pub async fn list_orchestrator_events(
        &self,
        job_id: &str,
        after_id: i64,
        limit: usize,
    ) -> Result<Vec<OrchestratorEventRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, job_id, event_type, payload_json, created_at
             FROM orchestrator_events WHERE job_id = ?1 AND id > ?2 ORDER BY id ASC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![job_id, after_id, limit as i64], |row| {
            Ok(OrchestratorEventRecord {
                id: row.get(0)?,
                job_id: row.get(1)?,
                event_type: row.get(2)?,
                payload_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}
