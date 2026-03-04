use std::net::SocketAddr;
use std::sync::Arc;

use rusqlite::Connection;
use tokio::net::TcpListener;

use moxxy_gateway::rate_limit::RateLimitConfig;
use moxxy_gateway::state::AppState;
use moxxy_gateway::{create_router, state::register_sqlite_vec};
use moxxy_types::AuthMode;

struct TestServer {
    addr: SocketAddr,
    client: reqwest::Client,
    _tmp: tempfile::TempDir,
}

impl TestServer {
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
            moxxy_home,
            "http://127.0.0.1:3000".into(),
        ));
        let app = create_router(state, None);

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap();

        Self {
            addr,
            client,
            _tmp: tmp,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    /// Create a bootstrap token via the API (first token needs no auth).
    async fn create_token(&self, scopes: &[&str], ttl: Option<u32>) -> (String, String) {
        let mut body = serde_json::json!({
            "scopes": scopes,
            "description": "test token"
        });
        if let Some(ttl) = ttl {
            body["ttl_seconds"] = serde_json::json!(ttl);
        }

        let resp = self
            .client
            .post(self.url("/v1/auth/tokens"))
            .json(&body)
            .send()
            .await
            .unwrap();

        let json: serde_json::Value = resp.json().await.unwrap();
        let token = json["token"].as_str().unwrap().to_string();
        let id = json["id"].as_str().unwrap().to_string();
        (token, id)
    }

    /// Authenticated GET request.
    async fn get(&self, path: &str, token: &str) -> reqwest::Response {
        self.client
            .get(self.url(path))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap()
    }

    /// Authenticated POST with JSON body.
    async fn post(&self, path: &str, token: &str, body: &serde_json::Value) -> reqwest::Response {
        self.client
            .post(self.url(path))
            .header("Authorization", format!("Bearer {}", token))
            .json(body)
            .send()
            .await
            .unwrap()
    }
}

// ---------------------------------------------------------------------------
// Test 1: Full agent lifecycle
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_full_agent_lifecycle() {
    let server = TestServer::start().await;

    let (token, _) = server
        .create_token(
            &[
                "agents:read",
                "agents:write",
                "runs:write",
                "events:read",
                "vault:write",
            ],
            None,
        )
        .await;

    // Install a provider with a model that has api_base metadata
    let resp = server
        .post(
            "/v1/providers",
            &token,
            &serde_json::json!({
                "id": "echo",
                "display_name": "Echo Provider",
                "models": [
                    {
                        "model_id": "echo-1",
                        "display_name": "Echo 1",
                        "metadata": { "api_base": "https://api.openai.com/v1" }
                    }
                ]
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);

    // Store a dummy API key in the vault so provider resolution succeeds
    let resp = server
        .post(
            "/v1/vault/secrets",
            &token,
            &serde_json::json!({
                "key_name": "ECHO_API_KEY",
                "backend_key": "moxxy_provider_echo",
                "policy_label": "provider-api-key",
                "value": "sk-echo-test-key"
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);

    // Create an agent
    let resp = server
        .post(
            "/v1/agents",
            &token,
            &serde_json::json!({
                "provider_id": "echo",
                "model_id": "echo-1",
                "name": "lifecycle-agent"
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);
    let agent: serde_json::Value = resp.json().await.unwrap();
    let agent_id = agent["name"].as_str().unwrap();

    // Verify agent is idle
    let resp = server
        .get(&format!("/v1/agents/{}", agent_id), &token)
        .await;
    assert_eq!(resp.status().as_u16(), 200);
    let agent: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(agent["status"].as_str().unwrap(), "idle");

    // Start a run
    let resp = server
        .post(
            &format!("/v1/agents/{}/runs", agent_id),
            &token,
            &serde_json::json!({ "task": "Say hello" }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 200);

    // Give the async run time to complete
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    // Verify agent returns to idle (or some terminal state)
    let resp = server
        .get(&format!("/v1/agents/{}", agent_id), &token)
        .await;
    let agent: serde_json::Value = resp.json().await.unwrap();
    let status = agent["status"].as_str().unwrap();
    assert!(
        status == "idle" || status == "error",
        "Expected idle or error, got {}",
        status
    );
}

// ---------------------------------------------------------------------------
// Test: Agent update changes provider and model
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_agent_update_changes_provider_and_model() {
    let server = TestServer::start().await;

    let (token, _) = server
        .create_token(&["agents:read", "agents:write"], None)
        .await;

    // Install two providers
    server
        .post(
            "/v1/providers",
            &token,
            &serde_json::json!({
                "id": "echo",
                "display_name": "Echo Provider",
                "models": [{"model_id": "echo-1", "display_name": "Echo 1"}]
            }),
        )
        .await;

    server
        .post(
            "/v1/providers",
            &token,
            &serde_json::json!({
                "id": "openai",
                "display_name": "OpenAI",
                "models": [{"model_id": "gpt-4o", "display_name": "GPT-4o", "metadata": {"api_base": "https://api.openai.com/v1"}}]
            }),
        )
        .await;

    // Create agent with echo provider
    let resp = server
        .post(
            "/v1/agents",
            &token,
            &serde_json::json!({
                "provider_id": "echo",
                "model_id": "echo-1",
                "name": "update-agent"
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);
    let agent: serde_json::Value = resp.json().await.unwrap();
    let agent_id = agent["name"].as_str().unwrap();

    // Update agent to use openai provider
    let resp = server
        .client
        .patch(server.url(&format!("/v1/agents/{}", agent_id)))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "provider_id": "openai",
            "model_id": "gpt-4o",
            "temperature": 0.9
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 200);
    let updated: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(updated["provider_id"], "openai");
    assert_eq!(updated["model_id"], "gpt-4o");
    assert_eq!(updated["temperature"], 0.9);

    // Verify via GET
    let resp = server
        .get(&format!("/v1/agents/{}", agent_id), &token)
        .await;
    let agent: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(agent["provider_id"], "openai");
    assert_eq!(agent["model_id"], "gpt-4o");
}

// ---------------------------------------------------------------------------
// Test: Dynamic provider resolution E2E (provider install + vault + agent run)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_dynamic_provider_resolution_with_vault() {
    let server = TestServer::start().await;

    let (token, _) = server
        .create_token(
            &[
                "agents:read",
                "agents:write",
                "runs:write",
                "vault:read",
                "vault:write",
            ],
            None,
        )
        .await;

    // Install provider with api_base in model metadata
    let resp = server
        .post(
            "/v1/providers",
            &token,
            &serde_json::json!({
                "id": "test-llm",
                "display_name": "Test LLM",
                "models": [{
                    "model_id": "test-model-1",
                    "display_name": "Test Model",
                    "metadata": {"api_base": "https://api.openai.com/v1"}
                }]
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);

    // Store API key in vault
    let resp = server
        .post(
            "/v1/vault/secrets",
            &token,
            &serde_json::json!({
                "key_name": "TEST_LLM_API_KEY",
                "backend_key": "moxxy_provider_test-llm",
                "policy_label": "provider-api-key",
                "value": "sk-test-fake-key-12345"
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);

    // Create agent using the provider
    let resp = server
        .post(
            "/v1/agents",
            &token,
            &serde_json::json!({
                "provider_id": "test-llm",
                "model_id": "test-model-1",
                "name": "dynamic-agent"
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);
    let agent: serde_json::Value = resp.json().await.unwrap();
    let agent_id = agent["name"].as_str().unwrap();

    // Start a run = the dynamic resolver should find the provider via DB + vault
    // (it will fail the HTTP call since the key is fake, but it won't use EchoProvider)
    let resp = server
        .post(
            &format!("/v1/agents/{}/runs", agent_id),
            &token,
            &serde_json::json!({ "task": "Say hello" }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 200);
    let run: serde_json::Value = resp.json().await.unwrap();
    assert!(run["run_id"].as_str().is_some());

    // Wait for run to complete (will error because fake key)
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    let resp = server
        .get(&format!("/v1/agents/{}", agent_id), &token)
        .await;
    let agent: serde_json::Value = resp.json().await.unwrap();
    let status = agent["status"].as_str().unwrap();
    // Agent should be in error state since the fake API key won't work
    assert!(
        status == "idle" || status == "error",
        "Expected idle or error, got {}",
        status
    );
}

// ---------------------------------------------------------------------------
// Test 2: Auth rejects invalid token
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_auth_rejects_invalid_token() {
    let server = TestServer::start().await;
    let resp = server.get("/v1/agents", "garbage-token-12345").await;
    assert_eq!(resp.status().as_u16(), 401);
}

// ---------------------------------------------------------------------------
// Test 3: Auth rejects wrong scope
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_auth_rejects_wrong_scope() {
    let server = TestServer::start().await;

    // Create token with only agents:read scope
    let (token, _) = server.create_token(&["agents:read"], None).await;

    // Try to create an agent (requires agents:write) = expect 403
    let resp = server
        .post(
            "/v1/agents",
            &token,
            &serde_json::json!({
                "provider_id": "echo",
                "model_id": "echo-1",
                "name": "scope-agent"
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 403);
}

// ---------------------------------------------------------------------------
// Test 4: Health check always works (no auth required)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_health_check_returns_200() {
    let server = TestServer::start().await;
    let resp = server
        .client
        .get(server.url("/v1/health"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 200);
}

// ---------------------------------------------------------------------------
// Test 5: Vault secret + grant flow
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_vault_secret_flow() {
    let server = TestServer::start().await;
    let (token, _) = server
        .create_token(
            &["vault:read", "vault:write", "agents:read", "agents:write"],
            None,
        )
        .await;

    // Create a secret reference
    let resp = server
        .post(
            "/v1/vault/secrets",
            &token,
            &serde_json::json!({
                "key_name": "test-api-key",
                "backend_key": "keyring://moxxy/test-api-key",
                "policy_label": "default"
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);
    let secret_ref: serde_json::Value = resp.json().await.unwrap();
    let secret_ref_id = secret_ref["id"].as_str().unwrap();

    // Install provider and create agent for grant
    server
        .post(
            "/v1/providers",
            &token,
            &serde_json::json!({
                "id": "echo",
                "display_name": "Echo"
            }),
        )
        .await;
    let resp = server
        .post(
            "/v1/agents",
            &token,
            &serde_json::json!({
                "provider_id": "echo",
                "model_id": "echo-1",
                "name": "vault-agent"
            }),
        )
        .await;
    let agent: serde_json::Value = resp.json().await.unwrap();
    let agent_id = agent["name"].as_str().unwrap();

    // Create grant
    let resp = server
        .post(
            "/v1/vault/grants",
            &token,
            &serde_json::json!({
                "agent_id": agent_id,
                "secret_ref_id": secret_ref_id
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);

    // List grants
    let resp = server.get("/v1/vault/grants", &token).await;
    assert_eq!(resp.status().as_u16(), 200);
    let grants: serde_json::Value = resp.json().await.unwrap();
    let grants_arr = grants.as_array().unwrap();
    assert!(!grants_arr.is_empty());
}

// ---------------------------------------------------------------------------
// Test 6: Skill lifecycle
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_skill_lifecycle() {
    let server = TestServer::start().await;
    let (token, _) = server
        .create_token(&["agents:read", "agents:write"], None)
        .await;

    // Create provider + agent
    server
        .post(
            "/v1/providers",
            &token,
            &serde_json::json!({
                "id": "echo",
                "display_name": "Echo"
            }),
        )
        .await;
    let resp = server
        .post(
            "/v1/agents",
            &token,
            &serde_json::json!({
                "provider_id": "echo",
                "model_id": "echo-1",
                "name": "skill-agent"
            }),
        )
        .await;
    let agent: serde_json::Value = resp.json().await.unwrap();
    let agent_id = agent["name"].as_str().unwrap();

    // Install skill (quarantined by default)
    let resp = server
        .post(
            &format!("/v1/agents/{}/skills/install", agent_id),
            &token,
            &serde_json::json!({
                "name": "test-skill",
                "version": "1.0.0",
                "source": "https://example.com/skill",
                "content": "# Test Skill\nDoes things."
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);
    let skill: serde_json::Value = resp.json().await.unwrap();
    let skill_id = skill["id"].as_str().unwrap();
    assert_eq!(skill["status"].as_str().unwrap(), "quarantined");

    // Approve skill
    let resp = server
        .post(
            &format!("/v1/agents/{}/skills/approve/{}", agent_id, skill_id),
            &token,
            &serde_json::json!({}),
        )
        .await;
    assert!(resp.status().is_success());

    // List skills - verify approved
    let resp = server
        .get(&format!("/v1/agents/{}/skills", agent_id), &token)
        .await;
    assert_eq!(resp.status().as_u16(), 200);
    let skills: serde_json::Value = resp.json().await.unwrap();
    let skills_arr = skills.as_array().unwrap();
    assert!(
        skills_arr
            .iter()
            .any(|s| s["status"].as_str() == Some("approved"))
    );
}

// ---------------------------------------------------------------------------
// Test 7: Rate limit returns 429
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_rate_limit_returns_429() {
    register_sqlite_vec();
    let conn = Connection::open_in_memory().unwrap();
    let state = Arc::new(AppState::new(
        conn,
        [0u8; 32],
        AuthMode::Token,
        std::path::PathBuf::from("/tmp/moxxy-test"),
        "http://127.0.0.1:3000".into(),
    ));

    let config = RateLimitConfig {
        per_second: 1,
        burst_size: 2,
        token_per_second: 1,
        token_burst_size: 2,
    };
    let app = create_router(state, Some(config));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });

    let client = reqwest::Client::new();
    let url = format!("http://{}/v1/agents", addr);

    // Send many requests rapidly
    let mut got_429 = false;
    for _ in 0..20 {
        let resp = client
            .get(&url)
            .header("Authorization", "Bearer test-token")
            .send()
            .await
            .unwrap();
        if resp.status().as_u16() == 429 {
            got_429 = true;
            assert!(resp.headers().contains_key("retry-after"));
            break;
        }
    }
    assert!(got_429, "Expected at least one 429 response");
}

// ---------------------------------------------------------------------------
// Test 8: Token listing works
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_token_list_returns_created_tokens() {
    let server = TestServer::start().await;
    let (token, id) = server.create_token(&["tokens:admin"], None).await;

    let resp = server.get("/v1/auth/tokens", &token).await;
    assert_eq!(resp.status().as_u16(), 200);
    let tokens: serde_json::Value = resp.json().await.unwrap();
    let arr = tokens.as_array().unwrap();
    assert!(arr.iter().any(|t| t["id"].as_str() == Some(&id)));
}

// ---------------------------------------------------------------------------
// Test 9: Loopback mode bypasses auth for localhost
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_loopback_mode_bypasses_auth_for_localhost() {
    register_sqlite_vec();
    let conn = Connection::open_in_memory().unwrap();
    let state = Arc::new(AppState::new(
        conn,
        [0u8; 32],
        AuthMode::Loopback,
        std::path::PathBuf::from("/tmp/moxxy-test"),
        "http://127.0.0.1:3000".into(),
    ));
    let app = create_router(state, None);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });

    let client = reqwest::Client::new();

    // Request without any auth header = should succeed because loopback mode
    let resp = client
        .get(format!("http://{}/v1/agents", addr))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status().as_u16(),
        200,
        "Loopback mode should bypass auth for localhost"
    );
}

// ---------------------------------------------------------------------------
// Test 10: Loopback mode disabled still requires auth
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_loopback_disabled_still_requires_auth() {
    register_sqlite_vec();
    let conn = Connection::open_in_memory().unwrap();
    let state = Arc::new(AppState::new(
        conn,
        [0u8; 32],
        AuthMode::Token,
        std::path::PathBuf::from("/tmp/moxxy-test"),
        "http://127.0.0.1:3000".into(),
    ));
    let app = create_router(state, None);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });

    let client = reqwest::Client::new();

    // Request without auth header = should be rejected
    let resp = client
        .get(format!("http://{}/v1/agents", addr))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status().as_u16(),
        401,
        "Without loopback mode, unauthenticated requests should be rejected"
    );
}

// ---------------------------------------------------------------------------
// Test 11: Ask-response endpoint resolves pending question
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e2e_ask_response_resolves_pending_question() {
    let server = TestServer::start().await;

    let (token, _) = server
        .create_token(&["agents:read", "agents:write", "runs:write"], None)
        .await;

    // Create provider + agent
    server
        .post(
            "/v1/providers",
            &token,
            &serde_json::json!({
                "id": "echo",
                "display_name": "Echo"
            }),
        )
        .await;

    let resp = server
        .post(
            "/v1/agents",
            &token,
            &serde_json::json!({
                "provider_id": "echo",
                "model_id": "echo-1",
                "name": "ask-agent"
            }),
        )
        .await;
    assert_eq!(resp.status().as_u16(), 201);
    let agent: serde_json::Value = resp.json().await.unwrap();
    let agent_id = agent["name"].as_str().unwrap().to_string();

    // Attempt to answer a non-existent question = should 404
    let resp = server
        .post(
            &format!("/v1/agents/{}/ask-responses/nonexistent-q", agent_id),
            &token,
            &serde_json::json!({"answer": "hello"}),
        )
        .await;
    assert_eq!(
        resp.status().as_u16(),
        404,
        "Answering unknown question_id should return 404"
    );
}

// Sub-agent spawn tests removed — subagent creation is now internal via
// RunStarter::spawn_child (called by agent.spawn / hive.recruit primitives),
// not via a REST endpoint.
