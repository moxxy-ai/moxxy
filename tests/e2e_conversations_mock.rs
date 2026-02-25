mod e2e_harness;

use e2e_harness::{DaemonHarness, MockLlmServer, ProviderConfig, TestResult};
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deterministic_conversation_creates_modifies_and_removes_schedule() -> TestResult<()> {
    let mock_server = match MockLlmServer::start().await {
        Ok(server) => server,
        Err(err) if err.to_string().contains("Operation not permitted") => {
            eprintln!("Skipping deterministic E2E test: socket bind not permitted");
            return Ok(());
        }
        Err(err) => return Err(err),
    };
    let provider_id = "mockopenai";
    let provider_model = "mock-model-v1";
    let provider_vault_key = "mock_api_key";

    let daemon = match DaemonHarness::spawn(Some(ProviderConfig {
        id: provider_id.to_string(),
        name: "Mock OpenAI".to_string(),
        base_url: mock_server.base_url(),
        model: provider_model.to_string(),
        vault_key: provider_vault_key.to_string(),
    }))
    .await
    {
        Ok(daemon) => daemon,
        Err(err) if err.to_string().contains("Operation not permitted") => {
            eprintln!("Skipping deterministic E2E test: daemon socket bind not permitted");
            mock_server.shutdown().await;
            return Ok(());
        }
        Err(err) => return Err(err),
    };

    daemon.set_vault_secret(provider_vault_key, "dummy").await?;
    daemon.set_llm(provider_id, provider_model).await?;

    let schedule_name = format!("e2e_mock_{}", Uuid::new_v4().simple());
    let cron_initial = "0 15 8 * * *";
    let prompt_initial = "Initial mock automation prompt";

    let create_prompt = format!(
        "TEST_ACTION=create;NAME={};CRON={};PROMPT={}",
        schedule_name, cron_initial, prompt_initial
    );
    let create_out = daemon.chat(&create_prompt).await?;
    assert_eq!(
        create_out
            .get("success")
            .and_then(serde_json::Value::as_bool),
        Some(true),
        "create chat failed: {}",
        create_out
    );

    let created = daemon.get_schedule_by_name(&schedule_name).await?;
    let created = created.expect("schedule should exist after create conversation");
    assert_eq!(
        created.get("cron").and_then(serde_json::Value::as_str),
        Some(cron_initial)
    );
    assert_eq!(
        created.get("prompt").and_then(serde_json::Value::as_str),
        Some(prompt_initial)
    );

    let cron_updated = "0 45 9 * * *";
    let prompt_updated = "Updated mock automation prompt";
    let modify_prompt = format!(
        "TEST_ACTION=modify;NAME={};CRON={};PROMPT={}",
        schedule_name, cron_updated, prompt_updated
    );
    let modify_out = daemon.chat(&modify_prompt).await?;
    assert_eq!(
        modify_out
            .get("success")
            .and_then(serde_json::Value::as_bool),
        Some(true),
        "modify chat failed: {}",
        modify_out
    );

    let modified = daemon.get_schedule_by_name(&schedule_name).await?;
    let modified = modified.expect("schedule should exist after modify conversation");
    assert_eq!(
        modified.get("cron").and_then(serde_json::Value::as_str),
        Some(cron_updated)
    );
    assert_eq!(
        modified.get("prompt").and_then(serde_json::Value::as_str),
        Some(prompt_updated)
    );

    let remove_prompt = format!("TEST_ACTION=remove;NAME={}", schedule_name);
    let remove_out = daemon.chat(&remove_prompt).await?;
    assert_eq!(
        remove_out
            .get("success")
            .and_then(serde_json::Value::as_bool),
        Some(true),
        "remove chat failed: {}",
        remove_out
    );

    let removed = daemon.get_schedule_by_name(&schedule_name).await?;
    assert!(removed.is_none(), "schedule should be absent after remove");

    let _ = daemon.persist_trace_file("mock-conversations");
    let _ = mock_server.persist_trace_file(daemon.artifact_dir(), "mock-llm");
    mock_server.shutdown().await;

    Ok(())
}
