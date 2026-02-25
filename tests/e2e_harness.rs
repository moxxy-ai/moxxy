#![allow(dead_code)]

use axum::{Json, Router, extract::State, routing::post};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;
use uuid::Uuid;

pub type TestResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub vault_key: String,
}

pub struct DaemonHarness {
    child: Child,
    pub api_port: u16,
    pub api_base: String,
    data_dir: LocalTempDir,
    artifact_dir: PathBuf,
    trace_log: Arc<Mutex<Vec<String>>>,
}

impl DaemonHarness {
    pub async fn spawn(custom_provider: Option<ProviderConfig>) -> TestResult<Self> {
        let api_port = find_free_port()?;
        let data_dir = LocalTempDir::new("moxxy-e2e-data")?;
        let artifact_dir = prepare_artifact_dir(data_dir.path())?;
        let daemon_log = artifact_dir.join(format!("daemon-{}.log", api_port));

        if let Some(provider) = custom_provider {
            write_custom_provider_registry(data_dir.path(), provider)?;
        }

        let bin = moxxy_binary_path()?;
        let log_file = std::fs::File::create(&daemon_log)?;
        let log_file_err = log_file.try_clone()?;

        let child = Command::new(bin)
            .arg("daemon-run")
            .arg("--api-host")
            .arg("127.0.0.1")
            .arg("--api-port")
            .arg(api_port.to_string())
            .env("MOXXY_DATA_DIR", data_dir.path())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err))
            .spawn()?;

        let mut harness = Self {
            child,
            api_port,
            api_base: format!("http://127.0.0.1:{}", api_port),
            data_dir,
            artifact_dir,
            trace_log: Arc::new(Mutex::new(Vec::new())),
        };

        harness.wait_until_ready().await?;
        Ok(harness)
    }

    pub fn artifact_dir(&self) -> &Path {
        &self.artifact_dir
    }

    pub fn data_dir(&self) -> &Path {
        self.data_dir.path()
    }

    async fn wait_until_ready(&mut self) -> TestResult<()> {
        for _ in 0..80 {
            if let Some(status) = self.child.try_wait()? {
                return Err(format!("moxxy daemon exited early with status: {}", status).into());
            }

            let res = reqwest::Client::new()
                .get(format!("{}/api/providers", self.api_base))
                .timeout(Duration::from_millis(700))
                .send()
                .await;

            if let Ok(resp) = res
                && (resp.status().is_success() || resp.status().as_u16() == 401)
            {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err("Timed out waiting for moxxy API readiness".into())
    }

    pub async fn set_vault_secret(&self, key: &str, value: &str) -> TestResult<()> {
        let body = json!({ "key": key, "value": value });
        let out = self
            .request_json(
                reqwest::Method::POST,
                "/api/agents/default/vault",
                Some(body),
            )
            .await?;
        ensure_success(&out, "set_vault_secret")
    }

    pub async fn set_llm(&self, provider: &str, model: &str) -> TestResult<()> {
        let body = json!({ "provider": provider, "model": model });
        let out = self
            .request_json(reqwest::Method::POST, "/api/agents/default/llm", Some(body))
            .await?;
        ensure_success(&out, "set_llm")
    }

    pub async fn chat(&self, prompt: &str) -> TestResult<Value> {
        let body = json!({ "prompt": prompt });
        self.request_json(
            reqwest::Method::POST,
            "/api/agents/default/chat",
            Some(body),
        )
        .await
    }

    pub async fn list_schedules(&self) -> TestResult<Vec<Value>> {
        let out = self
            .request_json(reqwest::Method::GET, "/api/agents/default/schedules", None)
            .await?;
        let schedules = out
            .get("schedules")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(schedules)
    }

    pub async fn get_schedule_by_name(&self, name: &str) -> TestResult<Option<Value>> {
        let schedules = self.list_schedules().await?;
        Ok(schedules
            .into_iter()
            .find(|s| s.get("name").and_then(Value::as_str) == Some(name)))
    }

    pub fn persist_trace_file(&self, name: &str) -> TestResult<PathBuf> {
        let path = self.artifact_dir.join(format!("{}.trace.log", name));
        let lines = self.trace_log.lock().unwrap_or_else(|e| e.into_inner());
        std::fs::write(&path, lines.join("\n\n---\n\n"))?;
        Ok(path)
    }

    pub async fn request_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> TestResult<Value> {
        let url = format!("{}{}", self.api_base, path);
        let client = reqwest::Client::new();
        let mut req = client
            .request(method.clone(), &url)
            .timeout(Duration::from_secs(30));
        if let Some(payload) = body.clone() {
            req = req.json(&payload);
        }

        let resp = req.send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        let parsed = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| {
            json!({
                "success": false,
                "raw": text,
                "error": format!("non-json response status={}", status)
            })
        });

        let mut traces = self.trace_log.lock().unwrap_or_else(|e| e.into_inner());
        traces.push(format!(
            "REQUEST {} {}\nBODY {}\nSTATUS {}\nRESPONSE {}",
            method,
            path,
            body.unwrap_or(Value::Null),
            status,
            parsed
        ));
        drop(traces);

        Ok(parsed)
    }
}

impl Drop for DaemonHarness {
    fn drop(&mut self) {
        let _ = self.persist_trace_file("daemon");
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Clone)]
struct MockServerState {
    traces: Arc<Mutex<Vec<String>>>,
}

pub struct MockLlmServer {
    pub port: u16,
    traces: Arc<Mutex<Vec<String>>>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    handle: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct MockChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct MockOpenAiRequest {
    messages: Vec<MockChatMessage>,
}

async fn mock_chat_completion(
    State(state): State<MockServerState>,
    Json(payload): Json<MockOpenAiRequest>,
) -> Json<Value> {
    let response_content = mock_llm_response(&payload.messages);
    let response = json!({
        "choices": [{
            "message": {
                "role": "assistant",
                "content": response_content
            }
        }]
    });

    let mut traces = state.traces.lock().unwrap_or_else(|e| e.into_inner());
    traces.push(format!(
        "REQUEST messages={}\nRESPONSE {}",
        serde_json::to_string(&payload.messages).unwrap_or_else(|_| "[]".to_string()),
        response
    ));
    drop(traces);

    Json(response)
}

impl MockLlmServer {
    pub async fn start() -> TestResult<Self> {
        let port = find_free_port()?;
        let traces = Arc::new(Mutex::new(Vec::new()));
        let state = MockServerState {
            traces: Arc::clone(&traces),
        };
        let app = Router::new()
            .route("/v1/chat/completions", post(mock_chat_completion))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        Ok(Self {
            port,
            traces,
            shutdown_tx: Some(shutdown_tx),
            handle: Some(handle),
        })
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/v1/chat/completions", self.port)
    }

    pub fn persist_trace_file(&self, dir: &Path, name: &str) -> TestResult<PathBuf> {
        let path = dir.join(format!("{}.mock.trace.log", name));
        let lines = self.traces.lock().unwrap_or_else(|e| e.into_inner());
        std::fs::write(&path, lines.join("\n\n---\n\n"))?;
        Ok(path)
    }

    pub async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.await;
        }
    }
}

pub fn find_free_port() -> TestResult<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

pub fn is_transient_error_text(text: &str) -> bool {
    let t = text.to_lowercase();
    t.contains("rate limit")
        || t.contains("429")
        || t.contains("timeout")
        || t.contains("temporar")
        || t.contains("connection")
        || t.contains("try again")
}

fn moxxy_binary_path() -> TestResult<PathBuf> {
    if let Ok(path) = std::env::var("CARGO_BIN_EXE_moxxy") {
        return Ok(PathBuf::from(path));
    }

    let candidate = PathBuf::from("target")
        .join("debug")
        .join(if cfg!(windows) { "moxxy.exe" } else { "moxxy" });
    if candidate.exists() {
        return Ok(candidate);
    }

    Err("Could not locate moxxy test binary path".into())
}

fn prepare_artifact_dir(data_dir: &Path) -> TestResult<PathBuf> {
    let path = std::env::var("MOXXY_E2E_ARTIFACTS")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data_dir.join("artifacts"));
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

fn write_custom_provider_registry(data_dir: &Path, provider: ProviderConfig) -> TestResult<()> {
    let body = json!({
        "providers": [{
            "id": provider.id,
            "name": provider.name,
            "api_format": "openai",
            "base_url": provider.base_url,
            "auth": {
                "type": "bearer",
                "vault_key": provider.vault_key
            },
            "default_model": provider.model,
            "models": [{
                "id": provider.model,
                "name": provider.model
            }],
            "extra_headers": {},
            "custom": true
        }]
    });

    let path = data_dir.join("custom_providers.json");
    std::fs::write(path, serde_json::to_string_pretty(&body)?)?;
    Ok(())
}

fn ensure_success(value: &Value, action: &str) -> TestResult<()> {
    if value.get("success").and_then(Value::as_bool) == Some(true) {
        return Ok(());
    }
    Err(format!("{} failed: {}", action, value).into())
}

fn mock_llm_response(messages: &[MockChatMessage]) -> String {
    let system_blob = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    if system_blob.contains("SKILL RESULT [scheduler] (success)") {
        return "Created schedule successfully.".to_string();
    }
    if system_blob.contains("SKILL RESULT [modify_schedule] (success)") {
        return "Modified schedule successfully.".to_string();
    }
    if system_blob.contains("SKILL RESULT [remove_schedule] (success)") {
        return "Removed schedule successfully.".to_string();
    }
    if system_blob.contains("SKILL RESULT [scheduler] (error)")
        || system_blob.contains("SKILL RESULT [modify_schedule] (error)")
        || system_blob.contains("SKILL RESULT [remove_schedule] (error)")
    {
        return "A schedule skill failed.".to_string();
    }

    let user = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or_default();
    let fields = parse_semicolon_fields(user);
    let action = fields
        .get("TEST_ACTION")
        .cloned()
        .unwrap_or_default()
        .to_lowercase();

    match action.as_str() {
        "create" => {
            let name = fields
                .get("NAME")
                .cloned()
                .unwrap_or_else(|| "e2e_default".to_string());
            let cron = fields
                .get("CRON")
                .cloned()
                .unwrap_or_else(|| "0 0 9 * * *".to_string());
            let prompt = fields
                .get("PROMPT")
                .cloned()
                .unwrap_or_else(|| "Generate report".to_string());
            format!(
                "<invoke name=\"scheduler\">{}</invoke>",
                json!([name, cron, prompt])
            )
        }
        "modify" => {
            let name = fields
                .get("NAME")
                .cloned()
                .unwrap_or_else(|| "e2e_default".to_string());
            let cron = fields
                .get("CRON")
                .cloned()
                .unwrap_or_else(|| "0 0 10 * * *".to_string());
            let prompt = fields
                .get("PROMPT")
                .cloned()
                .unwrap_or_else(|| "Generate revised report".to_string());
            format!(
                "<invoke name=\"modify_schedule\">{}</invoke>",
                json!([name, cron, prompt])
            )
        }
        "remove" => {
            let name = fields
                .get("NAME")
                .cloned()
                .unwrap_or_else(|| "e2e_default".to_string());
            format!(
                "<invoke name=\"remove_schedule\">{}</invoke>",
                json!([name])
            )
        }
        _ => "No recognized test action.".to_string(),
    }
}

fn parse_semicolon_fields(input: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for token in input.split(';') {
        if let Some((key, value)) = token.trim().split_once('=') {
            out.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    out
}

struct LocalTempDir {
    path: PathBuf,
}

impl LocalTempDir {
    fn new(prefix: &str) -> TestResult<Self> {
        let path = std::env::temp_dir().join(format!("{}-{}", prefix, Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for LocalTempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
