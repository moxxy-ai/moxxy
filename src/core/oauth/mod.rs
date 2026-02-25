use anyhow::{Result, anyhow};
use rand::Rng;
use rand::distributions::Alphanumeric;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;

use crate::skills::{OAuthConfig, SkillManifest};

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct TokenResponse {
    refresh_token: Option<String>,
    access_token: Option<String>,
    expires_in: Option<i64>,
    token_type: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct OAuthSkill {
    pub skill_name: String,
    pub manifest_path: PathBuf,
    pub config: OAuthConfig,
}

pub fn generate_state() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

pub fn build_auth_url(config: &OAuthConfig, client_id: &str, state: &str) -> String {
    let scopes = config.scopes.join(&config.scope_separator);
    let encoded_scopes = urlencoding::encode(&scopes);
    let encoded_client_id = urlencoding::encode(client_id);

    format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&access_type=offline&prompt=consent",
        config.auth_url,
        encoded_client_id,
        urlencoding::encode("urn:ietf:wg:oauth:2.0:oob"),
        encoded_scopes,
        state
    )
}

pub async fn exchange_code(
    config: &OAuthConfig,
    code: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<String> {
    let client = reqwest::Client::new();

    let params = [
        ("code", code.to_string()),
        ("client_id", client_id.to_string()),
        ("client_secret", client_secret.to_string()),
        ("redirect_uri", "urn:ietf:wg:oauth:2.0:oob".to_string()),
        ("grant_type", "authorization_code".to_string()),
    ];

    let response = client
        .post(&config.token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| anyhow!("HTTP request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| anyhow!("Failed to read response body: {}", e))?;

    if !status.is_success() {
        return Err(anyhow!("Token exchange failed (HTTP {}): {}", status, body));
    }

    let token: TokenResponse = serde_json::from_str(&body)
        .map_err(|e| anyhow!("Failed to parse token response: {}", e))?;

    if let Some(error) = token.error {
        let desc = token.error_description.unwrap_or_default();
        return Err(anyhow!("OAuth error: {} - {}", error, desc));
    }

    token
        .refresh_token
        .ok_or_else(|| anyhow!("No refresh_token in response. Response was: {}", body))
}

pub async fn discover_oauth_skills(agents_dir: &Path) -> Result<HashMap<String, OAuthSkill>> {
    let mut skills = HashMap::new();

    if !agents_dir.exists() {
        return Ok(skills);
    }

    let mut agent_entries = fs::read_dir(agents_dir).await?;
    while let Some(agent_entry) = agent_entries.next_entry().await? {
        let agent_dir = agent_entry.path();
        let skills_dir = agent_dir.join("skills");

        if !skills_dir.exists() {
            continue;
        }

        let mut skill_entries = fs::read_dir(&skills_dir).await?;
        while let Some(skill_entry) = skill_entries.next_entry().await? {
            let skill_dir = skill_entry.path();
            let manifest_path = skill_dir.join("manifest.toml");

            if !manifest_path.exists() {
                continue;
            }

            if let Ok(contents) = fs::read_to_string(&manifest_path).await {
                if let Ok(manifest) = toml::from_str::<SkillManifest>(&contents) {
                    if let Some(oauth_config) = manifest.oauth {
                        skills.insert(
                            manifest.name.clone(),
                            OAuthSkill {
                                skill_name: manifest.name,
                                manifest_path,
                                config: oauth_config,
                            },
                        );
                    }
                }
            }
        }
    }

    Ok(skills)
}

pub async fn find_oauth_skill(agents_dir: &Path, skill_name: &str) -> Result<Option<OAuthSkill>> {
    let skills = discover_oauth_skills(agents_dir).await?;
    Ok(skills.get(skill_name).cloned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::OAuthConfig;

    #[test]
    fn generate_state_produces_32_char_alphanumeric() {
        let s = generate_state();
        assert_eq!(s.len(), 32);
        assert!(s.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn generate_state_produces_different_values() {
        let a = generate_state();
        let b = generate_state();
        assert_ne!(a, b);
    }

    #[test]
    fn build_auth_url_contains_required_params() {
        let config = OAuthConfig {
            auth_url: "https://auth.example.com/authorize".to_string(),
            token_url: "https://auth.example.com/token".to_string(),
            client_id_env: "CLIENT_ID".to_string(),
            client_secret_env: "CLIENT_SECRET".to_string(),
            refresh_token_env: "REFRESH_TOKEN".to_string(),
            scopes: vec!["scope1".to_string(), "scope2".to_string()],
            scope_separator: " ".to_string(),
        };
        let url = build_auth_url(&config, "my-client-id", "xyz-state");
        assert!(url.starts_with("https://auth.example.com/authorize?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=my-client-id"));
        assert!(url.contains("redirect_uri="));
        assert!(url.contains("urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob"));
        assert!(url.contains("scope=scope1%20scope2"));
        assert!(url.contains("state=xyz-state"));
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("prompt=consent"));
    }

    #[test]
    fn build_auth_url_uses_scope_separator() {
        let config = OAuthConfig {
            auth_url: "https://auth.example.com/authorize".to_string(),
            token_url: "https://auth.example.com/token".to_string(),
            client_id_env: "CID".to_string(),
            client_secret_env: "CS".to_string(),
            refresh_token_env: "RT".to_string(),
            scopes: vec!["a".to_string(), "b".to_string()],
            scope_separator: ",".to_string(),
        };
        let url = build_auth_url(&config, "id", "s");
        assert!(url.contains("scope=a%2Cb"));
    }

    #[tokio::test]
    async fn discover_oauth_skills_returns_empty_for_nonexistent_dir() {
        let tmp = std::env::temp_dir().join(format!(
            "moxxy_oauth_test_nonexistent_{}",
            std::process::id()
        ));
        let skills = discover_oauth_skills(tmp.as_path()).await.unwrap();
        assert!(skills.is_empty());
    }

    #[tokio::test]
    async fn discover_oauth_skills_finds_skill_with_oauth_config() {
        let tmp =
            std::env::temp_dir().join(format!("moxxy_oauth_test_finds_{}", std::process::id()));
        std::fs::create_dir_all(tmp.join("agents/default/skills/test_oauth")).unwrap();
        let manifest = r#"
name = "test_oauth"
description = "Test"
version = "1.0.0"

[oauth]
auth_url = "https://accounts.example.com/oauth"
token_url = "https://accounts.example.com/token"
client_id_env = "TEST_CLIENT_ID"
client_secret_env = "TEST_CLIENT_SECRET"
refresh_token_env = "TEST_REFRESH_TOKEN"
scopes = ["read", "write"]
"#;
        std::fs::write(
            tmp.join("agents/default/skills/test_oauth/manifest.toml"),
            manifest,
        )
        .unwrap();

        let skills = discover_oauth_skills(tmp.join("agents").as_path())
            .await
            .unwrap();
        assert_eq!(skills.len(), 1);
        assert!(skills.contains_key("test_oauth"));
        let skill = skills.get("test_oauth").unwrap();
        assert_eq!(skill.config.auth_url, "https://accounts.example.com/oauth");
        assert_eq!(skill.config.client_id_env, "TEST_CLIENT_ID");

        std::fs::remove_dir_all(tmp).ok();
    }

    #[tokio::test]
    async fn discover_oauth_skills_ignores_manifests_without_oauth() {
        let tmp =
            std::env::temp_dir().join(format!("moxxy_oauth_test_plain_{}", std::process::id()));
        std::fs::create_dir_all(tmp.join("agents/default/skills/plain_skill")).unwrap();
        let manifest = r#"
name = "plain_skill"
description = "No OAuth"
version = "1.0.0"
"#;
        std::fs::write(
            tmp.join("agents/default/skills/plain_skill/manifest.toml"),
            manifest,
        )
        .unwrap();

        let skills = discover_oauth_skills(tmp.join("agents").as_path())
            .await
            .unwrap();
        assert!(skills.is_empty());

        std::fs::remove_dir_all(tmp).ok();
    }

    #[tokio::test]
    async fn find_oauth_skill_returns_some_when_found() {
        let tmp =
            std::env::temp_dir().join(format!("moxxy_oauth_test_find_{}", std::process::id()));
        std::fs::create_dir_all(tmp.join("agents/default/skills/my_skill")).unwrap();
        let manifest = r#"
name = "my_skill"
description = "Test"
version = "1.0.0"

[oauth]
auth_url = "https://auth.example.com"
token_url = "https://token.example.com"
client_id_env = "CID"
client_secret_env = "CS"
refresh_token_env = "RT"
scopes = ["s1"]
"#;
        std::fs::write(
            tmp.join("agents/default/skills/my_skill/manifest.toml"),
            manifest,
        )
        .unwrap();

        let agents_dir = tmp.join("agents");
        let found = find_oauth_skill(agents_dir.as_path(), "my_skill")
            .await
            .unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().skill_name, "my_skill");

        let not_found = find_oauth_skill(agents_dir.as_path(), "nonexistent")
            .await
            .unwrap();
        assert!(not_found.is_none());

        std::fs::remove_dir_all(tmp).ok();
    }

    #[tokio::test]
    async fn exchange_code_returns_refresh_token_from_mock_server() {
        use axum::{Json, Router, routing::post};
        use tokio::sync::oneshot;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let token_url = format!("http://127.0.0.1:{}/token", port);

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            let app = Router::new().route(
                "/token",
                post(|| async {
                    Json(serde_json::json!({
                        "refresh_token": "mock-refresh-token-12345",
                        "access_token": "mock-access-token",
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

        // Give the server a moment to accept connections
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        let config = OAuthConfig {
            auth_url: "https://auth.example.com".to_string(),
            token_url: token_url.clone(),
            client_id_env: "CID".to_string(),
            client_secret_env: "CS".to_string(),
            refresh_token_env: "RT".to_string(),
            scopes: vec!["read".to_string()],
            scope_separator: " ".to_string(),
        };

        let result = exchange_code(&config, "auth-code-xyz", "client-id", "client-secret").await;
        assert!(result.is_ok(), "exchange_code failed: {:?}", result.err());
        assert_eq!(result.unwrap(), "mock-refresh-token-12345");

        let _ = shutdown_tx.send(());
        let _ = handle.await;
    }
}
