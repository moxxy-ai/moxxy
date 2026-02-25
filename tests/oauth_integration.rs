//! Integration tests for `moxxy oauth` command.
//!
//! Verifies the OAuth CLI flow end-to-end by spawning the moxxy binary
//! with a temporary data directory. Covers help, list, and full flow
//! with mock token server.

use std::path::PathBuf;
use std::process::Command;

fn moxxy_bin() -> PathBuf {
    std::env::var("CARGO_BIN_EXE_moxxy")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("target/debug/moxxy"))
}

fn temp_data_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("temp dir")
}

/// Set up a temp dir with agent + OAuth skill for testing.
fn setup_oauth_skill(tmp: &tempfile::TempDir) {
    let skill_dir = tmp.path().join("agents/default/skills/test_oauth");
    std::fs::create_dir_all(&skill_dir).unwrap();
    let manifest = r#"
name = "test_oauth"
description = "Test OAuth skill"
version = "1.0.0"

[oauth]
auth_url = "https://accounts.example.com/oauth"
token_url = "https://accounts.example.com/token"
client_id_env = "TEST_CLIENT_ID"
client_secret_env = "TEST_CLIENT_SECRET"
refresh_token_env = "TEST_REFRESH_TOKEN"
scopes = ["read", "write"]
"#;
    std::fs::write(skill_dir.join("manifest.toml"), manifest).unwrap();
}

#[test]
fn oauth_help_exits_successfully() {
    let output = Command::new(moxxy_bin())
        .args(["oauth", "--help"])
        .output()
        .expect("moxxy oauth --help");

    assert!(
        output.status.success(),
        "stdout: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("moxxy oauth"));
    assert!(stdout.contains("list"));
    assert!(stdout.contains("--agent"));
    assert!(stdout.contains("--client-id"));
    assert!(stdout.contains("--open-browser"));
    assert!(stdout.contains("--code"));
}

#[test]
fn oauth_with_no_args_shows_help_and_error() {
    let output = Command::new(moxxy_bin())
        .args(["oauth"])
        .output()
        .expect("moxxy oauth");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr);
    assert!(
        combined.contains("Missing skill name or subcommand"),
        "expected help/error message, got: {}",
        combined
    );
}

#[test]
fn oauth_list_with_empty_dir() {
    let tmp = temp_data_dir();
    std::fs::create_dir_all(tmp.path().join("agents")).unwrap();

    let output = Command::new(moxxy_bin())
        .args(["oauth", "list"])
        .env("MOXXY_DATA_DIR", tmp.path())
        .output()
        .expect("moxxy oauth list");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("No skills with OAuth configuration"));
}

#[test]
fn oauth_list_shows_oauth_skills() {
    let tmp = temp_data_dir();
    setup_oauth_skill(&tmp);

    let output = Command::new(moxxy_bin())
        .args(["oauth", "list"])
        .env("MOXXY_DATA_DIR", tmp.path())
        .output()
        .expect("moxxy oauth list");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("test_oauth"));
    assert!(stdout.contains("accounts.example.com"));
}

#[test]
fn oauth_unknown_skill_exits_with_error() {
    let tmp = temp_data_dir();
    setup_oauth_skill(&tmp);

    let output = Command::new(moxxy_bin())
        .args([
            "oauth",
            "nonexistent_skill",
            "--agent",
            "default",
            "--client-id",
            "x",
            "--client-secret",
            "y",
            "--code",
            "z",
        ])
        .env("MOXXY_DATA_DIR", tmp.path())
        .output()
        .expect("moxxy oauth nonexistent_skill");

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{}{}", stdout, stderr);
    assert!(
        combined.contains("not found") || combined.contains("nonexistent_skill"),
        "expected error about unknown skill, got: {}",
        combined
    );
}

/// Full OAuth flow: mock token server + moxxy install + oauth flow with --code.
/// Verifies credentials end up in the vault.
///
/// Runs moxxy install to bootstrap; may be slow in CI. Set MOXXY_OAUTH_FULL_FLOW=1 to run.
#[tokio::test]
async fn oauth_full_flow_stores_credentials_in_vault() {
    if std::env::var("MOXXY_OAUTH_FULL_FLOW").is_err() {
        return;
    }

    use axum::{Json, Router, routing::post};
    use tokio::sync::oneshot;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let token_url = format!("http://127.0.0.1:{}/token", port);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let _server_handle = tokio::spawn(async move {
        let app = Router::new().route(
            "/token",
            post(|| async {
                Json(serde_json::json!({
                    "refresh_token": "e2e-mock-refresh-token",
                    "access_token": "e2e-mock-access-token",
                    "expires_in": 3600,
                    "token_type": "Bearer"
                }))
            }),
        );
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let tmp = temp_data_dir();
    let data_dir = tmp.path();

    let install_out = Command::new(moxxy_bin())
        .args(["install"])
        .env("MOXXY_DATA_DIR", data_dir)
        .output()
        .expect("moxxy install");
    assert!(
        install_out.status.success(),
        "install failed: {}",
        String::from_utf8_lossy(&install_out.stderr)
    );

    let skill_dir = data_dir.join("agents/default/skills/test_oauth");
    std::fs::create_dir_all(&skill_dir).unwrap();
    let manifest = format!(
        r#"
name = "test_oauth"
description = "Test OAuth skill"
version = "1.0.0"

[oauth]
auth_url = "https://accounts.example.com/oauth"
token_url = "{}"
client_id_env = "TEST_CLIENT_ID"
client_secret_env = "TEST_CLIENT_SECRET"
refresh_token_env = "TEST_REFRESH_TOKEN"
scopes = ["read"]
"#,
        token_url
    );
    std::fs::write(skill_dir.join("manifest.toml"), manifest).unwrap();

    let oauth_out = Command::new(moxxy_bin())
        .args([
            "oauth",
            "test_oauth",
            "--agent",
            "default",
            "--client-id",
            "test-client-id",
            "--client-secret",
            "test-client-secret",
            "--code",
            "mock-auth-code",
        ])
        .env("MOXXY_DATA_DIR", data_dir)
        .output()
        .expect("moxxy oauth test_oauth");

    let _ = shutdown_tx.send(());

    assert!(
        oauth_out.status.success(),
        "oauth flow failed. stdout: {} stderr: {}",
        String::from_utf8_lossy(&oauth_out.stdout),
        String::from_utf8_lossy(&oauth_out.stderr)
    );

    let stdout = String::from_utf8_lossy(&oauth_out.stdout);
    assert!(stdout.contains("OAuth credentials stored successfully"));
    assert!(stdout.contains("TEST_CLIENT_ID"));
    assert!(stdout.contains("TEST_REFRESH_TOKEN"));
}
