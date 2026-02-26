pub mod native_executor;

use anyhow::Result;
use async_trait::async_trait;
use include_dir::{Dir, include_dir};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tracing::{info, warn};

use crate::core::lifecycle::LifecycleComponent;
use crate::core::mcp::McpClient;

static BUILTINS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/skills/builtins");

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct SkillManifest {
    pub name: String,
    pub description: String,
    pub version: String,

    #[serde(default = "default_executor_type")]
    pub executor_type: String, // "native", "wasm", "mcp", "openclaw"
    #[serde(default)]
    pub needs_network: bool,
    #[serde(default)]
    pub needs_fs_read: bool,
    #[serde(default)]
    pub needs_fs_write: bool,
    #[serde(default)]
    pub needs_env: bool,

    /// When non-empty, only inject these vault keys (instead of all secrets).
    #[serde(default)]
    pub env_keys: Vec<String>,

    // Optional path to the executable script (defaults to run.sh)
    #[serde(default = "default_entrypoint")]
    pub entrypoint: String,

    #[serde(default = "default_run_command")]
    pub run_command: String,

    /// Platform filter: "all" (default), "macos", or "windows". Skills with non-matching platform are skipped at load time.
    #[serde(default = "default_platform")]
    pub platform: String,

    // Openclaw fields
    #[serde(default)]
    pub triggers: Vec<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub doc_files: Vec<String>,

    // Internal path injected during load to know where the skill lives
    #[serde(skip)]
    pub skill_dir: PathBuf,

    /// Whether this skill has full host access (only set for hardcoded built-in skills).
    /// Agent-installed skills always have this forced to `false`.
    #[serde(skip)]
    pub privileged: bool,

    /// When true, the agent must ask for explicit user confirmation before executing.
    #[serde(default)]
    pub needs_confirmation: bool,

    // OAuth2 configuration for skills that require OAuth authentication
    #[serde(default)]
    pub oauth: Option<OAuthConfig>,
}

fn default_executor_type() -> String {
    "native".to_string()
}

fn default_entrypoint() -> String {
    "run.sh".to_string()
}

fn default_run_command() -> String {
    use crate::platform::{NativePlatform, Platform};
    NativePlatform::default_shell().to_string()
}

fn default_platform() -> String {
    "all".to_string()
}

/// Returns true if this skill's platform filter matches the current OS.
fn platform_matches(platform: &str) -> bool {
    if platform == "all" {
        return true;
    }
    let current = std::env::consts::OS;
    match platform {
        "macos" => current == "macos",
        "windows" => current == "windows",
        _ => true,
    }
}

fn default_scope_separator() -> String {
    " ".to_string()
}

/// Extract human-readable text from MCP tools/call result.
/// The MCP result has `content: [{type: "text", text: "..."}, ...]`.
/// Falls back to pretty-printed JSON if no text content is found.
fn extract_mcp_text_content(result: &serde_json::Value) -> String {
    let Some(content) = result.get("content").and_then(|c| c.as_array()) else {
        return serde_json::to_string_pretty(result).unwrap_or_default();
    };
    let texts: Vec<String> = content
        .iter()
        .filter_map(|item| {
            item.get("type")
                .and_then(|t| t.as_str())
                .filter(|&t| t == "text")
                .and_then(|_| item.get("text"))
                .and_then(|t| t.as_str())
                .map(String::from)
        })
        .collect();
    if texts.is_empty() {
        serde_json::to_string_pretty(result).unwrap_or_default()
    } else {
        texts.join("\n\n")
    }
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct OAuthConfig {
    pub auth_url: String,
    pub token_url: String,
    pub client_id_env: String,
    pub client_secret_env: String,
    pub refresh_token_env: String,
    pub scopes: Vec<String>,
    #[serde(default = "default_scope_separator")]
    pub scope_separator: String,
}

#[async_trait]
pub trait SkillSandbox: Send + Sync {
    async fn execute(&self, manifest: &SkillManifest, args: &[String]) -> Result<String>;
}

/// Represents how a skill should be executed after the SkillManager lock is dropped.
pub enum SkillExecution {
    Native(Arc<dyn SkillSandbox>),
    Mcp {
        client: Arc<McpClient>,
        tool_name: String,
    },
    Openclaw,
}

impl SkillExecution {
    pub async fn execute(&self, manifest: &SkillManifest, args: &[String]) -> Result<String> {
        match self {
            SkillExecution::Native(sandbox) => sandbox.execute(manifest, args).await,
            SkillExecution::Mcp { client, tool_name } => {
                // MCP tools expect a JSON object as arguments.
                // The LLM may pass args in several ways:
                //   1. A single string that is itself a JSON object: ["{\"query\": \"...\"}"]
                //   2. A raw JSON object if the parser fell through: args[0] = {"query": "..."}
                //   3. Empty args
                // Try to extract a JSON object from whatever we got.
                let args_json = if !args.is_empty() {
                    let first = &args[0];
                    // Try parsing directly as a JSON value
                    match serde_json::from_str::<serde_json::Value>(first) {
                        Ok(val) if val.is_object() => val,
                        _ => serde_json::json!({}),
                    }
                } else {
                    serde_json::json!({})
                };
                let result = client.call_tool(tool_name, args_json).await?;
                Ok(extract_mcp_text_content(&result))
            }
            SkillExecution::Openclaw => {
                let files = if manifest.doc_files.is_empty() {
                    vec!["skill.md".to_string()]
                } else {
                    manifest.doc_files.clone()
                };
                let mut docs = String::new();
                for filename in &files {
                    if validate_filename(filename).is_err() {
                        continue;
                    }
                    let path = manifest.skill_dir.join(filename);
                    if let Ok(content) = tokio::fs::read_to_string(&path).await {
                        if !docs.is_empty() {
                            docs.push_str("\n\n---\n\n");
                        }
                        docs.push_str(&content);
                    }
                }
                if docs.is_empty() {
                    return Err(anyhow::anyhow!(
                        "Openclaw skill '{}' has no documentation files",
                        manifest.name
                    ));
                }
                // If the agent passed arguments, include them as context
                let context = if !args.is_empty() && !args[0].is_empty() {
                    format!("\n\nUser request context: {}\n", args.join(" "))
                } else {
                    String::new()
                };
                Ok(format!(
                    "This is an openclaw (documentation-only) skill. \
                     Use `host_shell` with curl to make the API calls described below.{}\n\n{}",
                    context, docs
                ))
            }
        }
    }
}

// --- Openclaw parsing helpers ---

#[derive(Debug, Deserialize)]
struct OpenclawFrontmatter {
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    homepage: Option<String>,
    #[allow(dead_code)]
    metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct OpenclawSkillJson {
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    homepage: Option<String>,
    moltbot: Option<OpenclawMoltbot>,
}

#[derive(Debug, Deserialize)]
struct OpenclawMoltbot {
    triggers: Option<Vec<String>>,
    files: Option<HashMap<String, String>>,
    #[allow(dead_code)]
    api_base: Option<String>,
}

fn parse_yaml_frontmatter(content: &str) -> Result<(OpenclawFrontmatter, String)> {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return Err(anyhow::anyhow!("No YAML frontmatter found"));
    }
    let after_first = &trimmed[3..];
    let end_idx = after_first
        .find("\n---")
        .ok_or_else(|| anyhow::anyhow!("Unterminated YAML frontmatter"))?;
    let yaml_str = &after_first[..end_idx];
    let body = &after_first[end_idx + 4..];
    let frontmatter: OpenclawFrontmatter = serde_yaml::from_str(yaml_str)?;
    Ok((frontmatter, body.to_string()))
}

/// Validate a filename to prevent directory traversal attacks.
fn validate_filename(name: &str) -> Result<()> {
    if name.contains("..") || name.starts_with('/') || name.starts_with('\\') || name.contains('\0')
    {
        return Err(anyhow::anyhow!(
            "Invalid filename '{}': must not contain '..', start with '/' or '\\', or contain null bytes",
            name
        ));
    }
    Ok(())
}

/// Validate that a URL is not targeting localhost or private networks (SSRF protection).
fn validate_url_not_local(url: &str) -> Result<()> {
    let parsed =
        url::Url::parse(url).map_err(|e| anyhow::anyhow!("Invalid URL '{}': {}", url, e))?;
    if let Some(host) = parsed.host_str() {
        let host_lower = host.to_lowercase();
        if host_lower == "localhost"
            || host_lower == "127.0.0.1"
            || host_lower == "::1"
            || host_lower == "[::1]"
            || host_lower == "0.0.0.0"
            || host_lower.starts_with("10.")
            || host_lower.starts_with("192.168.")
            || host_lower.starts_with("172.16.")
            || host_lower.starts_with("172.17.")
            || host_lower.starts_with("172.18.")
            || host_lower.starts_with("172.19.")
            || host_lower.starts_with("172.2")
            || host_lower.starts_with("172.30.")
            || host_lower.starts_with("172.31.")
            || host_lower.ends_with(".local")
            || host_lower == "metadata.google.internal"
            || host_lower == "169.254.169.254"
        {
            return Err(anyhow::anyhow!(
                "URL '{}' targets a local or private network address, which is not allowed for security reasons",
                url
            ));
        }
    }
    Ok(())
}

/// Built-in skills that are granted full host access (bypass workspace sandbox).
/// These are hardcoded and cannot be overridden by agent-installed skills.
const PRIVILEGED_SKILLS: &[&str] = &[
    "host_shell",
    "host_python",
    "computer_control",
    "windows_control",
    "evolve_core",
    "browser",
    "osx_email",
    "git",
    "github",
    "google_workspace",
    "skill",
    "openclaw_migrate",
    "file_ops",
    "workspace_shell",
    "manage_vault",
    "manage_providers",
    "scheduler",
    "modify_schedule",
    "remove_schedule",
    "mcp",
    "delegate_task",
    "telegram_notify",
    "discord_notify",
    "discord_channels",
    "discord_add_listen_channel",
    "discord_remove_listen_channel",
    "whatsapp_notify",
    "webhook",
];

pub struct SkillManager {
    skills: HashMap<String, SkillManifest>,
    sandbox: Arc<dyn SkillSandbox>,
    mcp_clients: HashMap<String, Arc<McpClient>>, // MCP server name -> client
    workspace_dir: PathBuf,
}

impl SkillManager {
    pub fn new(sandbox: Box<dyn SkillSandbox>, workspace_dir: PathBuf) -> Self {
        Self {
            skills: HashMap::new(),
            sandbox: Arc::from(sandbox),
            mcp_clients: HashMap::new(),
            workspace_dir,
        }
    }

    pub fn register_mcp_client(&mut self, server_name: String, client: Arc<McpClient>) {
        info!("Registering MCP Client for server: {}", server_name);
        self.mcp_clients.insert(server_name, client);
    }

    /// Returns a cloned manifest and a reference to the sandbox, so callers
    /// can drop the SkillManager lock before awaiting execution.
    pub fn prepare_skill(&self, name: &str) -> Result<(SkillManifest, SkillExecution)> {
        let manifest = self
            .skills
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", name))?
            .clone();

        if manifest.executor_type == "mcp" {
            // Find the MCP client that owns this tool (use strip_prefix to avoid over-trimming
            // when tool names overlap with server prefix, e.g. server "exa" + tool "exa_search")
            for (server, client) in &self.mcp_clients {
                let prefix = format!("{}_", server);
                if let Some(suffix) = name.strip_prefix(&prefix) {
                    return Ok((
                        manifest,
                        SkillExecution::Mcp {
                            client: Arc::clone(client),
                            tool_name: suffix.to_string(),
                        },
                    ));
                }
            }
            return Err(anyhow::anyhow!("MCP client not found for skill: {}", name));
        }

        if manifest.executor_type == "openclaw" {
            return Ok((manifest, SkillExecution::Openclaw));
        }

        Ok((manifest, SkillExecution::Native(Arc::clone(&self.sandbox))))
    }

    pub fn register_skill(&mut self, manifest: SkillManifest) {
        info!("Registering skill: {}", manifest.name);
        self.skills.insert(manifest.name.clone(), manifest);
    }

    pub fn get_all_skills(&self) -> Vec<SkillManifest> {
        self.skills.values().cloned().collect()
    }

    /// Return a formatted skill catalog with usage docs from skill.md files.
    pub fn get_skill_catalog(&self) -> String {
        let mut catalog = String::new();
        for manifest in self.skills.values() {
            let confirm_tag = if manifest.needs_confirmation {
                " [REQUIRES CONFIRMATION]"
            } else {
                ""
            };
            catalog.push_str(&format!(
                "### [{}] - {}{}\n",
                manifest.name, manifest.description, confirm_tag
            ));

            if manifest.executor_type == "openclaw" && !manifest.triggers.is_empty() {
                catalog.push_str(&format!("Triggers: {}\n", manifest.triggers.join(", ")));
            }

            let skill_md_path = manifest.skill_dir.join("skill.md");
            if let Ok(docs) = std::fs::read_to_string(&skill_md_path) {
                let max_len = if manifest.executor_type == "openclaw" {
                    2000
                } else {
                    500
                };
                let trimmed = if docs.len() > max_len {
                    format!("{}...", &docs[..max_len])
                } else {
                    docs
                };
                catalog.push_str(&trimmed);
                catalog.push('\n');
            }
            catalog.push('\n');
        }
        if catalog.is_empty() {
            "No skills available.".to_string()
        } else {
            catalog
        }
    }

    pub async fn load_skills_from_dir<P: AsRef<Path>>(&mut self, dir_path: P) -> Result<()> {
        let path = dir_path.as_ref();
        if !path.exists() || !path.is_dir() {
            warn!("Skills directory not found at {:?}", path);
            return Ok(());
        }

        let mut entries = fs::read_dir(path).await?;
        while let Some(entry) = entries.next_entry().await? {
            let skill_dir = entry.path();
            if skill_dir.is_dir() {
                let manifest_path = skill_dir.join("manifest.toml");
                if manifest_path.exists() {
                    match fs::read_to_string(&manifest_path).await {
                        Ok(contents) => match toml::from_str::<SkillManifest>(&contents) {
                            Ok(mut manifest) => {
                                if !platform_matches(&manifest.platform) {
                                    info!(
                                        "Skipping skill [{}]: platform {:?} does not match current OS",
                                        manifest.name, manifest.platform
                                    );
                                    continue;
                                }
                                manifest.skill_dir = skill_dir.clone();

                                // On Windows, prefer run.ps1 over run.sh when available
                                if std::env::consts::OS == "windows" {
                                    let run_ps1 = skill_dir.join("run.ps1");
                                    if run_ps1.exists() && manifest.entrypoint == "run.sh" {
                                        manifest.entrypoint = "run.ps1".to_string();
                                        manifest.run_command = "powershell".to_string();
                                    }
                                }

                                self.register_skill(manifest);
                            }
                            Err(e) => {
                                warn!("Failed to parse manifest at {:?}: {}", manifest_path, e)
                            }
                        },
                        Err(e) => warn!("Failed to read manifest at {:?}: {}", manifest_path, e),
                    }
                }
            }
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn execute_skill(&self, name: &str, args: &[String]) -> Result<String> {
        let manifest = self
            .skills
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", name))?;

        if manifest.executor_type == "mcp" {
            let args_json = if !args.is_empty() {
                serde_json::from_str(&args[0]).unwrap_or_else(|_| serde_json::json!({}))
            } else {
                serde_json::json!({})
            };

            for (server, client) in &self.mcp_clients {
                let prefix = format!("{}_", server);
                if let Some(tool) = name.strip_prefix(&prefix) {
                    let result = client.call_tool(tool, args_json).await?;
                    return Ok(extract_mcp_text_content(&result));
                }
            }

            return Err(anyhow::anyhow!(
                "MCP client not found to execute tool: {}",
                name
            ));
        }

        if manifest.executor_type == "openclaw" {
            let execution = SkillExecution::Openclaw;
            return execution.execute(manifest, args).await;
        }

        self.sandbox.execute(manifest, args).await
    }

    pub async fn install_skill(
        &mut self,
        new_manifest_content: &str,
        new_run_sh: &str,
        new_skill_md: &str,
    ) -> Result<()> {
        let mut manifest: SkillManifest = toml::from_str(new_manifest_content)?;
        // Agent-installed skills are never privileged
        manifest.privileged = false;

        // Validate entrypoint path to prevent directory traversal
        if manifest.entrypoint.contains("..") || manifest.entrypoint.starts_with('/') {
            return Err(anyhow::anyhow!(
                "Invalid entrypoint path: must not contain '..' or start with '/'"
            ));
        }

        let skill_dir = self.workspace_dir.join("skills").join(&manifest.name);

        if skill_dir.exists() {
            return Err(anyhow::anyhow!(
                "Skill {} already exists. Please use upgrade_skill to modify it.",
                manifest.name
            ));
        }

        tokio::fs::create_dir_all(&skill_dir).await?;
        tokio::fs::write(skill_dir.join("manifest.toml"), new_manifest_content).await?;
        tokio::fs::write(skill_dir.join("run.sh"), new_run_sh).await?;
        tokio::fs::write(skill_dir.join("skill.md"), new_skill_md).await?;

        let mut new_manifest = manifest.clone();
        new_manifest.skill_dir = skill_dir;
        self.register_skill(new_manifest);

        info!("Successfully installed new skill: {}", manifest.name);
        Ok(())
    }

    pub async fn install_openclaw_skill(&mut self, url: &str) -> Result<()> {
        // Validate URL is not targeting localhost/private networks (SSRF protection)
        validate_url_not_local(url)?;

        let client = reqwest::Client::new();

        // 1. Fetch the primary skill.md
        let skill_md_content = client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        // 2. Parse YAML frontmatter
        let (frontmatter, _body) = parse_yaml_frontmatter(&skill_md_content)?;

        let name = frontmatter
            .name
            .ok_or_else(|| anyhow::anyhow!("skill.md has no 'name' in YAML frontmatter"))?;
        let version = frontmatter.version.unwrap_or_else(|| "1.0.0".to_string());
        let description = frontmatter
            .description
            .unwrap_or_else(|| format!("Openclaw skill: {}", name));
        let homepage = frontmatter.homepage;

        // 3. Try to fetch skill.json from the same base URL
        let base_url = url.rsplit_once('/').map(|(base, _)| base).unwrap_or(url);
        let skill_json_url = format!("{}/skill.json", base_url);
        let skill_json: Option<OpenclawSkillJson> = match client.get(&skill_json_url).send().await {
            Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
            _ => None,
        };

        // 4. Collect triggers and additional files
        let mut triggers: Vec<String> = Vec::new();
        let mut doc_files: Vec<String> = vec!["skill.md".to_string()];
        let mut additional_docs: Vec<(String, String)> = Vec::new();

        if let Some(ref sj) = skill_json {
            if let Some(ref moltbot) = sj.moltbot {
                triggers = moltbot.triggers.clone().unwrap_or_default();
                if let Some(ref files) = moltbot.files {
                    for (filename, file_url) in files {
                        let normalized = filename.to_lowercase();
                        if normalized == "skill.md" {
                            continue;
                        }
                        if validate_filename(&normalized).is_err() {
                            warn!("Skipping remote file with invalid name: {}", normalized);
                            continue;
                        }
                        if validate_url_not_local(file_url).is_err() {
                            warn!("Skipping remote file with local/private URL: {}", file_url);
                            continue;
                        }
                        if let Ok(resp) = client.get(file_url).send().await {
                            if let Ok(content) = resp.text().await {
                                additional_docs.push((normalized.clone(), content));
                                doc_files.push(normalized);
                            }
                        }
                    }
                }
            }
        }

        // 5. Check if skill already exists
        let skill_dir = self.workspace_dir.join("skills").join(&name);
        if skill_dir.exists() {
            return Err(anyhow::anyhow!(
                "Skill {} already exists. Remove it first to reinstall.",
                name
            ));
        }

        // 6. Build manifest (agent-installed skills are never privileged)
        let manifest = SkillManifest {
            name: name.clone(),
            description,
            version,
            executor_type: "openclaw".to_string(),
            needs_network: true,
            needs_fs_read: false,
            needs_fs_write: false,
            needs_env: false,
            entrypoint: "skill.md".to_string(),
            run_command: String::new(),
            platform: "all".to_string(),
            triggers,
            homepage,
            doc_files,
            skill_dir: skill_dir.clone(),
            privileged: false,
            needs_confirmation: false,
            oauth: None,
            env_keys: Vec::new(),
        };

        // 7. Write files to disk
        tokio::fs::create_dir_all(&skill_dir).await?;

        let manifest_toml = toml::to_string_pretty(&manifest)?;
        tokio::fs::write(skill_dir.join("manifest.toml"), &manifest_toml).await?;
        tokio::fs::write(skill_dir.join("skill.md"), &skill_md_content).await?;

        for (filename, content) in &additional_docs {
            tokio::fs::write(skill_dir.join(filename), content).await?;
        }

        // 8. Register
        self.register_skill(manifest);
        info!("Successfully installed openclaw skill: {}", name);
        Ok(())
    }

    /// Built-in skill names that cannot be removed.
    const PROTECTED_SKILLS: &'static [&'static str] = &[
        "skill",
        "host_shell",
        "delegate_task",
        "evolve_core",
        "computer_control",
        "windows_control",
        "browser",
        "example_skill",
        "telegram_notify",
        "discord_notify",
        "discord_channels",
        "discord_add_listen_channel",
        "discord_remove_listen_channel",
        "whatsapp_notify",
        "git",
        "github",
        "scheduler",
        "remove_schedule",
        "modify_schedule",
        "webhook",
        "openclaw_migrate",
        "osx_email",
        "file_ops",
        "workspace_shell",
    ];

    pub async fn remove_skill(&mut self, skill_name: &str) -> Result<()> {
        if Self::PROTECTED_SKILLS.contains(&skill_name) {
            return Err(anyhow::anyhow!(
                "Cannot remove built-in skill: {}",
                skill_name
            ));
        }

        let manifest = self
            .skills
            .get(skill_name)
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", skill_name))?;

        let skill_dir = manifest.skill_dir.clone();

        // Remove from memory
        self.skills.remove(skill_name);

        // Remove from disk
        if skill_dir.exists() {
            tokio::fs::remove_dir_all(&skill_dir).await?;
        }

        info!("Successfully removed skill: {}", skill_name);
        Ok(())
    }

    pub async fn modify_skill_file(
        &mut self,
        skill_name: &str,
        file_name: &str,
        content: &str,
    ) -> Result<()> {
        let manifest = self
            .skills
            .get(skill_name)
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", skill_name))?;

        let skill_dir = manifest.skill_dir.clone();
        let is_openclaw = manifest.executor_type == "openclaw";

        validate_filename(file_name)?;

        if is_openclaw {
            if file_name != "manifest.toml" && !file_name.ends_with(".md") {
                return Err(anyhow::anyhow!(
                    "Openclaw skills can only modify manifest.toml or .md files"
                ));
            }
        } else {
            let allowed_files = ["manifest.toml", "skill.md", "run.sh"];
            if !allowed_files.contains(&file_name) {
                return Err(anyhow::anyhow!(
                    "Can only modify: manifest.toml, skill.md, or run.sh"
                ));
            }
        }

        let file_path = skill_dir.join(file_name);
        tokio::fs::write(&file_path, content).await?;

        // If manifest was modified, hot-reload the skill in memory
        if file_name == "manifest.toml" {
            let mut new_manifest: SkillManifest = toml::from_str(content)
                .map_err(|e| anyhow::anyhow!("Invalid manifest TOML: {}", e))?;

            // Prevent privilege escalation: the manifest name must match the
            // original skill name. Changing it to a PRIVILEGED_SKILLS entry
            // would grant unintended host access.
            if new_manifest.name != skill_name {
                return Err(anyhow::anyhow!(
                    "Cannot change skill name via manifest modification (was '{}', got '{}'). \
                     Remove and reinstall the skill instead.",
                    skill_name,
                    new_manifest.name
                ));
            }

            new_manifest.skill_dir = skill_dir;
            // Only hardcoded built-in skills can be privileged
            new_manifest.privileged = PRIVILEGED_SKILLS.contains(&new_manifest.name.as_str());
            self.register_skill(new_manifest);
            info!("Hot-reloaded skill manifest for: {}", skill_name);
        }

        info!("Modified {}/{} successfully", skill_name, file_name);
        Ok(())
    }

    pub async fn upgrade_skill(
        &mut self,
        skill_name: &str,
        new_version_str: &str,
        new_manifest_content: &str,
        new_run_sh: &str,
        new_skill_md: &str,
    ) -> Result<()> {
        // Reject upgrades to privileged built-in skills (they are compiled into the binary)
        if PRIVILEGED_SKILLS.contains(&skill_name) {
            return Err(anyhow::anyhow!(
                "Cannot upgrade privileged built-in skill: {}",
                skill_name
            ));
        }

        let current_manifest = self
            .skills
            .get(skill_name)
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", skill_name))?;

        // Use semver crate to properly calculate versions (e.g v1.2.0 > v1.1.9)
        let current_version =
            semver::Version::parse(current_manifest.version.trim_start_matches('v'))
                .unwrap_or_else(|_| semver::Version::new(0, 0, 0));
        let new_version =
            semver::Version::parse(new_version_str.trim_start_matches('v')).map_err(|e| {
                anyhow::anyhow!("Invalid new version format for skill {}: {}", skill_name, e)
            })?;

        if new_version <= current_version {
            return Err(anyhow::anyhow!(
                "Upgrade rejected: New version {} is not strictly greater than current version {} for skill {}",
                new_version,
                current_version,
                skill_name
            ));
        }

        // Write the new payload over the host files
        let skill_dir = current_manifest.skill_dir.clone();
        tokio::fs::write(skill_dir.join("manifest.toml"), new_manifest_content).await?;
        tokio::fs::write(skill_dir.join("run.sh"), new_run_sh).await?;
        tokio::fs::write(skill_dir.join("skill.md"), new_skill_md).await?;

        // Hot-swap parsing
        let mut new_manifest: SkillManifest = toml::from_str(new_manifest_content)?;
        new_manifest.skill_dir = skill_dir.clone();
        // Only hardcoded built-in skills can be privileged
        new_manifest.privileged = PRIVILEGED_SKILLS.contains(&new_manifest.name.as_str());

        self.register_skill(new_manifest);

        info!(
            "Successfully upgraded skill {} to {}",
            skill_name, new_version_str
        );
        Ok(())
    }
}

#[async_trait]
impl LifecycleComponent for SkillManager {
    async fn on_init(&mut self) -> Result<()> {
        info!("SkillManager initializing...");
        let skills_dir = self.workspace_dir.join("skills");
        if !skills_dir.exists() {
            tokio::fs::create_dir_all(&skills_dir).await?;
        }

        // Remove stale built-in skill directories before re-extracting so that
        // a binary update always replaces them with the version compiled in.
        let pre_clean_path = skills_dir.clone();
        tokio::task::spawn_blocking(move || {
            for entry in BUILTINS_DIR.dirs() {
                let dir_path = pre_clean_path.join(entry.path());
                if dir_path.exists() {
                    let _ = std::fs::remove_dir_all(&dir_path);
                }
            }
        })
        .await?;

        let extract_path = skills_dir.clone();
        if let Err(e) =
            tokio::task::spawn_blocking(move || BUILTINS_DIR.extract(&extract_path)).await?
        {
            warn!("Failed extracting builtins: {}", e);
        }

        // Set executable permission on extracted skill scripts
        {
            use crate::platform::{NativePlatform, Platform};
            if let Ok(mut entries) = tokio::fs::read_dir(&skills_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                        let run_sh = entry.path().join("run.sh");
                        if run_sh.exists() {
                            NativePlatform::set_executable(&run_sh);
                        }
                    }
                }
            }
        }

        // Auto-load skills from the agent's workspace
        if let Err(e) = self.load_skills_from_dir(&skills_dir).await {
            warn!(
                "Error loading skills from directory {:?}: {}",
                skills_dir, e
            );
        }

        // Set privileged flag based on hardcoded allowlist (authoritative source).
        // This ensures even tampered manifest.toml files cannot grant privilege.
        for manifest in self.skills.values_mut() {
            manifest.privileged = PRIVILEGED_SKILLS.contains(&manifest.name.as_str());
        }

        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        info!("SkillManager starting...");
        info!("Loaded {} skills", self.skills.len());
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!("SkillManager shutting down...");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_mcp_text_content_extracts_text_items() {
        let result = serde_json::json!({
            "content": [
                {"type": "text", "text": "First output"},
                {"type": "image", "data": "base64..."},
                {"type": "text", "text": "Second output"}
            ],
            "isError": false
        });
        let out = extract_mcp_text_content(&result);
        assert_eq!(out, "First output\n\nSecond output");
    }

    #[test]
    fn extract_mcp_text_content_falls_back_to_json_when_no_text() {
        let result = serde_json::json!({
            "content": [{"type": "image", "data": "base64..."}],
            "isError": false
        });
        let out = extract_mcp_text_content(&result);
        assert!(out.contains("\"content\""));
        assert!(out.contains("\"image\""));
    }

    #[test]
    fn extract_mcp_text_content_falls_back_to_json_when_no_content_key() {
        let result = serde_json::json!({"isError": false});
        let out = extract_mcp_text_content(&result);
        assert!(out.contains("\"isError\""));
        assert_eq!(result.get("content"), None);
    }

    #[test]
    fn extract_mcp_text_content_handles_empty_content_array() {
        let result = serde_json::json!({"content": [], "isError": false});
        let out = extract_mcp_text_content(&result);
        assert!(out.contains("\"content\""));
    }
}
