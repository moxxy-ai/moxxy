use anyhow::{Context, Result};
use console::style;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;

use crate::core::terminal::{
    self, GuideSection, bordered_render_config, close_section, guide_bar, print_error, print_info,
    print_step, print_success,
};

const OPENCLAW_DIR: &str = ".openclaw";

#[derive(Debug, Clone)]
pub struct OpenclawAgent {
    pub soul_md: Option<String>,
    pub agents_md: Option<String>,
    pub memory_md: Option<String>,
    pub daily_memories: Vec<(String, String)>,
    pub skills: Vec<OpenclawSkill>,
}

#[derive(Debug, Clone)]
pub struct OpenclawSkill {
    pub name: String,
    pub description: String,
    pub version: String,
    pub homepage: Option<String>,
    pub skill_md: String,
}

#[derive(Debug, Clone, Default)]
pub struct OpenclawLlmConfig {
    pub primary_provider: Option<String>,
    pub primary_model: Option<String>,
    pub api_keys: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct MigrationPlan {
    pub target_agent: String,
    pub persona_content: String,
    pub skills: Vec<SkillConversion>,
    pub memory_entries: Vec<String>,
    pub heartbeat_schedule: Option<(String, String)>,
    pub llm_migration: Option<OpenclawLlmConfig>,
}

#[derive(Debug, Clone)]
pub struct SkillConversion {
    pub manifest_toml: String,
    pub run_sh: String,
    pub skill_md: String,
    pub skill_name: String,
}

pub async fn run_migration_wizard() -> Result<()> {
    crate::core::terminal::print_banner();
    println!(
        "  {}\n",
        style("OpenClaw → Moxxy Migration Wizard").bold().cyan()
    );

    let home = dirs::home_dir().expect("Could not find home directory");
    let openclaw_path = home.join(OPENCLAW_DIR);

    if !openclaw_path.exists() {
        print_error("OpenClaw installation not found at ~/.openclaw/");
        print_info("Please ensure OpenClaw is installed and has been run at least once.");
        return Ok(());
    }

    print_step("Scanning OpenClaw installation...");

    let workspace_path = openclaw_path.join("workspace");
    let skills_path = workspace_path.join("skills");

    let mut agent = OpenclawAgent {
        soul_md: None,
        agents_md: None,
        memory_md: None,
        daily_memories: Vec::new(),
        skills: Vec::new(),
    };

    if workspace_path.join("SOUL.md").exists() {
        agent.soul_md = Some(fs::read_to_string(workspace_path.join("SOUL.md")).await?);
        print_info("Found SOUL.md");
    }

    if workspace_path.join("AGENTS.md").exists() {
        agent.agents_md = Some(fs::read_to_string(workspace_path.join("AGENTS.md")).await?);
        print_info("Found AGENTS.md");
    }

    if workspace_path.join("MEMORY.md").exists() {
        agent.memory_md = Some(fs::read_to_string(workspace_path.join("MEMORY.md")).await?);
        print_info("Found MEMORY.md");
    }

    let memory_dir = workspace_path.join("memory");
    if memory_dir.exists() {
        let mut entries = fs::read_dir(&memory_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().map(|e| e == "md").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path).await {
                    let filename = path.file_name().unwrap().to_string_lossy().to_string();
                    agent.daily_memories.push((filename, content));
                }
            }
        }
        if !agent.daily_memories.is_empty() {
            print_info(&format!(
                "Found {} daily memory files",
                agent.daily_memories.len()
            ));
        }
    }

    if skills_path.exists() {
        let mut entries = fs::read_dir(&skills_path).await?;
        while let Some(entry) = entries.next_entry().await? {
            let skill_dir = entry.path();
            if skill_dir.is_dir() {
                let skill_md_path = skill_dir.join("SKILL.md");
                if skill_md_path.exists() {
                    if let Ok(content) = fs::read_to_string(&skill_md_path).await {
                        if let Some(skill) = parse_openclaw_skill(&content) {
                            print_info(&format!("Found skill: {}", skill.name));
                            agent.skills.push(skill);
                        }
                    }
                }
            }
        }
    }

    let check = |b: bool| {
        if b {
            style("found").green().to_string()
        } else {
            style("not found").dim().to_string()
        }
    };
    terminal::GuideSection::new("Migration Summary")
        .bullet(&format!(
            "SOUL.md:        {}",
            check(agent.soul_md.is_some())
        ))
        .bullet(&format!(
            "AGENTS.md:      {}",
            check(agent.agents_md.is_some())
        ))
        .bullet(&format!(
            "MEMORY.md:      {}",
            check(agent.memory_md.is_some())
        ))
        .bullet(&format!(
            "Daily memories: {}",
            style(agent.daily_memories.len()).cyan()
        ))
        .bullet(&format!(
            "Skills:         {}",
            style(agent.skills.len()).cyan()
        ))
        .print();

    if agent.soul_md.is_none() && agent.agents_md.is_none() && agent.skills.is_empty() {
        print_error("No migratable content found in OpenClaw workspace.");
        return Ok(());
    }

    GuideSection::new("Migration · Target Agent")
        .text("Choose the name of the Moxxy agent to migrate content into.")
        .text("Use 'default' for the primary agent, or pick a custom name.")
        .open();

    let target_agent = inquire::Text::new("Target agent name:")
        .with_default("default")
        .with_help_message("Name for the new Moxxy agent")
        .with_render_config(bordered_render_config())
        .prompt()?;
    guide_bar();
    close_section();

    GuideSection::new("Migration · Content Selection")
        .text("Choose what to migrate from your OpenClaw installation.")
        .open();

    let include_skills = if !agent.skills.is_empty() {
        inquire::Confirm::new("Migrate skills?")
            .with_default(true)
            .with_help_message("Convert OpenClaw skills to Moxxy format")
            .with_render_config(bordered_render_config())
            .prompt()?
    } else {
        false
    };

    let include_memory = if agent.memory_md.is_some() || !agent.daily_memories.is_empty() {
        inquire::Confirm::new("Migrate memory files?")
            .with_default(true)
            .with_help_message("Import MEMORY.md and daily memory files")
            .with_render_config(bordered_render_config())
            .prompt()?
    } else {
        false
    };

    let (heartbeat_scan, llm_scan) = scan_openclaw_config(&openclaw_path).await;
    let include_heartbeat = heartbeat_scan.is_some()
        && inquire::Confirm::new("Migrate heartbeat as scheduled job?")
            .with_default(true)
            .with_help_message("Convert OpenClaw heartbeat to moxxy cron schedule")
            .with_render_config(bordered_render_config())
            .prompt()?;
    let include_llm = llm_scan.is_some()
        && inquire::Confirm::new("Migrate LLM provider and API keys?")
            .with_default(true)
            .with_help_message("Import primary model and API keys to vault")
            .with_render_config(bordered_render_config())
            .prompt()?;
    guide_bar();
    close_section();

    print_step("Creating migration plan...");

    let persona_content = build_persona_md(&agent);
    let mut skill_conversions = Vec::new();

    if include_skills {
        for skill in &agent.skills {
            skill_conversions.push(convert_skill_to_moxxy(skill));
        }
    }

    let mut memory_entries = Vec::new();
    if include_memory {
        if let Some(ref mem) = agent.memory_md {
            memory_entries.push(format!("# Long-term Memory\n\n{}", mem));
        }
        for (filename, content) in &agent.daily_memories {
            memory_entries.push(format!("# Daily Memory: {}\n\n{}", filename, content));
        }
    }

    let heartbeat_schedule = if include_heartbeat {
        heartbeat_scan
    } else {
        None
    };
    let llm_migration = if include_llm { llm_scan } else { None };

    let plan = MigrationPlan {
        target_agent: target_agent.clone(),
        persona_content,
        skills: skill_conversions,
        memory_entries,
        heartbeat_schedule,
        llm_migration,
    };

    let mut will_create = terminal::GuideSection::new("Will Create")
        .bullet(&format!("~/.moxxy/agents/{}/persona.md", target_agent));
    for skill in &plan.skills {
        will_create = will_create.bullet(&format!(
            "~/.moxxy/agents/{}/skills/{}/",
            target_agent, skill.skill_name
        ));
    }
    if !plan.memory_entries.is_empty() {
        will_create = will_create.bullet("Memory entries will be imported to STM");
    }
    if plan.heartbeat_schedule.is_some() {
        will_create = will_create.bullet("Heartbeat will be created as scheduled job");
    }
    if plan.llm_migration.is_some() {
        will_create =
            will_create.bullet("LLM provider/model and API keys will be migrated to vault");
    }
    will_create.open();

    let proceed = inquire::Confirm::new("Proceed with migration?")
        .with_default(true)
        .with_render_config(bordered_render_config())
        .prompt()?;
    guide_bar();
    close_section();

    if !proceed {
        print_info("Migration cancelled.");
        return Ok(());
    }

    print_step("Executing migration...");
    execute_migration(&plan).await?;

    print_success(&format!(
        "Migration complete! Agent '{}' is ready.",
        target_agent
    ));
    let mut next = terminal::GuideSection::new("Next Steps");
    let mut n = 1;
    if plan.llm_migration.is_none() {
        next = next.numbered(
            n,
            &format!(
                "Run {} to configure LLM provider",
                style("moxxy init").cyan()
            ),
        );
        n += 1;
    }
    next = next
        .numbered(
            n,
            &format!(
                "Run {} to start the daemon",
                style("moxxy gateway start").cyan()
            ),
        )
        .numbered(
            n + 1,
            &format!("Run {} to access the dashboard", style("moxxy web").cyan()),
        );
    next.print();
    println!();

    Ok(())
}

fn parse_openclaw_skill(content: &str) -> Option<OpenclawSkill> {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return None;
    }

    let after_first = &trimmed[3..];
    let end_idx = after_first.find("\n---")?;
    let yaml_str = &after_first[..end_idx];

    let frontmatter: serde_yaml::Value = serde_yaml::from_str(yaml_str).ok()?;

    let name = frontmatter
        .get("name")
        .and_then(|v| v.as_str())
        .map(String::from)?;

    let description = frontmatter
        .get("description")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("Migrated from OpenClaw: {}", name));

    let version = frontmatter
        .get("version")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| "1.0.0".to_string());

    let homepage = frontmatter
        .get("homepage")
        .and_then(|v| v.as_str())
        .map(String::from);

    Some(OpenclawSkill {
        name,
        description,
        version,
        homepage,
        skill_md: content.to_string(),
    })
}

/// Sections to strip from migrated persona (OC-specific, not applicable to moxxy).
/// Matching is case-insensitive; headings are normalized (emoji/symbols stripped).
const PERSONA_SECTIONS_TO_STRIP: &[&str] = &[
    "First Run",
    "Every Session",
    "Memory",
    "MEMORY.md - Your Long-Term Memory",
    "Write It Down",
    "Write It Down - No Mental Notes",
    "Heartbeats",
    "Heartbeats - Be Proactive",
    "Heartbeat vs Cron",
    "Memory Maintenance (During Heartbeats)",
    "Know When to Speak",
];

fn normalize_heading_for_match(line: &str) -> String {
    let heading = line.trim_start_matches('#').trim();
    heading
        .chars()
        .filter(|c| {
            c.is_alphanumeric()
                || c.is_whitespace()
                || *c == '.'
                || *c == '-'
                || *c == '('
                || *c == ')'
        })
        .collect::<String>()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn heading_matches_skip(line: &str) -> bool {
    let normalized = normalize_heading_for_match(line);
    for s in PERSONA_SECTIONS_TO_STRIP {
        let target = s.to_lowercase();
        if normalized == target
            || normalized.starts_with(&target)
            || target.starts_with(&normalized)
        {
            return true;
        }
    }
    false
}

/// Transform OpenClaw persona content for moxxy: strip OC-specific sections, rewrite metadata.
fn transform_persona_for_moxxy(raw: &str) -> String {
    let mut result = String::new();
    let mut skip = false;
    let mut skip_level = 0u32;

    for line in raw.lines() {
        let heading_level = line.chars().take_while(|c| *c == '#').count() as u32;

        if heading_level > 0 {
            if skip {
                if heading_level <= skip_level {
                    skip = false;
                } else {
                    continue;
                }
            }
            if !skip && heading_matches_skip(line) {
                skip = true;
                skip_level = heading_level;
                continue;
            }
        }

        if !skip {
            result.push_str(line);
            result.push('\n');
        }
    }

    result
}

fn build_persona_md(agent: &OpenclawAgent) -> String {
    let mut raw = String::new();

    raw.push_str("# Agent Persona\n\n");

    if let Some(ref soul) = agent.soul_md {
        raw.push_str("## Core Identity\n\n");
        raw.push_str(soul);
        raw.push_str("\n\n");
    }

    if let Some(ref agents) = agent.agents_md {
        raw.push_str("## Workspace Guidelines\n\n");
        let filtered = filter_agents_md(agents);
        raw.push_str(&filtered);
        raw.push_str("\n");
    }

    transform_persona_for_moxxy(&raw)
}

fn filter_agents_md(content: &str) -> String {
    let sections_to_skip = ["## Skills", "### Skills", "## Tools", "### Tools"];

    let mut result = String::new();
    let mut skip = false;
    let mut skip_level = 0; // heading level that started the skip

    for line in content.lines() {
        if !skip {
            if let Some(s) = sections_to_skip.iter().find(|s| line.starts_with(**s)) {
                skip = true;
                skip_level = s.chars().take_while(|c| *c == '#').count();
                continue;
            }
        } else {
            // Stop skipping when we hit a heading at the same or higher level
            let heading_level = line.chars().take_while(|c| *c == '#').count();
            if heading_level > 0 && heading_level <= skip_level {
                skip = false;
            }
        }

        if !skip {
            result.push_str(line);
            result.push('\n');
        }
    }

    result
}

/// Convert OpenClaw duration string to 6-field cron (sec min hour day month dow).
fn duration_to_cron(duration: &str) -> Option<String> {
    let s = duration.trim().to_lowercase();
    if s.is_empty() || s == "0m" || s == "0h" {
        return None;
    }
    if s.ends_with('m') {
        let n: u32 = s.trim_end_matches('m').parse().ok()?;
        if n == 0 {
            return None;
        }
        return Some(format!("0 */{} * * * *", n.min(59)));
    }
    if s.ends_with('h') {
        let n: u32 = s.trim_end_matches('h').parse().ok()?;
        if n == 0 {
            return None;
        }
        return Some(format!("0 0 */{} * * *", n.min(23)));
    }
    None
}

fn provider_to_vault_key(provider: &str) -> String {
    let p = provider.to_lowercase();
    format!("{}_api_key", p.replace(['/', '.'], "_"))
}

/// Scan OpenClaw config for heartbeat and LLM settings.
async fn scan_openclaw_config(
    openclaw_path: &Path,
) -> (Option<(String, String)>, Option<OpenclawLlmConfig>) {
    let mut heartbeat = None;
    let mut llm = OpenclawLlmConfig::default();

    let config_path = openclaw_path.join("openclaw.json");
    let config_content = match fs::read_to_string(&config_path).await {
        Ok(c) => c,
        Err(_) => return (heartbeat, None),
    };

    let config: serde_json::Value = match json5::from_str(&config_content) {
        Ok(c) => c,
        Err(_) => return (heartbeat, None),
    };

    // Heartbeat: agents.defaults.heartbeat.every, optional prompt
    let heartbeat_every = config
        .get("agents")
        .and_then(|a| a.get("defaults"))
        .and_then(|d| d.get("heartbeat"))
        .and_then(|h| h.get("every"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            config
                .get("heartbeat")
                .and_then(|h| h.get("every"))
                .and_then(|v| v.as_str())
        });

    if let Some(every) = heartbeat_every {
        if let Some(cron) = duration_to_cron(every) {
            let custom_prompt = config
                .get("agents")
                .and_then(|a| a.get("defaults"))
                .and_then(|d| d.get("heartbeat"))
                .and_then(|h| h.get("prompt"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());
            let prompt = if let Some(cp) = custom_prompt {
                cp.to_string()
            } else {
                let workspace = openclaw_path.join("workspace");
                let heartbeat_md = workspace.join("HEARTBEAT.md");
                if heartbeat_md.exists() {
                    let content = fs::read_to_string(&heartbeat_md)
                        .await
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    if !content.is_empty() {
                        content
                    } else {
                        "Proactively check for anything needing attention (inbox, calendar, notifications). If nothing needs attention, respond briefly.".to_string()
                    }
                } else {
                    "Proactively check for anything needing attention (inbox, calendar, notifications). If nothing needs attention, respond briefly.".to_string()
                }
            };
            if !prompt.is_empty() {
                heartbeat = Some((cron, prompt));
            }
        }
    }

    // Primary model: agent.model.primary or agents.defaults.model.primary
    let primary = config
        .get("agent")
        .and_then(|a| a.get("model"))
        .and_then(|m| m.as_str())
        .or_else(|| {
            config
                .get("agents")
                .and_then(|a| a.get("defaults"))
                .and_then(|d| d.get("model"))
                .and_then(|m| m.get("primary"))
                .and_then(|v| v.as_str())
        });

    if let Some(ref_str) = primary {
        let parts: Vec<&str> = ref_str.splitn(2, '/').collect();
        if parts.len() == 2 {
            llm.primary_provider = Some(parts[0].to_lowercase());
            llm.primary_model = Some(parts[1].to_string());
        }
    }

    // API keys: auth-profiles.json first
    let agents_dir = openclaw_path.join("agents");
    if agents_dir.exists() {
        if let Ok(mut entries) = fs::read_dir(&agents_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let auth_path = entry.path().join("agent").join("auth-profiles.json");
                if auth_path.exists() {
                    if let Ok(content) = fs::read_to_string(&auth_path).await {
                        if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(profiles) = auth.get("profiles").and_then(|p| p.as_object())
                            {
                                for (_, profile) in profiles {
                                    if profile.get("type").and_then(|t| t.as_str())
                                        == Some("api_key")
                                        && let Some(provider) =
                                            profile.get("provider").and_then(|p| p.as_str())
                                        && let Some(key) =
                                            profile.get("key").and_then(|k| k.as_str())
                                    {
                                        let vault_key = provider_to_vault_key(provider);
                                        if !key.is_empty() {
                                            llm.api_keys.insert(vault_key, key.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // models.providers.*.apiKey (literal or ${ENV})
    if let Some(providers) = config
        .get("models")
        .and_then(|m| m.get("providers"))
        .and_then(|p| p.as_object())
    {
        for (prov_id, prov) in providers {
            if let Some(api_key_val) = prov.get("apiKey").or_else(|| prov.get("api_key")) {
                let key_str = api_key_val.as_str().unwrap_or_default();
                if key_str.starts_with("${") && key_str.ends_with('}') {
                    let var = &key_str[2..key_str.len() - 1];
                    if let Ok(val) = std::env::var(var) {
                        llm.api_keys.insert(provider_to_vault_key(prov_id), val);
                    }
                } else if !key_str.is_empty() && !key_str.starts_with('$') {
                    llm.api_keys
                        .insert(provider_to_vault_key(prov_id), key_str.to_string());
                }
            }
        }
    }

    // env.OPENROUTER_API_KEY etc
    if let Some(env_obj) = config.get("env") {
        let mapping = [
            ("OPENROUTER_API_KEY", "openrouter_api_key"),
            ("ANTHROPIC_API_KEY", "anthropic_api_key"),
            ("OPENAI_API_KEY", "openai_api_key"),
            ("GOOGLE_API_KEY", "google_api_key"),
        ];
        for (env_var, vault_key) in mapping {
            if let Some(v) = env_obj.get(env_var).and_then(|x| x.as_str()) {
                if !v.is_empty() {
                    llm.api_keys.insert(vault_key.to_string(), v.to_string());
                }
            }
        }
        if let Some(vars) = env_obj.get("vars").and_then(|v| v.as_object()) {
            let mapping = [
                ("GROQ_API_KEY", "groq_api_key"),
                ("XAI_API_KEY", "xai_api_key"),
                ("DEEPSEEK_API_KEY", "deepseek_api_key"),
                ("MISTRAL_API_KEY", "mistral_api_key"),
                ("ZAI_API_KEY", "zai_api_key"),
                ("MINIMAX_API_KEY", "minimax_api_key"),
            ];
            for (env_key, vault_key) in mapping {
                if let Some(v) = vars.get(env_key).and_then(|x| x.as_str()) {
                    if !v.is_empty() {
                        llm.api_keys.insert(vault_key.to_string(), v.to_string());
                    }
                }
            }
        }
    }

    // ~/.openclaw/.env
    let env_path = openclaw_path.join(".env");
    if env_path.exists() {
        if let Ok(content) = fs::read_to_string(&env_path).await {
            for line in content.lines() {
                let line = line.trim();
                if line.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    let k = k.trim().strip_prefix("export ").unwrap_or(k).trim();
                    let v = v.trim().trim_matches('"').trim_matches('\'');
                    let mapping = [
                        ("ANTHROPIC_API_KEY", "anthropic_api_key"),
                        ("OPENAI_API_KEY", "openai_api_key"),
                        ("GOOGLE_API_KEY", "google_api_key"),
                        ("OPENROUTER_API_KEY", "openrouter_api_key"),
                        ("ZAI_API_KEY", "zai_api_key"),
                        ("DEEPSEEK_API_KEY", "deepseek_api_key"),
                        ("MISTRAL_API_KEY", "mistral_api_key"),
                        ("MINIMAX_API_KEY", "minimax_api_key"),
                    ];
                    for (env_key, vault_key) in mapping {
                        if k == env_key && !v.is_empty() {
                            llm.api_keys.insert(vault_key.to_string(), v.to_string());
                            break;
                        }
                    }
                }
            }
        }
    }

    let has_llm = llm.primary_provider.is_some() || !llm.api_keys.is_empty();
    let llm_opt = if has_llm { Some(llm) } else { None };

    (heartbeat, llm_opt)
}

fn convert_skill_to_moxxy(skill: &OpenclawSkill) -> SkillConversion {
    let escaped_name = skill.name.replace('\\', "\\\\").replace('"', "\\\"");
    let escaped_desc = skill.description.replace('\\', "\\\\").replace('"', "\\\"");
    let manifest_toml = format!(
        r#"name = "{}"
description = "{}"
version = "{}"
executor_type = "openclaw"
needs_network = true
needs_fs_read = false
needs_fs_write = false
needs_env = false
entrypoint = "skill.md"
run_command = ""
{}
"#,
        escaped_name,
        escaped_desc,
        skill.version,
        skill
            .homepage
            .as_ref()
            .map(|h| format!(
                "homepage = \"{}\"",
                h.replace('\\', "\\\\").replace('"', "\\\"")
            ))
            .unwrap_or_default()
    );

    let run_sh = format!(
        r#"#!/bin/sh
# OpenClaw skill wrapper for {}
# This skill is documentation-only and executed via the openclaw executor type.
# The agent reads skill.md and follows its instructions.

echo "OpenClaw skill: {}"
echo "This is a documentation-only skill. See skill.md for usage."
"#,
        skill.name, skill.name
    );

    SkillConversion {
        manifest_toml,
        run_sh,
        skill_md: skill.skill_md.clone(),
        skill_name: skill.name.clone(),
    }
}

async fn execute_migration(plan: &MigrationPlan) -> Result<()> {
    use crate::platform::{NativePlatform, Platform};
    let moxxy_dir = NativePlatform::data_dir();
    let agent_dir = moxxy_dir.join("agents").join(&plan.target_agent);

    fs::create_dir_all(&agent_dir).await?;
    fs::create_dir_all(agent_dir.join("skills")).await?;
    fs::create_dir_all(agent_dir.join("workspace")).await?;

    NativePlatform::restrict_dir_permissions(&moxxy_dir);
    NativePlatform::restrict_dir_permissions(&agent_dir);

    let persona_path = agent_dir.join("persona.md");
    fs::write(&persona_path, &plan.persona_content)
        .await
        .with_context(|| format!("Failed to write persona.md to {:?}", persona_path))?;

    for skill_conv in &plan.skills {
        let skill_dir = agent_dir.join("skills").join(&skill_conv.skill_name);
        fs::create_dir_all(&skill_dir).await?;

        fs::write(skill_dir.join("manifest.toml"), &skill_conv.manifest_toml).await?;
        let run_sh_path = skill_dir.join("run.sh");
        fs::write(&run_sh_path, &skill_conv.run_sh).await?;
        NativePlatform::set_executable(&run_sh_path);
        fs::write(skill_dir.join("skill.md"), &skill_conv.skill_md).await?;
    }

    // Initialize memory database and vault for the new agent
    let memory_sys = crate::core::memory::MemorySystem::new(&agent_dir).await?;
    let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
    vault.initialize().await?;

    if !plan.memory_entries.is_empty() {
        let db = memory_sys.get_db();
        for entry in &plan.memory_entries {
            let db_guard = db.lock().await;
            db_guard.execute(
                "INSERT INTO short_term_memory (session_id, role, content) VALUES (?1, ?2, ?3)",
                rusqlite::params!["migrated", "system", entry],
            )?;
        }
    }

    if let Some((ref cron, ref prompt)) = plan.heartbeat_schedule {
        let _ = memory_sys
            .add_scheduled_job("openclaw_heartbeat", cron, prompt, "openclaw_migrate")
            .await;
    }

    if let Some(ref llm) = plan.llm_migration {
        if let (Some(provider), Some(model)) = (&llm.primary_provider, &llm.primary_model) {
            let _ = vault.set_secret("llm_default_provider", provider).await;
            let _ = vault.set_secret("llm_default_model", model).await;
        }
        for (key, value) in &llm.api_keys {
            let _ = vault.set_secret(key, value).await;
        }
    }

    Ok(())
}

pub fn check_openclaw_installation() -> Option<PathBuf> {
    let home = dirs::home_dir().expect("Could not find home directory");
    let openclaw_path = home.join(OPENCLAW_DIR);

    if openclaw_path.exists() {
        let workspace = openclaw_path.join("workspace");
        if workspace.exists() {
            return Some(openclaw_path);
        }
    }
    None
}

pub fn has_migratable_content(openclaw_path: &Path) -> bool {
    let workspace = openclaw_path.join("workspace");

    workspace.join("SOUL.md").exists()
        || workspace.join("AGENTS.md").exists()
        || workspace.join("MEMORY.md").exists()
        || workspace.join("skills").exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transform_persona_strips_oc_sections() {
        let input = r#"## Core Identity
## First Run
Skip this section
## Every Session
Also skip
## Memory
File-based memory
### MEMORY.md - Your Long-Term Memory
Nested skip
## Heartbeats - Be Proactive!
HEARTBEAT_OK stuff
## Safety
Keep this
"#;
        let out = transform_persona_for_moxxy(input);
        assert!(!out.contains("First Run"));
        assert!(!out.contains("Every Session"));
        assert!(!out.contains("MEMORY.md"));
        assert!(!out.contains("Heartbeats"));
        assert!(!out.contains("HEARTBEAT_OK"));
        assert!(out.contains("Safety"));
        assert!(out.contains("Core Identity"));
    }

    // --- duration_to_cron ---

    #[test]
    fn duration_to_cron_minutes() {
        assert_eq!(duration_to_cron("15m"), Some("0 */15 * * * *".to_string()));
        assert_eq!(duration_to_cron("1m"), Some("0 */1 * * * *".to_string()));
    }

    #[test]
    fn duration_to_cron_hours() {
        assert_eq!(duration_to_cron("2h"), Some("0 0 */2 * * *".to_string()));
        assert_eq!(duration_to_cron("1h"), Some("0 0 */1 * * *".to_string()));
    }

    #[test]
    fn duration_to_cron_clamps_extremes() {
        assert_eq!(duration_to_cron("120m"), Some("0 */59 * * * *".to_string()));
        assert_eq!(duration_to_cron("48h"), Some("0 0 */23 * * *".to_string()));
    }

    #[test]
    fn duration_to_cron_rejects_zero() {
        assert_eq!(duration_to_cron("0m"), None);
        assert_eq!(duration_to_cron("0h"), None);
    }

    #[test]
    fn duration_to_cron_rejects_invalid() {
        assert_eq!(duration_to_cron(""), None);
        assert_eq!(duration_to_cron("abc"), None);
        assert_eq!(duration_to_cron("15s"), None);
    }

    #[test]
    fn duration_to_cron_case_insensitive() {
        assert_eq!(duration_to_cron("15M"), Some("0 */15 * * * *".to_string()));
        assert_eq!(duration_to_cron("2H"), Some("0 0 */2 * * *".to_string()));
    }

    // --- parse_openclaw_skill ---

    #[test]
    fn parse_openclaw_skill_valid_frontmatter() {
        let content =
            "---\nname: my_skill\ndescription: Does things\nversion: 2.0.0\n---\n# Skill body";
        let skill = parse_openclaw_skill(content).unwrap();
        assert_eq!(skill.name, "my_skill");
        assert_eq!(skill.description, "Does things");
        assert_eq!(skill.version, "2.0.0");
        assert!(skill.homepage.is_none());
        assert_eq!(skill.skill_md, content);
    }

    #[test]
    fn parse_openclaw_skill_with_homepage() {
        let content = "---\nname: web_skill\ndescription: Web stuff\nversion: 1.0.0\nhomepage: https://example.com\n---\nbody";
        let skill = parse_openclaw_skill(content).unwrap();
        assert_eq!(skill.homepage, Some("https://example.com".to_string()));
    }

    #[test]
    fn parse_openclaw_skill_missing_name_returns_none() {
        let content = "---\ndescription: No name\nversion: 1.0.0\n---\nbody";
        assert!(parse_openclaw_skill(content).is_none());
    }

    #[test]
    fn parse_openclaw_skill_no_frontmatter_returns_none() {
        assert!(parse_openclaw_skill("Just plain text").is_none());
    }

    #[test]
    fn parse_openclaw_skill_defaults_description_and_version() {
        let content = "---\nname: minimal\n---\nbody";
        let skill = parse_openclaw_skill(content).unwrap();
        assert!(skill.description.contains("minimal"));
        assert_eq!(skill.version, "1.0.0");
    }

    // --- provider_to_vault_key ---

    #[test]
    fn provider_to_vault_key_normalizes() {
        assert_eq!(provider_to_vault_key("OpenAI"), "openai_api_key");
        assert_eq!(
            provider_to_vault_key("openrouter/anthropic"),
            "openrouter_anthropic_api_key"
        );
        assert_eq!(provider_to_vault_key("z.ai"), "z_ai_api_key");
    }

    // --- filter_agents_md ---

    #[test]
    fn filter_agents_md_strips_skills_section() {
        let input = "## Intro\nKeep this\n## Skills\n- skill1\n- skill2\n## Other\nAlso keep";
        let out = filter_agents_md(input);
        assert!(out.contains("Intro"));
        assert!(out.contains("Other"));
        assert!(!out.contains("skill1"));
        assert!(!out.contains("skill2"));
    }

    #[test]
    fn filter_agents_md_strips_tools_section() {
        let input = "## Setup\nSetup text\n### Tools\nTool list\n## Config\nConfig text";
        let out = filter_agents_md(input);
        assert!(out.contains("Setup text"));
        assert!(!out.contains("Tool list"));
        assert!(out.contains("Config text"));
    }

    #[test]
    fn filter_agents_md_preserves_everything_when_no_skip_sections() {
        let input = "## Overview\nAll content\n## Guidelines\nMore content";
        let out = filter_agents_md(input);
        assert!(out.contains("Overview"));
        assert!(out.contains("All content"));
        assert!(out.contains("More content"));
    }

    // --- convert_skill_to_moxxy ---

    #[test]
    fn convert_skill_to_moxxy_generates_valid_manifest() {
        let skill = OpenclawSkill {
            name: "test_skill".to_string(),
            description: "A test skill".to_string(),
            version: "1.2.3".to_string(),
            homepage: Some("https://example.com".to_string()),
            skill_md: "# Test\nBody".to_string(),
        };
        let conv = convert_skill_to_moxxy(&skill);
        assert_eq!(conv.skill_name, "test_skill");
        assert!(conv.manifest_toml.contains("name = \"test_skill\""));
        assert!(conv.manifest_toml.contains("version = \"1.2.3\""));
        assert!(conv.manifest_toml.contains("executor_type = \"openclaw\""));
        assert!(
            conv.manifest_toml
                .contains("homepage = \"https://example.com\"")
        );
        assert!(conv.run_sh.contains("#!/bin/sh"));
        assert_eq!(conv.skill_md, "# Test\nBody");
    }

    #[test]
    fn convert_skill_to_moxxy_escapes_quotes() {
        let skill = OpenclawSkill {
            name: "has\"quotes".to_string(),
            description: "desc with \"quotes\"".to_string(),
            version: "1.0.0".to_string(),
            homepage: None,
            skill_md: "body".to_string(),
        };
        let conv = convert_skill_to_moxxy(&skill);
        assert!(conv.manifest_toml.contains(r#"has\"quotes"#));
        assert!(conv.manifest_toml.contains(r#"desc with \"quotes\""#));
    }

    // --- build_persona_md ---

    #[test]
    fn build_persona_md_includes_soul_and_agents() {
        let agent = OpenclawAgent {
            soul_md: Some("I am a helpful assistant.".to_string()),
            agents_md: Some("## Guidelines\nBe nice".to_string()),
            memory_md: None,
            daily_memories: vec![],
            skills: vec![],
        };
        let persona = build_persona_md(&agent);
        assert!(persona.contains("Core Identity"));
        assert!(persona.contains("helpful assistant"));
        assert!(persona.contains("Be nice"));
    }

    #[test]
    fn build_persona_md_handles_empty_agent() {
        let agent = OpenclawAgent {
            soul_md: None,
            agents_md: None,
            memory_md: None,
            daily_memories: vec![],
            skills: vec![],
        };
        let persona = build_persona_md(&agent);
        assert!(persona.contains("Agent Persona"));
    }

    // --- heading_matches_skip ---

    #[test]
    fn heading_matches_skip_detects_known_sections() {
        assert!(heading_matches_skip("## First Run"));
        assert!(heading_matches_skip("### Every Session"));
        assert!(heading_matches_skip("## 🧠 Memory"));
        assert!(heading_matches_skip("## Heartbeats - Be Proactive!"));
    }

    #[test]
    fn heading_matches_skip_allows_unknown_sections() {
        assert!(!heading_matches_skip("## Safety"));
        assert!(!heading_matches_skip("## Core Identity"));
        assert!(!heading_matches_skip("## Custom Section"));
    }

    // --- normalize_heading_for_match ---

    #[test]
    fn normalize_heading_strips_markdown_and_emoji() {
        assert_eq!(normalize_heading_for_match("### 🧠 Memory"), "memory");
        assert_eq!(normalize_heading_for_match("## ✅ First Run"), "first run");
    }
}
