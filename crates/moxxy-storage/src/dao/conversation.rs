use crate::rows::ConversationLogRow;
use moxxy_types::{MediaAttachmentRef, MediaKind, StorageError};
use rusqlite::{Connection, params};

pub struct ConversationDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> ConversationDao<'a> {
    pub fn insert(&self, row: &ConversationLogRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO conversation_log (id, agent_id, run_id, sequence, role, content, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    row.id,
                    row.agent_id,
                    row.run_id,
                    row.sequence,
                    row.role,
                    row.content,
                    row.created_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn insert_with_attachments(
        &self,
        row: &ConversationLogRow,
        attachments: &[MediaAttachmentRef],
    ) -> Result<(), StorageError> {
        self.insert(row)?;

        for (ordinal, attachment) in attachments.iter().enumerate() {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO conversation_attachments
                     (id, conversation_id, media_id, ordinal, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        uuid::Uuid::now_v7().to_string(),
                        row.id,
                        attachment.id,
                        ordinal as i64,
                        row.created_at,
                    ],
                )
                .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        }

        Ok(())
    }

    pub fn find_by_run(
        &self,
        agent_id: &str,
        run_id: &str,
    ) -> Result<Vec<ConversationLogRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, run_id, sequence, role, content, created_at
                 FROM conversation_log WHERE agent_id = ?1 AND run_id = ?2
                 ORDER BY sequence ASC",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, run_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn find_recent_by_agent(
        &self,
        agent_id: &str,
        limit: u32,
    ) -> Result<Vec<ConversationLogRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, run_id, sequence, role, content, created_at
                 FROM conversation_log WHERE agent_id = ?1
                 ORDER BY created_at DESC, sequence DESC LIMIT ?2",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, limit], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut result: Vec<_> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        // Reverse to chronological order (query returns newest-first)
        result.reverse();
        Ok(result)
    }

    pub fn find_recent_attachments_by_agent_and_kind(
        &self,
        agent_id: &str,
        kind: &str,
        limit: u32,
    ) -> Result<Vec<MediaAttachmentRef>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT ma.id, ma.kind, ma.mime, ma.filename, ma.local_path, ma.size_bytes,
                        ma.sha256, ma.source_json
                 FROM conversation_log cl
                 JOIN conversation_attachments ca ON ca.conversation_id = cl.id
                 JOIN media_assets ma ON ma.id = ca.media_id
                 WHERE cl.agent_id = ?1 AND cl.role = 'user' AND ma.kind = ?2
                 ORDER BY cl.created_at DESC, cl.sequence DESC, ca.ordinal ASC
                 LIMIT ?3",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, kind, limit], Self::map_attachment_ref)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn delete_by_run(&self, agent_id: &str, run_id: &str) -> Result<(), StorageError> {
        self.conn
            .execute(
                "DELETE FROM conversation_log WHERE agent_id = ?1 AND run_id = ?2",
                params![agent_id, run_id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn delete_all_by_agent(&self, agent_id: &str) -> Result<u64, StorageError> {
        let affected = self
            .conn
            .execute(
                "DELETE FROM conversation_log WHERE agent_id = ?1",
                params![agent_id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(affected as u64)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationLogRow> {
        Ok(ConversationLogRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            run_id: row.get(2)?,
            sequence: row.get(3)?,
            role: row.get(4)?,
            content: row.get(5)?,
            created_at: row.get(6)?,
        })
    }

    fn map_attachment_ref(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaAttachmentRef> {
        let kind: String = row.get(1)?;
        let size_bytes: i64 = row.get(5)?;
        let source_json: String = row.get(7)?;
        Ok(MediaAttachmentRef {
            id: row.get(0)?,
            kind: parse_media_kind(&kind),
            mime: row.get(2)?,
            filename: row.get(3)?,
            local_path: row.get(4)?,
            size_bytes: size_bytes.max(0) as u64,
            sha256: row.get(6)?,
            source: serde_json::from_str(&source_json).unwrap_or_else(|_| serde_json::json!({})),
        })
    }
}

fn parse_media_kind(kind: &str) -> MediaKind {
    match kind {
        "image" => MediaKind::Image,
        "document" => MediaKind::Document,
        "audio" => MediaKind::Audio,
        "voice" => MediaKind::Voice,
        "video" => MediaKind::Video,
        _ => MediaKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dao::AgentDao;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    fn seed_agent(db: &TestDb) -> String {
        let agent = fixture_agent_row();
        let dao = AgentDao { conn: db.conn() };
        dao.insert(&agent).unwrap();
        agent.id
    }

    #[test]
    fn insert_and_find_by_run() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        let row = ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_id.clone(),
            run_id: "run-1".into(),
            sequence: 0,
            role: "user".into(),
            content: "Hello".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        dao.insert(&row).unwrap();

        let found = dao.find_by_run(&agent_id, "run-1").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].content, "Hello");
    }

    #[test]
    fn find_by_run_orders_by_sequence() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        for i in (0..3).rev() {
            let row = ConversationLogRow {
                id: uuid::Uuid::now_v7().to_string(),
                agent_id: agent_id.clone(),
                run_id: "run-2".into(),
                sequence: i,
                role: "user".into(),
                content: format!("msg-{}", i),
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            dao.insert(&row).unwrap();
        }

        let found = dao.find_by_run(&agent_id, "run-2").unwrap();
        assert_eq!(found.len(), 3);
        assert_eq!(found[0].sequence, 0);
        assert_eq!(found[1].sequence, 1);
        assert_eq!(found[2].sequence, 2);
    }

    #[test]
    fn delete_by_run_cleans_up() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        let row = ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_id.clone(),
            run_id: "run-del".into(),
            sequence: 0,
            role: "user".into(),
            content: "delete me".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        dao.insert(&row).unwrap();

        dao.delete_by_run(&agent_id, "run-del").unwrap();
        let found = dao.find_by_run(&agent_id, "run-del").unwrap();
        assert!(found.is_empty());
    }

    #[test]
    fn find_returns_empty_for_nonexistent_run() {
        let db = TestDb::new();
        let dao = ConversationDao { conn: db.conn() };
        let found = dao.find_by_run("no-agent", "no-run").unwrap();
        assert!(found.is_empty());
    }

    #[test]
    fn find_recent_by_agent_chronological_across_runs() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        // Insert messages across two runs with distinct timestamps
        for (run, ts) in [
            ("run-a", "2025-01-01T00:00:00Z"),
            ("run-b", "2025-01-02T00:00:00Z"),
        ] {
            for seq in 0..2 {
                let role = if seq == 0 { "user" } else { "assistant" };
                dao.insert(&ConversationLogRow {
                    id: uuid::Uuid::now_v7().to_string(),
                    agent_id: agent_id.clone(),
                    run_id: run.into(),
                    sequence: seq,
                    role: role.into(),
                    content: format!("{run}-{role}"),
                    created_at: ts.into(),
                })
                .unwrap();
            }
        }

        let rows = dao.find_recent_by_agent(&agent_id, 10).unwrap();
        assert_eq!(rows.len(), 4);
        // Chronological: run-a messages first, then run-b
        assert_eq!(rows[0].content, "run-a-user");
        assert_eq!(rows[1].content, "run-a-assistant");
        assert_eq!(rows[2].content, "run-b-user");
        assert_eq!(rows[3].content, "run-b-assistant");
    }

    #[test]
    fn find_recent_by_agent_respects_limit() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        for i in 0..6 {
            dao.insert(&ConversationLogRow {
                id: uuid::Uuid::now_v7().to_string(),
                agent_id: agent_id.clone(),
                run_id: "run-1".into(),
                sequence: i,
                role: "user".into(),
                content: format!("msg-{i}"),
                created_at: format!("2025-01-01T00:00:0{i}Z"),
            })
            .unwrap();
        }

        let rows = dao.find_recent_by_agent(&agent_id, 4).unwrap();
        assert_eq!(rows.len(), 4);
        // Should get the newest 4 in chronological order
        assert_eq!(rows[0].content, "msg-2");
        assert_eq!(rows[3].content, "msg-5");
    }

    #[test]
    fn find_recent_by_agent_unknown_agent_returns_empty() {
        let db = TestDb::new();
        let dao = ConversationDao { conn: db.conn() };
        let rows = dao.find_recent_by_agent("nonexistent", 10).unwrap();
        assert!(rows.is_empty());
    }

    fn seed_second_agent(db: &TestDb) -> String {
        let mut agent = fixture_agent_row();
        agent.id = uuid::Uuid::now_v7().to_string();
        agent.name = Some("test-agent-2".into());
        let dao = AgentDao { conn: db.conn() };
        dao.insert(&agent).unwrap();
        agent.id
    }

    #[test]
    fn delete_all_by_agent_clears_across_runs() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        for run in ["run-1", "run-2", "run-3"] {
            dao.insert(&ConversationLogRow {
                id: uuid::Uuid::now_v7().to_string(),
                agent_id: agent_id.clone(),
                run_id: run.into(),
                sequence: 0,
                role: "user".into(),
                content: format!("msg-{run}"),
                created_at: chrono::Utc::now().to_rfc3339(),
            })
            .unwrap();
        }

        let count = dao.delete_all_by_agent(&agent_id).unwrap();
        assert_eq!(count, 3);

        let found = dao.find_recent_by_agent(&agent_id, 100).unwrap();
        assert!(found.is_empty());
    }

    #[test]
    fn delete_all_by_agent_isolates_agents() {
        let db = TestDb::new();
        let agent_a = seed_agent(&db);
        let agent_b = seed_second_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        dao.insert(&ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_a.clone(),
            run_id: "run-1".into(),
            sequence: 0,
            role: "user".into(),
            content: "a-msg".into(),
            created_at: "2025-01-01T00:00:00Z".into(),
        })
        .unwrap();

        dao.insert(&ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_b.clone(),
            run_id: "run-2".into(),
            sequence: 0,
            role: "user".into(),
            content: "b-msg".into(),
            created_at: "2025-01-01T00:00:00Z".into(),
        })
        .unwrap();

        let count = dao.delete_all_by_agent(&agent_a).unwrap();
        assert_eq!(count, 1);

        // Agent B's data is untouched
        let found = dao.find_recent_by_agent(&agent_b, 10).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].content, "b-msg");
    }

    #[test]
    fn delete_all_by_agent_returns_zero_for_clean_agent() {
        let db = TestDb::new();
        let dao = ConversationDao { conn: db.conn() };
        let count = dao.delete_all_by_agent("nonexistent").unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn find_recent_by_agent_isolates_agents() {
        let db = TestDb::new();
        let agent_a = seed_agent(&db);
        let agent_b = seed_second_agent(&db);
        let dao = ConversationDao { conn: db.conn() };

        dao.insert(&ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_a.clone(),
            run_id: "run-1".into(),
            sequence: 0,
            role: "user".into(),
            content: "agent-a-msg".into(),
            created_at: "2025-01-01T00:00:00Z".into(),
        })
        .unwrap();

        dao.insert(&ConversationLogRow {
            id: uuid::Uuid::now_v7().to_string(),
            agent_id: agent_b.clone(),
            run_id: "run-2".into(),
            sequence: 0,
            role: "user".into(),
            content: "agent-b-msg".into(),
            created_at: "2025-01-01T00:00:00Z".into(),
        })
        .unwrap();

        let rows_a = dao.find_recent_by_agent(&agent_a, 10).unwrap();
        assert_eq!(rows_a.len(), 1);
        assert_eq!(rows_a[0].content, "agent-a-msg");

        let rows_b = dao.find_recent_by_agent(&agent_b, 10).unwrap();
        assert_eq!(rows_b.len(), 1);
        assert_eq!(rows_b[0].content, "agent-b-msg");
    }

    #[test]
    fn insert_with_attachments_can_find_recent_document_refs() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = ConversationDao { conn: db.conn() };
        let media = moxxy_types::MediaAttachmentRef {
            id: "media_pdf".into(),
            kind: moxxy_types::MediaKind::Document,
            mime: "application/pdf".into(),
            filename: "brief.pdf".into(),
            local_path: "/tmp/.moxxy/media/brief.pdf".into(),
            size_bytes: 128,
            sha256: "pdf-sha".into(),
            source: serde_json::json!({"channel": "telegram"}),
        };
        db.conn()
            .execute(
                "INSERT INTO media_assets
                 (id, kind, mime, filename, local_path, size_bytes, sha256, source_json, created_at)
                 VALUES (?1, 'document', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    media.id,
                    media.mime,
                    media.filename,
                    media.local_path,
                    media.size_bytes as i64,
                    media.sha256,
                    media.source.to_string(),
                    "2026-05-04T12:00:00Z",
                ],
            )
            .unwrap();

        dao.insert_with_attachments(
            &ConversationLogRow {
                id: "msg-1".into(),
                agent_id: agent_id.clone(),
                run_id: "run-1".into(),
                sequence: 0,
                role: "user".into(),
                content: "Analyze the attached document.".into(),
                created_at: "2026-05-04T12:00:00Z".into(),
            },
            std::slice::from_ref(&media),
        )
        .unwrap();

        let found = dao
            .find_recent_attachments_by_agent_and_kind(&agent_id, "document", 1)
            .unwrap();

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "media_pdf");
        assert_eq!(found[0].kind, moxxy_types::MediaKind::Document);
        assert_eq!(found[0].filename, "brief.pdf");
    }
}
