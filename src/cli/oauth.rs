use anyhow::{Result, anyhow};
use console::style;
use std::path::PathBuf;

use crate::core::oauth;
use crate::core::terminal::{GuideSection, close_section, guide_bar, print_error, print_step};

fn get_agents_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".moxxy").join("agents")
}

pub async fn run_oauth_command(args: &[String]) -> Result<()> {
    let sub_cmd = if args.len() > 2 { args[2].as_str() } else { "" };

    if sub_cmd == "--help" || sub_cmd == "-h" {
        print_help();
        return Ok(());
    }

    let mut agent_arg: Option<String> = None;
    let mut client_id_arg: Option<String> = None;
    let mut client_secret_arg: Option<String> = None;
    let mut show_help = false;

    let mut i = 3;
    while i < args.len() {
        match args[i].as_str() {
            "--help" | "-h" => {
                show_help = true;
                i += 1;
            }
            "--agent" | "-a" => {
                if i + 1 < args.len() {
                    agent_arg = Some(args[i + 1].clone());
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--client-id" => {
                if i + 1 < args.len() {
                    client_id_arg = Some(args[i + 1].clone());
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--client-secret" => {
                if i + 1 < args.len() {
                    client_secret_arg = Some(args[i + 1].clone());
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }

    if show_help {
        print_help();
        return Ok(());
    }

    match sub_cmd {
        "list" => run_oauth_list().await,
        skill_name if !skill_name.is_empty() => {
            run_oauth_flow(skill_name, agent_arg, client_id_arg, client_secret_arg).await
        }
        _ => {
            print_error("Missing skill name or subcommand.");
            println!();
            print_help();
            Ok(())
        }
    }
}

fn print_help() {
    GuideSection::new("moxxy oauth")
        .command("<skill>", "Run OAuth for a specific skill")
        .command("list", "List skills with OAuth support")
        .blank()
        .text("--agent, -a <name>        Target agent (default: \"default\")")
        .text("--client-id <id>          OAuth client ID")
        .text("--client-secret <secret>  OAuth client secret")
        .text("--help, -h                Show this help message")
        .blank()
        .hint("moxxy oauth google_workspace", "")
        .hint("moxxy oauth list", "")
        .print();
    println!();
}

pub async fn run_oauth_list() -> Result<()> {
    let agents_dir = get_agents_dir();
    let skills = oauth::discover_oauth_skills(&agents_dir).await?;

    if skills.is_empty() {
        GuideSection::new("Skills with OAuth Support")
            .text("No skills with OAuth configuration found.")
            .blank()
            .text("Skills can declare OAuth support by adding an [oauth] section")
            .text("to their manifest.toml file.")
            .print();
        return Ok(());
    }

    println!(
        "\n  {:<25} {}",
        style("Skill").bold(),
        style("Auth URL").dim()
    );
    println!("  {}", "─".repeat(70));

    let mut skill_names: Vec<_> = skills.keys().collect();
    skill_names.sort();

    for name in skill_names {
        if let Some(skill) = skills.get(name) {
            let auth_host = skill.config.auth_url.split('/').nth(2).unwrap_or("unknown");
            println!("  {:<25} {}", name, auth_host);
        }
    }

    println!();
    println!(
        "  Run {} to start OAuth flow",
        style("moxxy oauth <skill_name>").cyan()
    );
    Ok(())
}

pub async fn run_oauth_flow(
    skill_name: &str,
    agent_arg: Option<String>,
    client_id_arg: Option<String>,
    client_secret_arg: Option<String>,
) -> Result<()> {
    let agents_dir = get_agents_dir();
    let oauth_skill = oauth::find_oauth_skill(&agents_dir, skill_name)
        .await?
        .ok_or_else(|| {
            anyhow!(
                "Skill '{}' not found or has no OAuth configuration",
                skill_name
            )
        })?;

    // --- Agent selection ---
    GuideSection::new(&format!("OAuth · {}", skill_name))
        .text("Select which agent's vault should store the OAuth credentials.")
        .open();

    let agent_name = match agent_arg {
        Some(name) => {
            println!("  Agent: {}", style(&name).cyan());
            name
        }
        None => inquire::Text::new("Agent name:")
            .with_default("default")
            .with_help_message("Which agent's vault should store the OAuth credentials?")
            .prompt()?,
    };
    guide_bar();
    close_section();

    let agent_dir = agents_dir.join(&agent_name);
    if !agent_dir.exists() {
        print_error(&format!("Agent '{}' does not exist.", agent_name));
        println!("  Run {} first.", style("moxxy init").cyan());
        return Ok(());
    }

    let memory_sys = crate::core::memory::MemorySystem::new(&agent_dir).await?;
    let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
    vault.initialize().await?;

    let existing_client_id = vault
        .get_secret(&oauth_skill.config.client_id_env)
        .await?
        .unwrap_or_default();

    // --- Client ID ---
    GuideSection::new("OAuth · Client ID")
        .text("The Client ID identifies your application to the OAuth provider.")
        .text("Find it in your OAuth provider's developer console.")
        .open();

    let client_id = match client_id_arg {
        Some(id) => id,
        None => {
            let prompt_text = if existing_client_id.is_empty() {
                "OAuth Client ID:".to_string()
            } else {
                format!(
                    "OAuth Client ID (current: {}***):",
                    &existing_client_id[..8.min(existing_client_id.len())]
                )
            };

            inquire::Text::new(&prompt_text)
                .with_default(&existing_client_id)
                .with_help_message("From your OAuth provider's developer console")
                .prompt()?
        }
    };
    guide_bar();
    close_section();

    // --- Client Secret ---
    GuideSection::new("OAuth · Client Secret")
        .text("The Client Secret authenticates your application.")
        .text("Keep this value secure - it is stored in the agent's encrypted vault.")
        .open();

    let client_secret = match client_secret_arg {
        Some(secret) => secret,
        None => inquire::Password::new("OAuth Client Secret:")
            .with_help_message("Hidden for security")
            .without_confirmation()
            .prompt()?,
    };
    guide_bar();
    close_section();

    print_step("Generating authorization URL...");

    let state = oauth::generate_state();
    let auth_url = oauth::build_auth_url(&oauth_skill.config, &client_id, &state);

    GuideSection::new("OAuth · Authorization")
        .numbered(1, "Open this URL in your browser:")
        .blank()
        .text(&format!("  {}", style(&auth_url).cyan()))
        .blank()
        .numbered(2, "Authorize the application")
        .numbered(3, "Copy the authorization code from the result page")
        .open();

    let auth_code = inquire::Text::new("4. Paste authorization code:")
        .with_help_message("The code parameter from the redirect URL or result page")
        .prompt()?;
    guide_bar();
    close_section();

    if auth_code.trim().is_empty() {
        print_error("Authorization code cannot be empty.");
        return Ok(());
    }

    print_step("Exchanging authorization code for tokens...");

    let refresh_token = oauth::exchange_code(
        &oauth_skill.config,
        &auth_code.trim(),
        &client_id,
        &client_secret,
    )
    .await?;

    print_step("Storing credentials in vault...");

    vault
        .set_secret(&oauth_skill.config.client_id_env, &client_id)
        .await?;
    vault
        .set_secret(&oauth_skill.config.client_secret_env, &client_secret)
        .await?;
    vault
        .set_secret(&oauth_skill.config.refresh_token_env, &refresh_token)
        .await?;

    GuideSection::new("OAuth · Complete")
        .success("OAuth credentials stored successfully!")
        .blank()
        .text("Stored in vault:")
        .bullet(&oauth_skill.config.client_id_env)
        .bullet(&oauth_skill.config.client_secret_env)
        .bullet(&oauth_skill.config.refresh_token_env)
        .blank()
        .text(&format!(
            "You can now use the {} skill with agent '{}'.",
            style(skill_name).cyan(),
            style(&agent_name).green()
        ))
        .print();

    Ok(())
}
