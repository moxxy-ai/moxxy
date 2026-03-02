pub mod backend;
pub mod policy;
pub mod service;

pub use backend::{InMemoryBackend, SecretBackend};
pub use policy::VaultPolicy;
pub use service::VaultService;

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_test_utils::TestDb;
    use rusqlite::params;

    /// Seed a provider + agent row so FK constraints on vault_grants are satisfied.
    /// Returns the agent_id.
    fn seed_agent(db: &TestDb, agent_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        // Provider (idempotent via INSERT OR IGNORE)
        db.conn()
            .execute(
                "INSERT OR IGNORE INTO providers (id, display_name, manifest_path, enabled, created_at)
                 VALUES ('test-provider', 'Test', '/tmp/p.yaml', 1, ?1)",
                params![now],
            )
            .unwrap();
        // Agent
        db.conn()
            .execute(
                "INSERT OR IGNORE INTO agents (id, provider_id, model_id, workspace_root,
                 temperature, max_subagent_depth, max_subagents_total, status, depth, spawned_total,
                 created_at, updated_at)
                 VALUES (?1, 'test-provider', 'test-model', '/tmp/ws',
                 0.7, 2, 8, 'idle', 0, 0, ?2, ?2)",
                params![agent_id, now],
            )
            .unwrap();
    }

    #[test]
    fn create_secret_ref_stores_metadata() {
        let test_db = TestDb::new();
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        let ref_row = service
            .create_secret_ref("my-api-key", "backend-key-1", Some("production"))
            .unwrap();
        assert_eq!(ref_row.key_name, "my-api-key");
        assert_eq!(ref_row.backend_key, "backend-key-1");
        assert_eq!(ref_row.policy_label.as_deref(), Some("production"));
    }

    #[test]
    fn store_and_retrieve_secret_material() {
        let test_db = TestDb::new();
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        service
            .create_secret_ref("my-key", "backend-1", None)
            .unwrap();
        service
            .store_secret("backend-1", "super-secret-value")
            .unwrap();
        let value = service.get_secret_material("backend-1").unwrap();
        assert_eq!(value, "super-secret-value");
    }

    #[test]
    fn resolve_denied_without_grant() {
        let test_db = TestDb::new();
        seed_agent(&test_db, "agent-1");
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        let secret_ref = service.create_secret_ref("my-key", "bk-1", None).unwrap();
        service.store_secret("bk-1", "secret").unwrap();

        let result = service.resolve("agent-1", &secret_ref.id);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            moxxy_types::VaultError::AccessDenied
        ));
    }

    #[test]
    fn resolve_succeeds_after_grant() {
        let test_db = TestDb::new();
        seed_agent(&test_db, "agent-1");
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        let secret_ref = service.create_secret_ref("my-key", "bk-1", None).unwrap();
        service.store_secret("bk-1", "the-secret").unwrap();
        service.grant_access("agent-1", &secret_ref.id).unwrap();

        let value = service.resolve("agent-1", &secret_ref.id).unwrap();
        assert_eq!(value, "the-secret");
    }

    #[test]
    fn revoked_grant_denies_access() {
        let test_db = TestDb::new();
        seed_agent(&test_db, "agent-1");
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        let secret_ref = service.create_secret_ref("my-key", "bk-1", None).unwrap();
        service.store_secret("bk-1", "secret").unwrap();
        let grant = service.grant_access("agent-1", &secret_ref.id).unwrap();
        service.revoke_grant(&grant.id).unwrap();

        let result = service.resolve("agent-1", &secret_ref.id);
        assert!(result.is_err());
    }

    #[test]
    fn duplicate_grant_is_idempotent() {
        let test_db = TestDb::new();
        seed_agent(&test_db, "agent-1");
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        let secret_ref = service.create_secret_ref("my-key", "bk-1", None).unwrap();
        let g1 = service.grant_access("agent-1", &secret_ref.id).unwrap();
        let g2 = service.grant_access("agent-1", &secret_ref.id).unwrap();
        // Should return same grant
        assert_eq!(g1.agent_id, g2.agent_id);
        assert_eq!(g1.secret_ref_id, g2.secret_ref_id);
    }

    #[test]
    fn list_refs_returns_all() {
        let test_db = TestDb::new();
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        service.create_secret_ref("key-1", "bk-1", None).unwrap();
        service.create_secret_ref("key-2", "bk-2", None).unwrap();

        let refs = service.list_refs().unwrap();
        assert_eq!(refs.len(), 2);
    }

    #[test]
    fn list_grants_filters_by_agent() {
        let test_db = TestDb::new();
        seed_agent(&test_db, "agent-1");
        seed_agent(&test_db, "agent-2");
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        let r1 = service.create_secret_ref("key-1", "bk-1", None).unwrap();
        let r2 = service.create_secret_ref("key-2", "bk-2", None).unwrap();
        service.grant_access("agent-1", &r1.id).unwrap();
        service.grant_access("agent-2", &r2.id).unwrap();

        let grants = service.list_grants_for_agent("agent-1").unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].agent_id, "agent-1");
    }

    #[test]
    fn delete_secret_removes_from_backend_and_db() {
        let test_db = TestDb::new();
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        let secret_ref = service.create_secret_ref("my-key", "bk-1", None).unwrap();
        service.store_secret("bk-1", "secret").unwrap();

        service.delete_secret(&secret_ref.id).unwrap();

        // Should not be findable
        let refs = service.list_refs().unwrap();
        assert!(refs.iter().all(|r| r.id != secret_ref.id));

        // Backend should also not have it
        assert!(service.get_secret_material("bk-1").is_err());
    }

    #[test]
    fn resolve_returns_error_for_nonexistent_ref() {
        let test_db = TestDb::new();
        let backend = InMemoryBackend::new();
        let service = VaultService::new(backend, test_db.conn());

        let result = service.resolve("agent-1", "nonexistent-ref-id");
        assert!(result.is_err());
    }
}
