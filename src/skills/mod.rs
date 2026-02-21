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
    pub executor_type: String, // "native", "wasm", "mcp"
    #[serde(default)]
    pub needs_network: bool,
    #[serde(default)]
    pub needs_fs_read: bool,
    #[serde(default)]
    pub needs_fs_write: bool,
    #[serde(default)]
    pub needs_env: bool,

    // Optional path to the executable script (defaults to run.sh)
    #[serde(default = "default_entrypoint")]
    pub entrypoint: String,

    #[serde(default = "default_run_command")]
    pub run_command: String,

    // Internal path injected during load to know where the skill lives
    #[serde(skip)]
    pub skill_dir: PathBuf,
}

fn default_executor_type() -> String {
    "native".to_string()
}

fn default_entrypoint() -> String {
    "run.sh".to_string()
}

fn default_run_command() -> String {
    "sh".to_string()
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
                Ok(serde_json::to_string_pretty(&result)?)
            }
        }
    }
}

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
            // Find the MCP client that owns this tool
            for (server, client) in &self.mcp_clients {
                if name.starts_with(&format!("{}_", server)) {
                    let tool_name = name.trim_start_matches(&format!("{}_", server)).to_string();
                    return Ok((
                        manifest,
                        SkillExecution::Mcp {
                            client: Arc::clone(client),
                            tool_name,
                        },
                    ));
                }
            }
            return Err(anyhow::anyhow!("MCP client not found for skill: {}", name));
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
            catalog.push_str(&format!(
                "### [{}] - {}\n",
                manifest.name, manifest.description
            ));
            let skill_md_path = manifest.skill_dir.join("skill.md");
            if let Ok(docs) = std::fs::read_to_string(&skill_md_path) {
                // Include a trimmed version of skill.md for context
                let trimmed = if docs.len() > 500 {
                    format!("{}...", &docs[..500])
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
                                manifest.skill_dir = skill_dir.clone();
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
            // Reconstruct the MCP server name (for now assume it's stored in entrypoint or we can just parse it)
            // Or better, the MCP client lookup: the skill name comes from mcp tools,
            // but we need to know WHICH mcp client owns it.
            // Let's iterate and find the client that has this tool.

            // First parse args as a JSON string, which is how the Brain passes arguments to MCP tools.
            let args_json = if !args.is_empty() {
                serde_json::from_str(&args[0]).unwrap_or_else(|_| serde_json::json!({}))
            } else {
                serde_json::json!({})
            };

            // Look up the tool in registered clients using the prefix logic
            // Assuming skill_name = "server_name_tool_name"
            for (server, client) in &self.mcp_clients {
                if name.starts_with(&format!("{}_", server)) {
                    let tool = name.trim_start_matches(&format!("{}_", server));
                    let result = client.call_tool(tool, args_json).await?;
                    return Ok(serde_json::to_string_pretty(&result)?);
                }
            }

            return Err(anyhow::anyhow!(
                "MCP client not found to execute tool: {}",
                name
            ));
        }

        self.sandbox.execute(manifest, args).await
    }

    pub async fn install_skill(
        &mut self,
        new_manifest_content: &str,
        new_run_sh: &str,
        new_skill_md: &str,
    ) -> Result<()> {
        let manifest: SkillManifest = toml::from_str(new_manifest_content)?;
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

    /// Built-in skill names that cannot be removed.
    const PROTECTED_SKILLS: &'static [&'static str] = &[
        "install_skill",
        "upgrade_skill",
        "remove_skill",
        "modify_skill",
        "list_skills",
        "host_shell",
        "delegate_task",
        "evolve_core",
        "computer_control",
        "web_crawler",
        "example_skill",
        "telegram_notify",
        "git",
        "scheduler",
        "remove_schedule",
        "modify_schedule",
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
        let allowed_files = ["manifest.toml", "skill.md", "run.sh"];
        if !allowed_files.contains(&file_name) {
            return Err(anyhow::anyhow!(
                "Can only modify: manifest.toml, skill.md, or run.sh"
            ));
        }

        let file_path = skill_dir.join(file_name);
        tokio::fs::write(&file_path, content).await?;

        // If manifest was modified, hot-reload the skill in memory
        if file_name == "manifest.toml" {
            let mut new_manifest: SkillManifest = toml::from_str(content)
                .map_err(|e| anyhow::anyhow!("Invalid manifest TOML: {}", e))?;
            new_manifest.skill_dir = skill_dir;
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

        // Unpack Native Built-In Skills cleanly into the agent's sandbox
        let extract_path = skills_dir.clone();
        if let Err(e) =
            tokio::task::spawn_blocking(move || BUILTINS_DIR.extract(&extract_path)).await?
        {
            warn!("Failed extracting builtins: {}", e);
        }

        // Auto-load skills from the agent's workspace
        if let Err(e) = self.load_skills_from_dir(&skills_dir).await {
            warn!(
                "Error loading skills from directory {:?}: {}",
                skills_dir, e
            );
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
