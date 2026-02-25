mod e2e_harness;

use e2e_harness::{DaemonHarness, TestResult, is_transient_error_text};
use uuid::Uuid;

async fn run_chat_with_retry(
    daemon: &DaemonHarness,
    prompt: &str,
) -> TestResult<serde_json::Value> {
    let mut last_err = String::new();
    for attempt in 1..=2 {
        let response =
            tokio::time::timeout(std::time::Duration::from_secs(90), daemon.chat(prompt))
                .await
                .map_err(|_| "chat request timed out".to_string())?;

        match response {
            Ok(payload) => {
                if payload.get("success").and_then(serde_json::Value::as_bool) == Some(true) {
                    return Ok(payload);
                }
                let err_text = payload
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown chat failure")
                    .to_string();
                last_err = err_text.clone();
                if attempt < 2 && is_transient_error_text(&err_text) {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }
                return Err(format!("chat failed: {}", payload).into());
            }
            Err(err) => {
                last_err = err.to_string();
                if attempt < 2 && is_transient_error_text(&last_err) {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }
            }
        }
    }
    Err(format!("chat failed after retry: {}", last_err).into())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore]
async fn live_openai_conversation_schedule_lifecycle() -> TestResult<()> {
    if std::env::var("MOXXY_RUN_LIVE_E2E").unwrap_or_default() != "1" {
        eprintln!("MOXXY_RUN_LIVE_E2E!=1, skipping live e2e test");
        return Ok(());
    }

    let api_key = std::env::var("MOXXY_E2E_OPENAI_API_KEY")
        .map_err(|_| "MOXXY_E2E_OPENAI_API_KEY must be set for live tests")?;
    let model =
        std::env::var("MOXXY_E2E_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());

    tokio::time::timeout(std::time::Duration::from_secs(360), async move {
        let daemon = match DaemonHarness::spawn(None).await {
            Ok(daemon) => daemon,
            Err(err) if err.to_string().contains("Operation not permitted") => {
                eprintln!("Skipping live E2E test: daemon socket bind not permitted");
                return Ok(());
            }
            Err(err) => return Err(err),
        };
        daemon.set_vault_secret("openai_api_key", &api_key).await?;
        daemon.set_llm("openai", &model).await?;

        let schedule_name = format!("e2e_live_{}", Uuid::new_v4().simple());
        let cron_initial = "0 5 8 * * *";
        let prompt_initial = "Live test: produce a concise morning digest.";
        let create_prompt = format!(
            "Create a recurring automation schedule named '{name}'. \
             Use cron '{cron}'. Set prompt exactly to: \"{prompt}\". \
             Do it now and then report completion.",
            name = schedule_name,
            cron = cron_initial,
            prompt = prompt_initial
        );
        let _ = run_chat_with_retry(&daemon, &create_prompt).await?;

        let created = daemon.get_schedule_by_name(&schedule_name).await?;
        let created = created.expect("schedule should exist after live create conversation");
        assert_eq!(
            created.get("cron").and_then(serde_json::Value::as_str),
            Some(cron_initial)
        );
        assert_eq!(
            created.get("prompt").and_then(serde_json::Value::as_str),
            Some(prompt_initial)
        );

        let cron_updated = "0 20 9 * * *";
        let prompt_updated = "Live test: produce an updated morning digest.";
        let modify_prompt = format!(
            "Modify existing schedule '{name}'. \
             Change cron to '{cron}'. Change prompt exactly to: \"{prompt}\". \
             Apply update immediately and confirm done.",
            name = schedule_name,
            cron = cron_updated,
            prompt = prompt_updated
        );
        let _ = run_chat_with_retry(&daemon, &modify_prompt).await?;

        let modified = daemon.get_schedule_by_name(&schedule_name).await?;
        let modified = modified.expect("schedule should still exist after live modify");
        assert_eq!(
            modified.get("cron").and_then(serde_json::Value::as_str),
            Some(cron_updated)
        );
        assert_eq!(
            modified.get("prompt").and_then(serde_json::Value::as_str),
            Some(prompt_updated)
        );

        let remove_prompt = format!(
            "Remove the schedule named '{name}'. \
             Delete only that schedule and confirm completion.",
            name = schedule_name
        );
        let _ = run_chat_with_retry(&daemon, &remove_prompt).await?;

        let removed = daemon.get_schedule_by_name(&schedule_name).await?;
        assert!(
            removed.is_none(),
            "schedule should be absent after live remove"
        );

        let _ = daemon.persist_trace_file("live-conversations");
        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    })
    .await
    .map_err(|_| "live e2e global timeout exceeded".to_string())??;

    Ok(())
}
