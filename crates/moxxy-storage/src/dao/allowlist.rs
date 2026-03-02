use crate::rows::AllowlistRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct AllowlistDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> AllowlistDao<'a> {
    pub fn insert(&self, row: &AllowlistRow) -> Result<(), StorageError> {
        let result = self.conn.execute(
            "INSERT INTO agent_allowlists (id, agent_id, list_type, entry, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![row.id, row.agent_id, row.list_type, row.entry, row.created_at],
        );

        match result {
            Ok(_) => Ok(()),
            Err(e) if e.to_string().contains("UNIQUE") => {
                Err(StorageError::DuplicateKey(format!(
                    "allowlist entry '{}' already exists for agent '{}' type '{}'",
                    row.entry, row.agent_id, row.list_type
                )))
            }
            Err(e) => Err(StorageError::QueryFailed(e.to_string())),
        }
    }

    pub fn list_by_agent_and_type(
        &self,
        agent_id: &str,
        list_type: &str,
    ) -> Result<Vec<AllowlistRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, list_type, entry, created_at
                 FROM agent_allowlists WHERE agent_id = ?1 AND list_type = ?2",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, list_type], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn list_entries(
        &self,
        agent_id: &str,
        list_type: &str,
    ) -> Result<Vec<String>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT entry FROM agent_allowlists WHERE agent_id = ?1 AND list_type = ?2",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id, list_type], |row| row.get::<_, String>(0))
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn delete_entry(
        &self,
        agent_id: &str,
        list_type: &str,
        entry: &str,
    ) -> Result<(), StorageError> {
        self.conn
            .execute(
                "DELETE FROM agent_allowlists WHERE agent_id = ?1 AND list_type = ?2 AND entry = ?3",
                params![agent_id, list_type, entry],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn delete_all_for_agent(&self, agent_id: &str) -> Result<(), StorageError> {
        self.conn
            .execute(
                "DELETE FROM agent_allowlists WHERE agent_id = ?1",
                params![agent_id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn copy_from_agent(
        &self,
        source_agent_id: &str,
        target_agent_id: &str,
    ) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO agent_allowlists (id, agent_id, list_type, entry, created_at)
                 SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
                        ?2, list_type, entry, datetime('now')
                 FROM agent_allowlists WHERE agent_id = ?1",
                params![source_agent_id, target_agent_id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AllowlistRow> {
        Ok(AllowlistRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            list_type: row.get(2)?,
            entry: row.get(3)?,
            created_at: row.get(4)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    fn seed_agent(db: &TestDb) -> String {
        let provider = fixture_provider_row();
        db.conn()
            .execute(
                "INSERT INTO providers (id, display_name, manifest_path, signature, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    provider.id, provider.display_name, provider.manifest_path,
                    provider.signature, provider.enabled, provider.created_at,
                ],
            )
            .unwrap();

        let agent = fixture_agent_row();
        db.conn()
            .execute(
                "INSERT INTO agents (id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    agent.id, agent.parent_agent_id, agent.provider_id, agent.model_id,
                    agent.workspace_root, agent.core_mount, agent.policy_profile, agent.temperature,
                    agent.max_subagent_depth, agent.max_subagents_total, agent.status, agent.depth,
                    agent.spawned_total, agent.created_at, agent.updated_at,
                ],
            )
            .unwrap();
        agent.id
    }

    #[test]
    fn insert_and_list_entries() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = AllowlistDao { conn: db.conn() };

        let row = fixture_allowlist_row(&agent_id, "shell_command", "ls");
        dao.insert(&row).unwrap();

        let row2 = fixture_allowlist_row(&agent_id, "shell_command", "cat");
        dao.insert(&row2).unwrap();

        let entries = dao.list_entries(&agent_id, "shell_command").unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.contains(&"ls".to_string()));
        assert!(entries.contains(&"cat".to_string()));
    }

    #[test]
    fn insert_duplicate_returns_error() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = AllowlistDao { conn: db.conn() };

        let row = fixture_allowlist_row(&agent_id, "shell_command", "ls");
        dao.insert(&row).unwrap();

        let row2 = fixture_allowlist_row(&agent_id, "shell_command", "ls");
        let result = dao.insert(&row2);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), StorageError::DuplicateKey(_)));
    }

    #[test]
    fn list_by_agent_and_type() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = AllowlistDao { conn: db.conn() };

        dao.insert(&fixture_allowlist_row(&agent_id, "shell_command", "ls")).unwrap();
        dao.insert(&fixture_allowlist_row(&agent_id, "http_domain", "example.com")).unwrap();

        let shell = dao.list_by_agent_and_type(&agent_id, "shell_command").unwrap();
        assert_eq!(shell.len(), 1);
        assert_eq!(shell[0].entry, "ls");

        let http = dao.list_by_agent_and_type(&agent_id, "http_domain").unwrap();
        assert_eq!(http.len(), 1);
        assert_eq!(http[0].entry, "example.com");
    }

    #[test]
    fn delete_entry() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = AllowlistDao { conn: db.conn() };

        dao.insert(&fixture_allowlist_row(&agent_id, "shell_command", "ls")).unwrap();
        dao.insert(&fixture_allowlist_row(&agent_id, "shell_command", "cat")).unwrap();

        dao.delete_entry(&agent_id, "shell_command", "ls").unwrap();

        let entries = dao.list_entries(&agent_id, "shell_command").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0], "cat");
    }

    #[test]
    fn delete_all_for_agent() {
        let db = TestDb::new();
        let agent_id = seed_agent(&db);
        let dao = AllowlistDao { conn: db.conn() };

        dao.insert(&fixture_allowlist_row(&agent_id, "shell_command", "ls")).unwrap();
        dao.insert(&fixture_allowlist_row(&agent_id, "http_domain", "example.com")).unwrap();

        dao.delete_all_for_agent(&agent_id).unwrap();

        let shell = dao.list_entries(&agent_id, "shell_command").unwrap();
        let http = dao.list_entries(&agent_id, "http_domain").unwrap();
        assert!(shell.is_empty());
        assert!(http.is_empty());
    }

    #[test]
    fn copy_from_agent() {
        let db = TestDb::new();
        let source_id = seed_agent(&db);
        let dao = AllowlistDao { conn: db.conn() };

        dao.insert(&fixture_allowlist_row(&source_id, "shell_command", "ls")).unwrap();
        dao.insert(&fixture_allowlist_row(&source_id, "shell_command", "cat")).unwrap();
        dao.insert(&fixture_allowlist_row(&source_id, "http_domain", "example.com")).unwrap();

        // Create a second agent for the target
        let target_id = uuid::Uuid::now_v7().to_string();
        db.conn()
            .execute(
                "INSERT INTO agents (id, parent_agent_id, provider_id, model_id, workspace_root,
                 core_mount, policy_profile, temperature, max_subagent_depth, max_subagents_total,
                 status, depth, spawned_total, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    target_id, Option::<String>::None, "test-provider", "test-model",
                    "/tmp/workspace", Option::<String>::None, Option::<String>::None,
                    0.7, 2, 8, "idle", 1, 0,
                    chrono::Utc::now().to_rfc3339(), chrono::Utc::now().to_rfc3339(),
                ],
            )
            .unwrap();

        dao.copy_from_agent(&source_id, &target_id).unwrap();

        let shell = dao.list_entries(&target_id, "shell_command").unwrap();
        assert_eq!(shell.len(), 2);
        assert!(shell.contains(&"ls".to_string()));
        assert!(shell.contains(&"cat".to_string()));

        let http = dao.list_entries(&target_id, "http_domain").unwrap();
        assert_eq!(http.len(), 1);
        assert!(http.contains(&"example.com".to_string()));
    }

    #[test]
    fn list_entries_empty_for_nonexistent() {
        let db = TestDb::new();
        let dao = AllowlistDao { conn: db.conn() };
        let entries = dao.list_entries("nonexistent", "shell_command").unwrap();
        assert!(entries.is_empty());
    }
}
