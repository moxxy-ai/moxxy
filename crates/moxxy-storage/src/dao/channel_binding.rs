use crate::rows::ChannelBindingRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

pub struct ChannelBindingDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> ChannelBindingDao<'a> {
    pub fn insert(&self, row: &ChannelBindingRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO channel_bindings (id, channel_id, agent_id, external_chat_id, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    row.id,
                    row.channel_id,
                    row.agent_id,
                    row.external_chat_id,
                    row.status,
                    row.created_at,
                    row.updated_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<ChannelBindingRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, channel_id, agent_id, external_chat_id, status, created_at, updated_at
                 FROM channel_bindings WHERE id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(
                r.map_err(|e| StorageError::QueryFailed(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }

    pub fn find_by_channel(
        &self,
        channel_id: &str,
    ) -> Result<Vec<ChannelBindingRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, channel_id, agent_id, external_chat_id, status, created_at, updated_at
                 FROM channel_bindings WHERE channel_id = ?1 AND status = 'active'",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![channel_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn find_by_agent(&self, agent_id: &str) -> Result<Vec<ChannelBindingRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, channel_id, agent_id, external_chat_id, status, created_at, updated_at
                 FROM channel_bindings WHERE agent_id = ?1 AND status = 'active'",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn find_by_external_chat(
        &self,
        channel_id: &str,
        external_chat_id: &str,
    ) -> Result<Option<ChannelBindingRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, channel_id, agent_id, external_chat_id, status, created_at, updated_at
                 FROM channel_bindings WHERE channel_id = ?1 AND external_chat_id = ?2 AND status = 'active'",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![channel_id, external_chat_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(
                r.map_err(|e| StorageError::QueryFailed(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }

    pub fn update_status(&self, id: &str, status: &str) -> Result<(), StorageError> {
        let now = chrono::Utc::now().to_rfc3339();
        let affected = self
            .conn
            .execute(
                "UPDATE channel_bindings SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![status, now, id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute("DELETE FROM channel_bindings WHERE id = ?1", params![id])
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChannelBindingRow> {
        Ok(ChannelBindingRow {
            id: row.get(0)?,
            channel_id: row.get(1)?,
            agent_id: row.get(2)?,
            external_chat_id: row.get(3)?,
            status: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dao::channel::ChannelDao;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    fn seed_channel(db: &TestDb) -> (String, String) {
        let secret = fixture_vault_secret_ref_row();
        db.conn()
            .execute(
                "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    secret.id, secret.key_name, secret.backend_key,
                    secret.policy_label, secret.created_at, secret.updated_at,
                ],
            )
            .unwrap();

        let provider = fixture_provider_row();
        db.conn()
            .execute(
                "INSERT INTO providers (id, display_name, manifest_path, signature, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
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
                rusqlite::params![
                    agent.id,
                    agent.parent_agent_id,
                    agent.provider_id,
                    agent.model_id,
                    agent.workspace_root,
                    agent.core_mount,
                    agent.policy_profile,
                    agent.temperature,
                    agent.max_subagent_depth,
                    agent.max_subagents_total,
                    agent.status,
                    agent.depth,
                    agent.spawned_total,
                    agent.created_at,
                    agent.updated_at,
                ],
            )
            .unwrap();

        let mut channel = fixture_channel_row();
        channel.vault_secret_ref_id = secret.id;
        let channel_dao = ChannelDao { conn: db.conn() };
        channel_dao.insert(&channel).unwrap();

        (channel.id, agent.id)
    }

    #[test]
    fn insert_and_find_by_id() {
        let db = TestDb::new();
        let (channel_id, agent_id) = seed_channel(&db);
        let dao = ChannelBindingDao { conn: db.conn() };
        let mut binding = fixture_channel_binding_row();
        binding.channel_id = channel_id;
        binding.agent_id = agent_id;
        dao.insert(&binding).unwrap();
        let found = dao.find_by_id(&binding.id).unwrap().unwrap();
        assert_eq!(found.id, binding.id);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = ChannelBindingDao { conn: db.conn() };
        assert!(dao.find_by_id("nonexistent").unwrap().is_none());
    }

    #[test]
    fn find_by_channel() {
        let db = TestDb::new();
        let (channel_id, agent_id) = seed_channel(&db);
        let dao = ChannelBindingDao { conn: db.conn() };
        let mut binding = fixture_channel_binding_row();
        binding.channel_id = channel_id.clone();
        binding.agent_id = agent_id;
        dao.insert(&binding).unwrap();
        let found = dao.find_by_channel(&channel_id).unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn find_by_agent() {
        let db = TestDb::new();
        let (channel_id, agent_id) = seed_channel(&db);
        let dao = ChannelBindingDao { conn: db.conn() };
        let mut binding = fixture_channel_binding_row();
        binding.channel_id = channel_id;
        binding.agent_id = agent_id.clone();
        dao.insert(&binding).unwrap();
        let found = dao.find_by_agent(&agent_id).unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn find_by_external_chat() {
        let db = TestDb::new();
        let (channel_id, agent_id) = seed_channel(&db);
        let dao = ChannelBindingDao { conn: db.conn() };
        let mut binding = fixture_channel_binding_row();
        binding.channel_id = channel_id.clone();
        binding.agent_id = agent_id;
        dao.insert(&binding).unwrap();
        let found = dao
            .find_by_external_chat(&channel_id, &binding.external_chat_id)
            .unwrap()
            .unwrap();
        assert_eq!(found.id, binding.id);
    }

    #[test]
    fn delete_binding() {
        let db = TestDb::new();
        let (channel_id, agent_id) = seed_channel(&db);
        let dao = ChannelBindingDao { conn: db.conn() };
        let mut binding = fixture_channel_binding_row();
        binding.channel_id = channel_id;
        binding.agent_id = agent_id;
        dao.insert(&binding).unwrap();
        dao.delete(&binding.id).unwrap();
        assert!(dao.find_by_id(&binding.id).unwrap().is_none());
    }
}
