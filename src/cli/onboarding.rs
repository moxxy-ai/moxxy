use anyhow::Result;
use console::style;

use crate::core::llm::generic_provider::GenericProvider;
use crate::core::llm::registry::ProviderRegistry;
use crate::core::terminal::{
    self, GuideSection, bordered_info, bordered_render_config, bordered_step, bordered_success,
    close_section, guide_bar, print_error, print_success,
};

pub async fn run_onboarding() -> Result<()> {
    terminal::print_banner();

    // Ensure directories and vault exist (in case `moxxy install` wasn't run first)
    use crate::platform::{NativePlatform, Platform};
    let moxxy_dir = NativePlatform::data_dir();
    let default_agent_dir = moxxy_dir.join("agents").join("default");

    if !default_agent_dir.exists() {
        tokio::fs::create_dir_all(default_agent_dir.join("skills")).await?;
        tokio::fs::create_dir_all(default_agent_dir.join("workspace")).await?;
        NativePlatform::restrict_dir_permissions(&moxxy_dir);
        NativePlatform::restrict_dir_permissions(&default_agent_dir);
    }

    println!(
        "  {}\n",
        style("Welcome to the Onboarding Wizard. Let's set up your first autonomous agent.").bold()
    );

    // Pre-step: Check and install required dependencies
    let deps_ok = super::doctor::ensure_dependencies().await?;
    if !deps_ok {
        let proceed = inquire::Confirm::new("Some dependencies are missing. Continue anyway?")
            .with_default(false)
            .with_render_config(bordered_render_config())
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

    // --- Step 1: LLM Provider ---
    GuideSection::new("Step 1 · AI Provider")
        .text("Your agent needs an AI provider to power its reasoning.")
        .text("Each provider offers different models with varying capabilities")
        .text("and pricing. The provider you choose determines which LLM")
        .text("your agent will use.")
        .open();

    let registry = ProviderRegistry::load();
    let provider_names: Vec<&str> = registry.providers.iter().map(|p| p.name.as_str()).collect();
    let provider_choice = inquire::Select::new("Select your AI provider:", provider_names)
        .with_help_message("Use arrow keys to navigate, Enter to select")
        .with_render_config(bordered_render_config())
        .prompt()?;
    guide_bar();
    close_section();

    let provider_def = registry
        .get_provider(provider_choice)
        .expect("Selected provider not found in registry");

    // --- Step 2: Model Selection ---
    GuideSection::new("Step 2 · Model Selection")
        .text("Each provider offers multiple models. Larger models are more")
        .text("capable but slower and more expensive. The default is a good")
        .text("starting point - you can change it later in the vault.")
        .open();

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
            .with_render_config(bordered_render_config())
            .prompt()?;

        if choice == "Custom model ID..." {
            inquire::Text::new("Enter custom model ID:")
                .with_help_message("e.g. claude-sonnet-4-6")
                .with_render_config(bordered_render_config())
                .prompt()?
        } else {
            let idx = model_options.iter().position(|o| o == choice).unwrap();
            provider_def.models[idx].id.clone()
        }
    };
    guide_bar();
    close_section();

    // --- Step 3: API Key ---
    GuideSection::new("Step 3 · API Key")
        .text("Your API key authenticates requests to the AI provider.")
        .text("It is stored locally in an encrypted vault and never sent")
        .text("anywhere except the provider's API.")
        .blank()
        .text(&format!(
            "Get your key from the {} developer dashboard.",
            style(&provider_def.name).bold()
        ))
        .open();

    let llm_api_key = inquire::Password::new(&format!("API key for {}:", provider_def.name))
        .without_confirmation()
        .with_help_message("Stored locally in the agent's encrypted vault")
        .with_render_config(bordered_render_config())
        .prompt()?;
    guide_bar();
    close_section();

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

    // --- Step 4: Channel connections (optional) ---
    GuideSection::new("Step 4 · Channel Connections")
        .text("Channels let you talk to your agent from messaging platforms")
        .text("like Telegram, Discord, Slack, and more. Each channel requires")
        .text("a bot token from the respective platform.")
        .blank()
        .text("You can skip this now and add channels later with:")
        .hint("moxxy channel telegram", "")
        .hint("moxxy channel discord", "")
        .open();

    let channel_options = vec!["Telegram", "Discord", "Skip for now"];
    let channels =
        inquire::MultiSelect::new("Which channels do you want to connect?", channel_options)
            .with_help_message(
                "Use Space to select, Enter to confirm. You can always add more later.",
            )
            .with_render_config(bordered_render_config())
            .prompt()?;
    guide_bar();
    close_section();

    for channel in &channels {
        match *channel {
            "Telegram" => {
                GuideSection::new("Telegram Setup")
                    .text("Connect a Telegram bot so you can chat with your agent on mobile.")
                    .blank()
                    .text(&format!("{}", style("How to get a bot token:").bold()))
                    .blank()
                    .numbered(
                        1,
                        &format!(
                            "Open Telegram and search for {}",
                            style("@BotFather").cyan()
                        ),
                    )
                    .numbered(
                        2,
                        &format!("Send {} to create a new bot", style("/newbot").cyan()),
                    )
                    .numbered(3, "Choose a name and username for your bot")
                    .numbered(
                        4,
                        "BotFather will reply with a bot token (like 123456:ABC-DEF)",
                    )
                    .numbered(5, "Copy that token and paste it below")
                    .open();

                let tg_token = inquire::Password::new("Telegram bot token:")
                    .without_confirmation()
                    .with_help_message("Paste the token from @BotFather")
                    .with_render_config(bordered_render_config())
                    .prompt()?;

                if !tg_token.is_empty() {
                    vault.set_secret("telegram_token", &tg_token).await?;
                    bordered_success("Telegram token saved.");
                    bordered_info(
                        "After onboarding, run: moxxy channel telegram (to complete pairing)",
                    );
                } else {
                    bordered_info(
                        "Skipped - you can configure Telegram later with 'moxxy channel telegram'.",
                    );
                }
                guide_bar();
                close_section();
            }
            "Discord" => {
                GuideSection::new("Discord Setup")
                    .text("Connect a Discord bot so your agent can chat in your server.")
                    .blank()
                    .text(&format!("{}", style("How to get a bot token:").bold()))
                    .blank()
                    .numbered(
                        1,
                        &format!(
                            "Go to {}",
                            style("https://discord.com/developers/applications").cyan()
                        ),
                    )
                    .numbered(2, "Click 'New Application' and give it a name")
                    .numbered(3, "Go to the Bot section in the left sidebar")
                    .numbered(4, "Click 'Reset Token' and copy the new token")
                    .numbered(
                        5,
                        &format!(
                            "Enable {} under Privileged Gateway Intents",
                            style("Message Content Intent").bold()
                        ),
                    )
                    .numbered(
                        6,
                        "Go to OAuth2 > URL Generator, select 'bot' scope + 'Send Messages'",
                    )
                    .numbered(7, "Open the generated URL to invite the bot to your server")
                    .open();

                let dc_token = inquire::Password::new("Discord bot token:")
                    .without_confirmation()
                    .with_help_message("Paste the token from Discord Developer Portal")
                    .with_render_config(bordered_render_config())
                    .prompt()?;

                if !dc_token.is_empty() {
                    vault.set_secret("discord_token", &dc_token).await?;
                    bordered_success("Discord token saved.");
                } else {
                    bordered_info(
                        "Skipped - you can configure Discord later with 'moxxy channel discord'.",
                    );
                }
                guide_bar();
                close_section();
            }
            _ => {}
        }
    }

    // --- Step 5: Agent Persona ---
    GuideSection::new("Step 5 · Agent Persona")
        .text("A persona defines your agent's identity, expertise, and")
        .text("communication style. It's a system prompt prepended to every")
        .text("conversation. You can generate one now using your LLM, or")
        .text("skip to use the default persona.")
        .blank()
        .text(&format!(
            "Stored at {}",
            style("~/.moxxy/agents/default/persona.md").cyan()
        ))
        .open();

    let generate_persona = inquire::Confirm::new("Generate a custom AI persona for your agent?")
        .with_default(false)
        .with_help_message("Uses your LLM provider to create a tailored system prompt")
        .with_render_config(bordered_render_config())
        .prompt()?;

    if generate_persona {
        let description = inquire::Text::new("Describe your ideal AI agent:")
            .with_help_message("e.g. 'A senior DevOps engineer who monitors my infra'")
            .with_render_config(bordered_render_config())
            .prompt()?;

        if !description.is_empty() {
            bordered_step("Generating persona...");
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
            bordered_info("Saved to ~/.moxxy/agents/default/persona.md");
        }
    }
    guide_bar();
    close_section();

    // --- Step 6: Runtime Type ---
    GuideSection::new("Step 6 · Agent Runtime")
        .text("Choose how your agent executes skills on your system:")
        .blank()
        .bullet(&format!(
            "{} - Runs directly on your host. Full speed, full access.",
            style("Native").bold()
        ))
        .bullet(&format!(
            "{} - Runs in a WebAssembly sandbox with memory/network limits.",
            style("WASM").bold()
        ))
        .open();

    let runtime_options = vec!["Native (recommended)", "WASM Container (sandboxed)"];
    let runtime_choice = inquire::Select::new("Select agent runtime:", runtime_options)
        .with_help_message("Native runs directly on your system; WASM runs in an isolated sandbox")
        .with_render_config(bordered_render_config())
        .prompt()?;

    if runtime_choice.starts_with("WASM") {
        let profile_options = vec![
            "Base      - 128MB, No Network",
            "Networked - 256MB, Network Access",
            "Full      - Unlimited, All Capabilities",
        ];
        let profile_choice = inquire::Select::new("WASM isolation profile:", profile_options)
            .with_render_config(bordered_render_config())
            .prompt()?;

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
        bordered_success(&format!("Container configured with '{}' profile.", profile));
    }
    guide_bar();
    close_section();

    print_success("Onboarding complete! Your agent is ready to go.");

    // --- Optional: Import from OpenClaw ---
    if let Some(openclaw_path) = super::migrate::check_openclaw_installation() {
        if super::migrate::has_migratable_content(&openclaw_path) {
            println!(
                "  {} {}",
                style("i").blue(),
                style("Detected OpenClaw installation with migratable content.").dim()
            );

            let migrate_now = inquire::Confirm::new("Would you like to import from OpenClaw?")
                .with_default(true)
                .with_help_message(
                    "Import SOUL.md, AGENTS.md, skills, memory, heartbeat, and LLM config",
                )
                .with_render_config(bordered_render_config())
                .prompt()?;

            if migrate_now {
                super::migrate::run_migration_wizard().await?;
            }
            println!();
        }
    }

    // --- Getting Started Guide ---
    GuideSection::new("Getting Started")
        .text("Start the background gateway, then connect via web or terminal:")
        .blank()
        .numbered(1, &format!("{}", style("moxxy gateway start").cyan()))
        .numbered(
            2,
            &format!(
                "{:<28} {}",
                style("moxxy web").cyan(),
                style("# Web dashboard").dim()
            ),
        )
        .numbered(
            3,
            &format!(
                "{:<28} {}",
                style("moxxy tui").cyan(),
                style("# Terminal UI").dim()
            ),
        )
        .print();

    // --- Connect Channels ---
    GuideSection::new("Connect Channels")
        .text("Chat with your agent from any messaging platform:")
        .blank()
        .text(&format!("{}", style("Telegram").bold()))
        .numbered(
            1,
            &format!(
                "Talk to {} on Telegram to create a bot",
                style("@BotFather").cyan()
            ),
        )
        .numbered(
            2,
            &format!("Run: {}", style("moxxy channel telegram").cyan()),
        )
        .numbered(3, "Paste your bot token when prompted")
        .numbered(
            4,
            &format!(
                "Start the gateway, send {} to your bot, enter the pairing code",
                style("/start").cyan()
            ),
        )
        .blank()
        .text(&format!("{}", style("Discord").bold()))
        .numbered(
            1,
            &format!(
                "Create an app at {}",
                style("https://discord.com/developers/applications").cyan()
            ),
        )
        .numbered(
            2,
            "Go to Bot section, reset token, enable Message Content Intent",
        )
        .numbered(
            3,
            "Invite the bot to your server (Bot scope + Send Messages)",
        )
        .numbered(
            4,
            &format!("Run: {}", style("moxxy channel discord").cyan()),
        )
        .blank()
        .text(&format!(
            "{} Slack, WhatsApp, and others via the Web Dashboard.",
            style("More:").dim()
        ))
        .print();

    // --- Useful Commands ---
    GuideSection::new("Useful Commands")
        .hint("moxxy gateway status", "# Check if gateway is running")
        .hint("moxxy gateway restart", "# Restart after config changes")
        .hint("moxxy logs", "# Follow real-time logs")
        .hint("moxxy doctor", "# Diagnose system issues")
        .hint("moxxy channel --help", "# See all channel options")
        .print();

    println!();

    Ok(())
}
