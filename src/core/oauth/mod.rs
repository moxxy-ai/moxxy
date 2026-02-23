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
