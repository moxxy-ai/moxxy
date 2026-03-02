use rusqlite::{Connection, params};
use moxxy_types::StorageError;
use crate::rows::VaultGrantRow;

pub struct VaultGrantDao<'a> {
    pub conn: &'a Connection,
}

impl<'a> VaultGrantDao<'a> {
    pub fn insert(&self, row: &VaultGrantRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO vault_grants (id, agent_id, secret_ref_id, created_at, revoked_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    row.id,
                    row.agent_id,
                    row.secret_ref_id,
                    row.created_at,
                    row.revoked_at,
                ],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<VaultGrantRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, secret_ref_id, created_at, revoked_at
                 FROM vault_grants WHERE id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(r.map_err(|e| StorageError::QueryFailed(e.to_string()))?)),
            None => Ok(None),
        }
    }

    pub fn find_by_agent(&self, agent_id: &str) -> Result<Vec<VaultGrantRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, secret_ref_id, created_at, revoked_at
                 FROM vault_grants WHERE agent_id = ?1",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map(params![agent_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    pub fn revoke(&self, id: &str) -> Result<(), StorageError> {
        let now = chrono::Utc::now().to_rfc3339();
        let affected = self
            .conn
            .execute(
                "UPDATE vault_grants SET revoked_at = ?1 WHERE id = ?2",
                params![now, id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn list_all(&self) -> Result<Vec<VaultGrantRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, secret_ref_id, created_at, revoked_at
                 FROM vault_grants",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| StorageError::QueryFailed(e.to_string()))
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VaultGrantRow> {
        Ok(VaultGrantRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            secret_ref_id: row.get(2)?,
            created_at: row.get(3)?,
            revoked_at: row.get(4)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_test_utils::TestDb;
    use crate::fixtures::*;

    fn seed_agent_and_secret(db: &TestDb) -> (String, String) {
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
                    agent.max_subagent_depth, agent.max_subagents_total, agent.status,
                    agent.depth, agent.spawned_total, agent.created_at, agent.updated_at,
                ],
            )
            .unwrap();

        let secret = fixture_vault_secret_ref_row();
        db.conn()
            .execute(
                "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    secret.id, secret.key_name, secret.backend_key,
                    secret.policy_label, secret.created_at, secret.updated_at,
                ],
            )
            .unwrap();

        (agent.id, secret.id)
    }

    #[test]
    fn insert_and_find_by_id() {
        let db = TestDb::new();
        let (agent_id, secret_id) = seed_agent_and_secret(&db);
        let dao = VaultGrantDao { conn: db.conn() };
        let mut grant = fixture_vault_grant_row();
        grant.agent_id = agent_id;
        grant.secret_ref_id = secret_id;
        dao.insert(&grant).unwrap();
        let found = dao.find_by_id(&grant.id).unwrap().unwrap();
        assert_eq!(found.id, grant.id);
    }

    #[test]
    fn find_returns_none_for_missing() {
        let db = TestDb::new();
        let dao = VaultGrantDao { conn: db.conn() };
        let found = dao.find_by_id("nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn find_by_agent() {
        let db = TestDb::new();
        let (agent_id, secret_id) = seed_agent_and_secret(&db);
        let dao = VaultGrantDao { conn: db.conn() };
        let mut grant = fixture_vault_grant_row();
        grant.agent_id = agent_id.clone();
        grant.secret_ref_id = secret_id;
        dao.insert(&grant).unwrap();
        let found = dao.find_by_agent(&agent_id).unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn revoke_grant() {
        let db = TestDb::new();
        let (agent_id, secret_id) = seed_agent_and_secret(&db);
        let dao = VaultGrantDao { conn: db.conn() };
        let mut grant = fixture_vault_grant_row();
        grant.agent_id = agent_id;
        grant.secret_ref_id = secret_id;
        dao.insert(&grant).unwrap();
        dao.revoke(&grant.id).unwrap();
        let found = dao.find_by_id(&grant.id).unwrap().unwrap();
        assert!(found.revoked_at.is_some());
    }

    #[test]
    fn list_all() {
        let db = TestDb::new();
        let (agent_id, secret_id) = seed_agent_and_secret(&db);
        let dao = VaultGrantDao { conn: db.conn() };
        let mut grant = fixture_vault_grant_row();
        grant.agent_id = agent_id;
        grant.secret_ref_id = secret_id;
        dao.insert(&grant).unwrap();
        let all = dao.list_all().unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn revoke_nonexistent_returns_not_found() {
        let db = TestDb::new();
        let dao = VaultGrantDao { conn: db.conn() };
        let result = dao.revoke("nonexistent");
        assert!(matches!(result, Err(StorageError::NotFound)));
    }
}
