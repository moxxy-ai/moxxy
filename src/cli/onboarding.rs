use anyhow::Result;
use console::style;

use crate::core::llm::generic_provider::GenericProvider;
use crate::core::llm::registry::ProviderRegistry;
use crate::core::terminal::{self, print_error, print_info, print_step, print_success};

pub async fn run_onboarding() -> Result<()> {
    terminal::print_banner();

    // Ensure directories and vault exist (in case `moxxy install` wasn't run first)
    let home = dirs::home_dir().expect("Could not find home directory");
    let default_agent_dir = home.join(".moxxy").join("agents").join("default");

    if !default_agent_dir.exists() {
        tokio::fs::create_dir_all(default_agent_dir.join("skills")).await?;
        tokio::fs::create_dir_all(default_agent_dir.join("workspace")).await?;
        // Set restrictive permissions on agent directories
        {
            use crate::platform::{NativePlatform, Platform};
            NativePlatform::restrict_dir_permissions(&home.join(".moxxy"));
            NativePlatform::restrict_dir_permissions(&default_agent_dir);
        }
    }

    println!(
        "  {}\n",
        style("Welcome to the Onboarding Wizard. Let's set up your first autonomous agent.").bold()
    );

    if let Some(openclaw_path) = super::migrate::check_openclaw_installation() {
        if super::migrate::has_migratable_content(&openclaw_path) {
            println!(
                "  {} {}",
                style("ℹ").blue(),
                style("Detected OpenClaw installation with migratable content.").dim()
            );

            let migrate_now = inquire::Confirm::new("Would you like to migrate from OpenClaw?")
                .with_default(true)
                .with_help_message("Import your SOUL.md, AGENTS.md, skills, and memory")
                .prompt()?;

            if migrate_now {
                super::migrate::run_migration_wizard().await?;
                return Ok(());
            }
            println!();
        }
    }

    // Pre-step: Check and install required dependencies
    let deps_ok = super::doctor::ensure_dependencies().await?;
    if !deps_ok {
        let proceed = inquire::Confirm::new("Some dependencies are missing. Continue anyway?")
            .with_default(false)
            .prompt()?;
        if !proceed {
            print_error(
                "Onboarding aborted. Please install the missing dependencies and try again.",
            );
            return Ok(());
        }
    }

    let memory_sys = crate::core::memory::MemorySystem::new(&default_agent_dir).await?;
    let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
    vault.initialize().await?;

    // --- Step 1: LLM Provider (from registry) ---
    let registry = ProviderRegistry::load();
    let provider_names: Vec<&str> = registry.providers.iter().map(|p| p.name.as_str()).collect();
    let provider_choice = inquire::Select::new("Select your AI provider:", provider_names)
        .with_help_message("Use arrow keys to navigate, Enter to select")
        .prompt()?;

    let provider_def = registry
        .get_provider(provider_choice)
        .expect("Selected provider not found in registry");

    // --- Step 2: Model Selection ---
    let final_model = {
        let mut model_options: Vec<String> = provider_def
            .models
            .iter()
            .map(|m| format!("{} ({})", m.name, m.id))
            .collect();
        model_options.push("Custom model ID...".to_string());

        let default_idx = provider_def
            .models
            .iter()
            .position(|m| m.id == provider_def.default_model)
            .unwrap_or(0);

        let option_refs: Vec<&str> = model_options.iter().map(|s| s.as_str()).collect();
        let choice = inquire::Select::new("Select model:", option_refs)
            .with_starting_cursor(default_idx)
            .with_help_message("Use arrow keys to navigate, Enter to select")
            .prompt()?;

        if choice == "Custom model ID..." {
            inquire::Text::new("Enter custom model ID:")
                .with_help_message("e.g. claude-sonnet-4-6")
                .prompt()?
        } else {
            let idx = model_options.iter().position(|o| o == choice).unwrap();
            provider_def.models[idx].id.clone()
        }
    };

    // --- Step 3: API Key ---
    let llm_api_key = inquire::Password::new(&format!("API key for {}:", provider_def.name))
        .without_confirmation()
        .with_help_message("Your key is stored locally and never sent anywhere except the provider")
        .prompt()?;

    // Save LLM configuration
    vault
        .set_secret("llm_default_provider", &provider_def.id)
        .await?;
    vault.set_secret("llm_default_model", &final_model).await?;
    if !llm_api_key.is_empty() {
        vault
            .set_secret(&provider_def.auth.vault_key, &llm_api_key)
            .await?;
    }

    // --- Step 4: Telegram (optional) ---
    let connect_telegram = inquire::Confirm::new("Connect a Telegram bot?")
        .with_default(false)
        .with_help_message("You can always add this later")
        .prompt()?;

    if connect_telegram {
        let tg_token = inquire::Password::new("Telegram bot token:")
            .without_confirmation()
            .prompt()?;
        if !tg_token.is_empty() {
            vault.set_secret("telegram_token", &tg_token).await?;
            print_success("Telegram token saved.");
        }
    }

    // --- Step 5: Agent Persona ---
    let generate_persona = inquire::Confirm::new("Generate a custom AI persona for your agent?")
        .with_default(false)
        .with_help_message("Uses your LLM provider to create a tailored system prompt")
        .prompt()?;

    if generate_persona {
        let description = inquire::Text::new("Describe your ideal AI agent:")
            .with_help_message("e.g. 'A senior DevOps engineer who monitors my infra'")
            .prompt()?;

        if !description.is_empty() {
            print_step("Generating persona...");
            let mut llm_sys = crate::core::llm::LlmManager::new();

            llm_sys.register_provider(Box::new(GenericProvider::new(
                provider_def.clone(),
                llm_api_key.clone(),
            )));
            llm_sys.set_active(&provider_def.id, final_model.clone());

            let prompt = format!(
                "You are a persona generator for moxxy, an autonomous AI agent framework.\n\
                 The persona you generate will be PREPENDED to a system prompt that already contains:\n\
                 - Instructions on how to use skills via <invoke name=\"skill_name\">[\"args\"]</invoke> XML tags\n\
                 - A full catalog of available skills (shell commands, web crawling, task delegation, etc.)\n\
                 - Multi-step autonomy instructions with [CONTINUE] tokens\n\n\
                 Your job is to define the agent's IDENTITY, PERSONALITY, EXPERTISE, and TONE - NOT how it handles tasks.\n\
                 Do NOT include instructions about tool usage, function calling, or code generation patterns.\n\
                 Do NOT tell the agent to write code snippets or suggest npm/pip commands directly.\n\
                 The agent already knows how to execute actions through its skill system.\n\n\
                 Focus on:\n\
                 - Who the agent IS (role, expertise, personality)\n\
                 - How the agent COMMUNICATES (tone, verbosity, style)\n\
                 - What domain knowledge the agent has\n\
                 - Any behavioral guidelines (proactive vs reactive, cautious vs bold)\n\n\
                 Only return the markdown content. No code fences around the whole output.\n\n\
                 Description: {}",
                description
            );
            let messages = vec![crate::core::llm::ChatMessage {
                role: "user".to_string(),
                content: prompt,
            }];
            let generated_persona = llm_sys
                .generate_with_selected(&messages)
                .await
                .unwrap_or_else(|e| format!("Failed to generate persona: {}", e));

            let persona_path = default_agent_dir.join("persona.md");
            tokio::fs::write(&persona_path, generated_persona).await?;
            print_info("Saved to ~/.moxxy/agents/default/persona.md");
        }
    }

    // --- Step 6: Runtime Type ---
    let runtime_options = vec!["Native (recommended)", "WASM Container (sandboxed)"];
    let runtime_choice = inquire::Select::new("Select agent runtime:", runtime_options)
        .with_help_message("Native runs directly on your system; WASM runs in an isolated sandbox")
        .prompt()?;

    if runtime_choice.starts_with("WASM") {
        let profile_options = vec![
            "Base      - 128MB, No Network",
            "Networked - 256MB, Network Access",
            "Full      - Unlimited, All Capabilities",
        ];
        let profile_choice =
            inquire::Select::new("WASM isolation profile:", profile_options).prompt()?;

        let profile = if profile_choice.starts_with("Networked") {
            "networked"
        } else if profile_choice.starts_with("Full") {
            "full"
        } else {
            "base"
        };

        let caps = crate::core::container::ImageProfile::default_capabilities(profile);
        let fs_list: Vec<String> = caps
            .filesystem
            .iter()
            .map(|p| format!("\"{}\"", p))
            .collect();
        let container_toml = format!(
            "[runtime]\ntype = \"wasm\"\nimage = \"agent_runtime.wasm\"\n\n[capabilities]\nfilesystem = [{}]\nnetwork = {}\nmax_memory_mb = {}\nenv_inherit = {}\n",
            fs_list.join(", "),
            caps.network,
            caps.max_memory_mb,
            caps.env_inherit
        );
        tokio::fs::write(default_agent_dir.join("container.toml"), container_toml).await?;
        crate::core::container::ensure_wasm_image().await?;
        print_success(&format!("Container configured with '{}' profile.", profile));
    }

    print_success("Onboarding complete! Your agent is ready to go.");

    // --- Getting Started Guide ---
    println!("\n{}", style("Getting Started").bold().underlined());
    println!("\n  Start the background gateway, then connect via web or terminal:\n");
    println!("  1. {} moxxy gateway start", style("▶").cyan());
    println!(
        "  2. {} moxxy web            {}",
        style("▶").cyan(),
        style("# Web dashboard at http://127.0.0.1:3001").dim()
    );
    println!(
        "  3. {} moxxy tui            {}",
        style("▶").cyan(),
        style("# Interactive terminal UI").dim()
    );

    // --- Connect Channels ---
    println!("\n{}", style("Connect Channels").bold().underlined());
    println!(
        "\n  {}",
        style("Chat with your agent from any messaging platform:").dim()
    );
    println!("\n  {}", style("Telegram").bold());
    println!(
        "    1. Talk to {} on Telegram to create a bot",
        style("@BotFather").cyan()
    );
    println!("    2. Run: {} moxxy channel telegram", style("$").dim());
    println!("    3. Paste your bot token when prompted");
    println!(
        "    4. Start the gateway, send {} to your bot, and enter the pairing code",
        style("/start").cyan()
    );

    println!("\n  {}", style("Discord").bold());
    println!(
        "    1. Create an app at {}",
        style("https://discord.com/developers/applications").cyan()
    );
    println!("    2. Go to Bot section, reset token, enable Message Content Intent");
    println!("    3. Invite the bot to your server (Bot scope + Send Messages)");
    println!("    4. Run: {} moxxy channel discord", style("$").dim());

    println!("\n  {}", style("More channels:").dim());
    println!(
        "    {} Slack, WhatsApp, and others can be configured from the Web Dashboard.",
        style("•").dim()
    );

    // --- Useful Commands ---
    println!("\n{}", style("Useful Commands").bold().underlined());
    println!(
        "\n  {} moxxy gateway status    {}",
        style("$").dim(),
        style("# Check if gateway is running").dim()
    );
    println!(
        "  {} moxxy gateway restart   {}",
        style("$").dim(),
        style("# Restart after config changes").dim()
    );
    println!(
        "  {} moxxy logs              {}",
        style("$").dim(),
        style("# Follow real-time logs").dim()
    );
    println!(
        "  {} moxxy doctor            {}",
        style("$").dim(),
        style("# Diagnose system issues").dim()
    );
    println!(
        "  {} moxxy channel --help    {}",
        style("$").dim(),
        style("# See all channel options").dim()
    );
    println!();

    Ok(())
}
