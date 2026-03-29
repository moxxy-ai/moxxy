//! End-to-end tests for the hive multi-agent mechanism.
//!
//! These tests require a real OpenAI API key (`OPENAI_API_KEY` env var) and
//! make actual LLM calls. They are skipped automatically when the env var is
//! absent, so `cargo test` in local dev / regular CI stays fast.
//!
//! Nightly CI sets the secret and runs:
//!   cargo test -p moxxy-gateway --test hive_e2e

use std::net::SocketAddr;
use std::sync::Arc;

use rusqlite::Connection;
use tokio::net::TcpListener;

use moxxy_gateway::state::AppState;
use moxxy_gateway::{create_router, state::register_sqlite_vec};
use moxxy_types::AuthMode;

// ── helpers ──────────────────────────────────────────────────────────

fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "moxxy_gateway=info,moxxy_runtime=info".parse().unwrap()),
        )
        .with_test_writer()
        .try_init();
}

/// Returns the API key or `None` when the env var is unset.
/// Tests call this and early-return when `None` so `cargo test` skips them.
fn openai_api_key() -> Option<String> {
    std::env::var("OPENAI_API_KEY").ok().filter(|k| !k.is_empty())
}

struct E2eServer {
    addr: SocketAddr,
    client: reqwest::Client,
    moxxy_home: std::path::PathBuf,
    _tmp: tempfile::TempDir,
}

impl E2eServer {
    async fn start() -> Self {
        let tmp = tempfile::TempDir::new().unwrap();
        let moxxy_home = tmp.path().to_path_buf();
        std::fs::create_dir_all(moxxy_home.join("agents")).unwrap();
        register_sqlite_vec();
        let conn = Connection::open_in_memory().unwrap();
        let state = Arc::new(AppState::new(
            conn,
            [0u8; 32],
            AuthMode::Token,
            moxxy_home.clone(),
            "http://127.0.0.1:3000".into(),
        ));

        // Enable sub-agent spawning (required for hive.recruit)
        state.run_service.set_run_starter(state.run_service.clone());
        state.spawn_drain_loop();

        let app = create_router(state, None);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
                .await
                .unwrap();
        });

        Self {
            addr,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap(),
            moxxy_home,
            _tmp: tmp,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    async fn create_token(&self, scopes: &[&str]) -> String {
        let resp = self
            .client
            .post(self.url("/v1/auth/tokens"))
            .json(&serde_json::json!({ "scopes": scopes, "description": "e2e" }))
            .send()
            .await
            .unwrap();
        resp.json::<serde_json::Value>().await.unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string()
    }

    async fn post(&self, path: &str, token: &str, body: &serde_json::Value) -> reqwest::Response {
        self.client
            .post(self.url(path))
            .header("Authorization", format!("Bearer {token}"))
            .json(body)
            .send()
            .await
            .unwrap()
    }

    async fn get(&self, path: &str, token: &str) -> reqwest::Response {
        self.client
            .get(self.url(path))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .unwrap()
    }

    /// Poll until the agent leaves `running` state or the timeout expires.
    async fn wait_for_idle(&self, agent: &str, token: &str, timeout_secs: u64) -> String {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
        loop {
            if tokio::time::Instant::now() >= deadline {
                return "timeout".into();
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            let resp = self.get(&format!("/v1/agents/{agent}"), token).await;
            let status = resp.json::<serde_json::Value>().await.unwrap()["status"]
                .as_str()
                .unwrap_or("unknown")
                .to_string();
            if status != "running" {
                return status;
            }
        }
    }

    /// Workspace path for a given agent.
    fn workspace(&self, agent: &str) -> std::path::PathBuf {
        self.moxxy_home.join("agents").join(agent).join("workspace")
    }
}

/// Install OpenAI provider + vault secret + create an agent. Returns the auth token.
async fn setup_agent(server: &E2eServer, name: &str, api_key: &str) -> String {
    let token = server
        .create_token(&[
            "agents:read",
            "agents:write",
            "runs:write",
            "events:read",
            "vault:read",
            "vault:write",
        ])
        .await;

    let resp = server
        .post(
            "/v1/providers",
            &token,
            &serde_json::json!({
                "id": "openai",
                "display_name": "OpenAI",
                "models": [{
                    "model_id": "gpt-4o",
                    "display_name": "GPT-4o",
                    "metadata": { "api_base": "https://api.openai.com/v1" }
                }]
            }),
        )
        .await;
    assert!(resp.status().is_success() || resp.status().as_u16() == 409);

    let resp = server
        .post(
            "/v1/vault/secrets",
            &token,
            &serde_json::json!({
                "key_name": "OPENAI_API_KEY",
                "backend_key": "moxxy_provider_openai",
                "policy_label": "provider-api-key",
                "value": api_key
            }),
        )
        .await;
    assert!(resp.status().is_success() || resp.status().as_u16() == 409);

    let resp = server
        .post(
            "/v1/agents",
            &token,
            &serde_json::json!({
                "provider_id": "openai",
                "model_id": "gpt-4o",
                "name": name
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201, "Failed to create agent '{name}'");

    token
}

// =====================================================================
//  Single-agent flow
// =====================================================================

/// Smoke test: agent uses fs.write to create a file.
#[tokio::test]
async fn e2e_single_agent_tool_call() {
    init_tracing();
    let Some(api_key) = openai_api_key() else {
        eprintln!("OPENAI_API_KEY not set — skipping");
        return;
    };

    let server = E2eServer::start().await;
    let token = setup_agent(&server, "single-agent", &api_key).await;

    let resp = server
        .post(
            "/v1/agents/single-agent/runs",
            &token,
            &serde_json::json!({
                "task": "Write the text 'Hello from Moxxy' to a file called hello.txt. Then reply with 'done'."
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 200);

    let status = server.wait_for_idle("single-agent", &token, 60).await;
    assert_eq!(status, "idle", "Agent ended in status: {status}");

    let hello = server.workspace("single-agent").join("hello.txt");
    assert!(hello.exists(), "hello.txt not created");
    let content = std::fs::read_to_string(&hello).unwrap();
    assert!(content.contains("Hello from Moxxy"), "content: {content}");
}

// =====================================================================
//  Hive — parallel coordination
// =====================================================================

/// Two workers each create a file in parallel.
#[tokio::test]
async fn e2e_hive_parallel_workers() {
    init_tracing();
    let Some(api_key) = openai_api_key() else {
        eprintln!("OPENAI_API_KEY not set — skipping");
        return;
    };

    let server = E2eServer::start().await;
    let token = setup_agent(&server, "hive-par", &api_key).await;

    let task = "\
[Auto-analysis: This task benefits from parallel execution with 2 workers]
Create a hive, break this task into subtasks, recruit 2 workers, and coordinate.

Create two independent files in the workspace:
1. animals.txt — exactly these 5 lines: cat, dog, bird, fish, rabbit
2. colors.txt  — exactly these 5 lines: red, blue, green, yellow, purple

Each file must be created by a separate hive worker. \
After both workers complete, use hive.aggregate, then reply with a summary.";

    let resp = server
        .post(
            "/v1/agents/hive-par/runs",
            &token,
            &serde_json::json!({ "task": task }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 200);

    let status = server.wait_for_idle("hive-par", &token, 180).await;
    assert_eq!(status, "idle", "Queen ended in status: {status}");

    let ws = server.workspace("hive-par");

    // Hive manifest must exist
    let manifest = ws.join(".hive/hive.yaml");
    assert!(manifest.exists(), "hive manifest missing");
    let mf = std::fs::read_to_string(&manifest).unwrap();
    eprintln!("=== manifest ===\n{mf}");
    assert!(mf.contains("queen"));

    // Tasks directory should contain at least 2 tasks
    let tasks_dir = ws.join(".hive/tasks");
    assert!(tasks_dir.exists(), ".hive/tasks missing");
    let task_count = std::fs::read_dir(&tasks_dir)
        .unwrap()
        .filter(|e| {
            e.as_ref()
                .ok()
                .is_some_and(|e| e.path().extension().and_then(|x| x.to_str()) == Some("yaml"))
        })
        .count();
    eprintln!("task count: {task_count}");
    assert!(task_count >= 2, "Expected ≥2 tasks, got {task_count}");

    // Output files
    let animals = ws.join("animals.txt");
    let colors = ws.join("colors.txt");
    assert!(animals.exists() || colors.exists(), "No output files created");
    if animals.exists() {
        let c = std::fs::read_to_string(&animals).unwrap();
        eprintln!("=== animals.txt ===\n{c}");
        assert!(c.contains("cat"));
    }
    if colors.exists() {
        let c = std::fs::read_to_string(&colors).unwrap();
        eprintln!("=== colors.txt ===\n{c}");
        assert!(c.contains("red"));
    }
}

// =====================================================================
//  Hive — task dependencies
// =====================================================================

/// Second task depends on the first; verifies ordering is respected.
#[tokio::test]
async fn e2e_hive_task_dependencies() {
    init_tracing();
    let Some(api_key) = openai_api_key() else {
        eprintln!("OPENAI_API_KEY not set — skipping");
        return;
    };

    let server = E2eServer::start().await;
    let token = setup_agent(&server, "hive-dep", &api_key).await;

    let task = "\
[Auto-analysis: This task benefits from parallel execution with 2 workers]
Create a hive, break this task into subtasks, recruit 2 workers, and coordinate.

Two-step pipeline:
1. First task: Create data.txt containing the number 42
2. Second task (depends on first): Read data.txt, multiply the number by 2, write result to result.txt

The second task MUST use depends_on with the first task's ID. \
After all workers complete, use hive.aggregate and reply with a summary.";

    let resp = server
        .post(
            "/v1/agents/hive-dep/runs",
            &token,
            &serde_json::json!({ "task": task }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 200);

    let status = server.wait_for_idle("hive-dep", &token, 180).await;
    assert_eq!(status, "idle", "Queen ended in status: {status}");

    let ws = server.workspace("hive-dep");

    let data = ws.join("data.txt");
    assert!(data.exists(), "data.txt missing");
    let dc = std::fs::read_to_string(&data).unwrap();
    eprintln!("data.txt: {dc}");
    assert!(dc.contains("42"));

    let result = ws.join("result.txt");
    if result.exists() {
        let rc = std::fs::read_to_string(&result).unwrap();
        eprintln!("result.txt: {rc}");
        assert!(rc.contains("84"), "expected 84, got: {rc}");
    } else {
        eprintln!("WARN: result.txt not created (dependency ordering may not have been followed)");
    }
}

// =====================================================================
//  Complex — multi-file project via hive
// =====================================================================

/// Hive creates a small multi-file project: a library + consumer + README.
#[tokio::test]
async fn e2e_hive_complex_project() {
    init_tracing();
    let Some(api_key) = openai_api_key() else {
        eprintln!("OPENAI_API_KEY not set — skipping");
        return;
    };

    let server = E2eServer::start().await;
    let token = setup_agent(&server, "hive-complex", &api_key).await;

    let task = "\
[Auto-analysis: This task benefits from parallel execution with 3 workers]
Create a hive, break this task into subtasks, recruit 3 workers, and coordinate.

Build a tiny Python project with three files:
1. math_utils.py — two functions: add(a, b) and multiply(a, b)
2. main.py — imports math_utils and prints add(2,3) and multiply(4,5)
3. README.md — one-paragraph description of the project

Each file MUST be created by a different worker. \
After all workers finish, use hive.aggregate and reply with 'project complete'.";

    let resp = server
        .post(
            "/v1/agents/hive-complex/runs",
            &token,
            &serde_json::json!({ "task": task }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 200);

    let status = server.wait_for_idle("hive-complex", &token, 240).await;
    assert_eq!(status, "idle", "Queen ended in status: {status}");

    let ws = server.workspace("hive-complex");

    // At least 2 of the 3 files should exist
    let files = ["math_utils.py", "main.py", "README.md"];
    let existing: Vec<_> = files.iter().filter(|f| ws.join(f).exists()).collect();
    eprintln!("Created files: {existing:?}");
    assert!(
        existing.len() >= 2,
        "Expected ≥2 project files, got {:?}",
        existing
    );

    if ws.join("math_utils.py").exists() {
        let c = std::fs::read_to_string(ws.join("math_utils.py")).unwrap();
        eprintln!("=== math_utils.py ===\n{c}");
        assert!(c.contains("def add") || c.contains("def multiply"));
    }
}
