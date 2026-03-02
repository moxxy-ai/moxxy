use crate::rows::*;

pub fn fixture_stored_token() -> StoredTokenRow {
    StoredTokenRow {
        id: uuid::Uuid::now_v7().to_string(),
        created_by: "test-user".into(),
        token_hash: format!("hash-{}", uuid::Uuid::now_v7()),
        scopes_json: r#"["agents:read"]"#.into(),
        created_at: chrono::Utc::now().to_rfc3339(),
        expires_at: None,
        status: "active".into(),
    }
}

pub fn fixture_provider_row() -> ProviderRow {
    ProviderRow {
        id: "test-provider".into(),
        display_name: "Test Provider".into(),
        manifest_path: "/tmp/provider.yaml".into(),
        signature: None,
        enabled: true,
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}

pub fn fixture_agent_row() -> AgentRow {
    AgentRow {
        id: uuid::Uuid::now_v7().to_string(),
        parent_agent_id: None,
        provider_id: "test-provider".into(),
        model_id: "test-model".into(),
        workspace_root: "/tmp/workspace".into(),
        core_mount: None,
        policy_profile: None,
        temperature: 0.7,
        max_subagent_depth: 2,
        max_subagents_total: 8,
        status: "idle".into(),
        depth: 0,
        spawned_total: 0,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    }
}

pub fn fixture_heartbeat_row() -> HeartbeatRow {
    HeartbeatRow {
        id: uuid::Uuid::now_v7().to_string(),
        agent_id: "placeholder-agent".into(),
        interval_minutes: 5,
        action_type: "notify_cli".into(),
        action_payload: None,
        enabled: true,
        next_run_at: chrono::Utc::now().to_rfc3339(),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    }
}

pub fn fixture_skill_row() -> SkillRow {
    SkillRow {
        id: uuid::Uuid::now_v7().to_string(),
        agent_id: "placeholder-agent".into(),
        name: "test-skill".into(),
        version: "1.0.0".into(),
        source: Some("https://example.com/skill".into()),
        status: "quarantined".into(),
        raw_content: Some("# Test Skill\nDoes things.".into()),
        metadata_json: None,
        installed_at: chrono::Utc::now().to_rfc3339(),
        approved_at: None,
    }
}

pub fn fixture_memory_index_row() -> MemoryIndexRow {
    MemoryIndexRow {
        id: uuid::Uuid::now_v7().to_string(),
        agent_id: "placeholder-agent".into(),
        markdown_path: "/tmp/memory/note.md".into(),
        tags_json: Some(r#"["test","note"]"#.into()),
        chunk_hash: Some("abc123".into()),
        embedding_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    }
}

pub fn fixture_vault_secret_ref_row() -> VaultSecretRefRow {
    VaultSecretRefRow {
        id: uuid::Uuid::now_v7().to_string(),
        key_name: format!("secret-key-{}", uuid::Uuid::now_v7()),
        backend_key: "keyring://moxxy/test-secret".into(),
        policy_label: Some("default".into()),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    }
}

pub fn fixture_vault_grant_row() -> VaultGrantRow {
    VaultGrantRow {
        id: uuid::Uuid::now_v7().to_string(),
        agent_id: "placeholder-agent".into(),
        secret_ref_id: "placeholder-secret".into(),
        created_at: chrono::Utc::now().to_rfc3339(),
        revoked_at: None,
    }
}

pub fn fixture_event_audit_row() -> EventAuditRow {
    EventAuditRow {
        event_id: uuid::Uuid::now_v7().to_string(),
        ts: chrono::Utc::now().timestamp(),
        agent_id: Some("test-agent".into()),
        run_id: Some("test-run".into()),
        parent_run_id: None,
        sequence: 0,
        event_type: "run.started".into(),
        payload_json: Some(r#"{}"#.into()),
        redactions_json: None,
        sensitive: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}
