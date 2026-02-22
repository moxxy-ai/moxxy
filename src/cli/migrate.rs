use anyhow::{Context, Result};
use console::style;
use std::path::{Path, PathBuf};
use tokio::fs;

use crate::core::terminal::{print_error, print_info, print_step, print_success};

const OPENCLAW_DIR: &str = ".openclaw";
const MOXXY_DIR: &str = ".moxxy";

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

#[derive(Debug, Clone)]
pub struct MigrationPlan {
    pub target_agent: String,
    pub persona_content: String,
    pub skills: Vec<SkillConversion>,
    pub memory_entries: Vec<String>,
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

    println!();
    println!("{}", style("Migration Summary:").bold());
    println!(
        "  • SOUL.md: {}",
        if agent.soul_md.is_some() {
            "✓"
        } else {
            "✗"
        }
    );
    println!(
        "  • AGENTS.md: {}",
        if agent.agents_md.is_some() {
            "✓"
        } else {
            "✗"
        }
    );
    println!(
        "  • MEMORY.md: {}",
        if agent.memory_md.is_some() {
            "✓"
        } else {
            "✗"
        }
    );
    println!("  • Daily memories: {}", agent.daily_memories.len());
    println!("  • Skills: {}", agent.skills.len());
    println!();

    if agent.soul_md.is_none() && agent.agents_md.is_none() && agent.skills.is_empty() {
        print_error("No migratable content found in OpenClaw workspace.");
        return Ok(());
    }

    let target_agent = inquire::Text::new("Target agent name:")
        .with_default("default")
        .with_help_message("Name for the new Moxxy agent")
        .prompt()?;

    let include_skills = if !agent.skills.is_empty() {
        inquire::Confirm::new("Migrate skills?")
            .with_default(true)
            .with_help_message("Convert OpenClaw skills to Moxxy format")
            .prompt()?
    } else {
        false
    };

    let include_memory = if agent.memory_md.is_some() || !agent.daily_memories.is_empty() {
        inquire::Confirm::new("Migrate memory files?")
            .with_default(true)
            .with_help_message("Import MEMORY.md and daily memory files")
            .prompt()?
    } else {
        false
    };

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

    let plan = MigrationPlan {
        target_agent: target_agent.clone(),
        persona_content,
        skills: skill_conversions,
        memory_entries,
    };

    println!();
    println!("{}", style("Will create:").bold());
    println!("  • ~/.moxxy/agents/{}/persona.md", target_agent);
    for skill in &plan.skills {
        println!(
            "  • ~/.moxxy/agents/{}/skills/{}/",
            target_agent, skill.skill_name
        );
    }
    if !plan.memory_entries.is_empty() {
        println!("  • Memory entries will be imported to STM");
    }
    println!();

    let proceed = inquire::Confirm::new("Proceed with migration?")
        .with_default(true)
        .prompt()?;

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
    println!();
    println!("{}", style("Next steps:").bold());
    println!("  1. Run 'moxxy init' to configure LLM provider");
    println!("  2. Run 'moxxy gateway start' to start the daemon");
    println!("  3. Run 'moxxy web' to access the dashboard");
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

fn build_persona_md(agent: &OpenclawAgent) -> String {
    let mut persona = String::new();

    persona.push_str("# Agent Persona\n\n");
    persona.push_str("_Migrated from OpenClaw_\n\n");

    if let Some(ref soul) = agent.soul_md {
        persona.push_str("## Core Identity (from SOUL.md)\n\n");
        persona.push_str(soul);
        persona.push_str("\n\n");
    }

    if let Some(ref agents) = agent.agents_md {
        persona.push_str("## Workspace Guidelines (from AGENTS.md)\n\n");
        let filtered = filter_agents_md(agents);
        persona.push_str(&filtered);
        persona.push_str("\n");
    }

    persona
}

fn filter_agents_md(content: &str) -> String {
    let sections_to_skip = ["## Skills", "### Skills", "## Tools", "### Tools"];

    let mut result = String::new();
    let mut skip = false;

    for line in content.lines() {
        if sections_to_skip.iter().any(|s| line.starts_with(s)) {
            skip = true;
            continue;
        }

        if line.starts_with("## ") && skip {
            skip = false;
        }

        if !skip {
            result.push_str(line);
            result.push('\n');
        }
    }

    result
}

fn convert_skill_to_moxxy(skill: &OpenclawSkill) -> SkillConversion {
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
        skill.name,
        skill.description,
        skill.version,
        skill
            .homepage
            .as_ref()
            .map(|h| format!("homepage = \"{}\"", h))
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
    let home = dirs::home_dir().expect("Could not find home directory");
    let agent_dir = home.join(MOXXY_DIR).join("agents").join(&plan.target_agent);

    fs::create_dir_all(&agent_dir).await?;
    fs::create_dir_all(agent_dir.join("skills")).await?;

    let persona_path = agent_dir.join("persona.md");
    fs::write(&persona_path, &plan.persona_content)
        .await
        .with_context(|| format!("Failed to write persona.md to {:?}", persona_path))?;

    for skill_conv in &plan.skills {
        let skill_dir = agent_dir.join("skills").join(&skill_conv.skill_name);
        fs::create_dir_all(&skill_dir).await?;

        fs::write(skill_dir.join("manifest.toml"), &skill_conv.manifest_toml).await?;
        fs::write(skill_dir.join("run.sh"), &skill_conv.run_sh).await?;
        fs::write(skill_dir.join("skill.md"), &skill_conv.skill_md).await?;
    }

    if !plan.memory_entries.is_empty() {
        let memory_sys = crate::core::memory::MemorySystem::new(&agent_dir).await?;
        let db = memory_sys.get_db();

        for entry in &plan.memory_entries {
            let db_guard = db.lock().await;
            db_guard.execute(
                "INSERT INTO short_term_memory (session_id, role, content) VALUES (?1, ?2, ?3)",
                rusqlite::params!["migrated", "system", entry],
            )?;
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
