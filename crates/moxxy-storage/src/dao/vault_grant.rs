use crate::rows::VaultGrantRow;
use moxxy_types::StorageError;
use rusqlite::{Connection, params};

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
            Some(r) => Ok(Some(
                r.map_err(|e| StorageError::QueryFailed(e.to_string()))?,
            )),
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

    pub fn find_by_agent_and_secret(
        &self,
        agent_id: &str,
        secret_ref_id: &str,
    ) -> Result<Option<VaultGrantRow>, StorageError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, agent_id, secret_ref_id, created_at, revoked_at
                 FROM vault_grants WHERE agent_id = ?1 AND secret_ref_id = ?2",
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        let mut rows = stmt
            .query_map(params![agent_id, secret_ref_id], Self::map_row)
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        match rows.next() {
            Some(r) => Ok(Some(
                r.map_err(|e| StorageError::QueryFailed(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }

    /// Re-activate a revoked grant by clearing revoked_at.
    pub fn unrevoke(&self, id: &str) -> Result<(), StorageError> {
        let affected = self
            .conn
            .execute(
                "UPDATE vault_grants SET revoked_at = NULL WHERE id = ?1",
                params![id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;

        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
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

    /// Copy all active (non-revoked) grants from one agent to another.
    /// Used when spawning sub-agents so they inherit the parent's secret access.
    pub fn copy_from_agent(
        &self,
        source_agent_id: &str,
        target_agent_id: &str,
    ) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO vault_grants (id, agent_id, secret_ref_id, created_at, revoked_at)
                 SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
                        ?2, secret_ref_id, datetime('now'), NULL
                 FROM vault_grants WHERE agent_id = ?1 AND revoked_at IS NULL",
                params![source_agent_id, target_agent_id],
            )
            .map_err(|e| StorageError::QueryFailed(e.to_string()))?;
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
    use crate::dao::AgentDao;
    use crate::fixtures::*;
    use moxxy_test_utils::TestDb;

    fn seed_agent_and_secret(db: &TestDb) -> (String, String) {
        let agent = fixture_agent_row();
        let agent_dao = AgentDao { conn: db.conn() };
        agent_dao.insert(&agent).unwrap();

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

    #[test]
    fn copy_from_agent_copies_active_grants() {
        let db = TestDb::new();
        let (agent_id, secret_id) = seed_agent_and_secret(&db);
        let dao = VaultGrantDao { conn: db.conn() };

        // Create an active grant for the source agent
        let mut grant = fixture_vault_grant_row();
        grant.agent_id = agent_id.clone();
        grant.secret_ref_id = secret_id.clone();
        dao.insert(&grant).unwrap();

        // Revoke it so we can verify revoked grants are NOT copied
        dao.revoke(&grant.id).unwrap();

        // Create a second secret ref + active grant to verify copying works
        let now = chrono::Utc::now().to_rfc3339();
        db.conn()
            .execute(
                "INSERT INTO vault_secret_refs (id, key_name, backend_key, policy_label, created_at, updated_at)
                 VALUES ('secret-2', 'other-key', 'backend-other', 'default', ?1, ?1)",
                params![now],
            )
            .unwrap();
        let active_grant = VaultGrantRow {
            id: "grant-active".into(),
            agent_id: agent_id.clone(),
            secret_ref_id: "secret-2".into(),
            created_at: now.clone(),
            revoked_at: None,
        };
        dao.insert(&active_grant).unwrap();

        // Insert target agent
        let target_agent = crate::AgentRow {
            id: "child-agent".into(),
            parent_agent_id: Some(agent_id.clone()),
            name: Some("child-agent".into()),
            ..fixture_agent_row()
        };
        let agent_dao = AgentDao { conn: db.conn() };
        agent_dao.insert(&target_agent).unwrap();

        // Copy grants from parent to child
        dao.copy_from_agent(&agent_id, "child-agent").unwrap();

        // Target should have exactly 1 grant (only the active one, not the revoked)
        let target_grants = dao.find_by_agent("child-agent").unwrap();
        assert_eq!(target_grants.len(), 1);
        assert_eq!(target_grants[0].secret_ref_id, "secret-2");
        assert!(target_grants[0].revoked_at.is_none());
    }
}
