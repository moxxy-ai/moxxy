use anyhow::Result;
use console::style;

use crate::core::terminal::{
    self, GuideSection, bordered_info, bordered_render_config, bordered_success, close_section,
    guide_bar, print_error, print_info, print_success,
};

pub async fn find_agent_using_secret(
    secret_key: &str,
    value: &str,
    exclude_agent: &str,
) -> Result<Option<String>> {
    use crate::platform::{NativePlatform, Platform};
    let agents_dir = NativePlatform::data_dir().join("agents");
    if !agents_dir.exists() {
        return Ok(None);
    }

    let mut entries = tokio::fs::read_dir(agents_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        if !entry.file_type().await?.is_dir() {
            continue;
        }

        let agent_name = entry.file_name().to_string_lossy().to_string();
        if agent_name == exclude_agent {
            continue;
        }

        let memory_sys = crate::core::memory::MemorySystem::new(entry.path()).await?;
        let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
        vault.initialize().await?;

        if let Ok(Some(existing)) = vault.get_secret(secret_key).await
            && existing.trim() == value.trim()
        {
            return Ok(Some(agent_name));
        }
    }

    Ok(None)
}

pub async fn run_channel_discord(
    agent_arg: Option<String>,
    token_arg: Option<String>,
) -> Result<()> {
    terminal::print_banner();

    // --- Agent selection ---
    GuideSection::new("Discord · Agent Selection")
        .text("Choose which agent this Discord bot should connect to.")
        .open();

    let agent_name = match agent_arg {
        Some(name) => {
            println!("  Agent: {}", style(&name).cyan());
            name
        }
        None => inquire::Text::new("Agent name:")
            .with_default("default")
            .with_help_message("Which agent should this Discord bot connect to?")
            .with_render_config(bordered_render_config())
            .prompt()?,
    };
    guide_bar();
    close_section();

    use crate::platform::{NativePlatform, Platform};
    let agent_dir = NativePlatform::data_dir().join("agents").join(&agent_name);

    if !agent_dir.exists() {
        print_error(&format!(
            "Agent '{}' does not exist. Run 'moxxy init' first.",
            agent_name
        ));
        return Ok(());
    }

    let memory_sys = crate::core::memory::MemorySystem::new(&agent_dir).await?;
    let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
    vault.initialize().await?;

    let has_token = matches!(vault.get_secret("discord_token").await, Ok(Some(_)));

    if has_token && token_arg.is_none() {
        GuideSection::new("Discord · Status")
            .status(
                "Discord",
                &format!("{}", style("CONFIGURED").green().bold()),
            )
            .open();
        let action = inquire::Select::new(
            "What would you like to do?",
            vec!["Replace token", "Disconnect Discord", "Cancel"],
        )
        .with_render_config(bordered_render_config())
        .prompt()?;
        guide_bar();
        close_section();
        match action {
            "Disconnect Discord" => {
                vault.remove_secret("discord_token").await?;
                print_info("Discord disconnected. Restart the gateway for changes to take effect.");
                return Ok(());
            }
            "Replace token" => {
                vault.remove_secret("discord_token").await?;
                print_info("Existing token cleared. Proceeding to set a new one...");
            }
            _ => return Ok(()),
        }
    }

    let token = match token_arg {
        Some(t) => t,
        None => {
            GuideSection::new("Discord · Bot Token")
                .text("To get a Discord bot token:")
                .blank()
                .numbered(
                    1,
                    &format!(
                        "Go to {}",
                        style("https://discord.com/developers/applications").cyan()
                    ),
                )
                .numbered(2, "Create a New Application, go to Bot section")
                .numbered(3, "Click 'Reset Token' to get a bot token")
                .numbered(
                    4,
                    &format!(
                        "Enable {} under Privileged Gateway Intents",
                        style("Message Content Intent").bold()
                    ),
                )
                .numbered(
                    5,
                    "Invite the bot to your server with the Bot scope + Send Messages permission",
                )
                .open();

            let t = inquire::Password::new("Discord bot token:")
                .without_confirmation()
                .with_help_message("Paste the token from the Discord Developer Portal")
                .with_render_config(bordered_render_config())
                .prompt()?;
            guide_bar();
            close_section();
            t
        }
    };

    if token.is_empty() {
        print_info("No token provided. Aborting.");
        return Ok(());
    }

    if let Some(owner) = find_agent_using_secret("discord_token", &token, &agent_name).await? {
        print_error(&format!(
            "This Discord bot token is already bound to agent '{}'. One bot per agent.",
            owner
        ));
        return Ok(());
    }

    vault.set_secret("discord_token", &token).await?;
    bordered_success(&format!(
        "Discord bot token saved for agent '{}'.",
        agent_name
    ));

    GuideSection::new("Next Steps")
        .numbered(1, "Make sure the bot is invited to your Discord server")
        .numbered(
            2,
            &format!(
                "Restart the gateway: {}",
                style("moxxy gateway restart").cyan()
            ),
        )
        .numbered(3, "Send a message in any channel the bot has access to")
        .print();
    println!();

    Ok(())
}

pub async fn run_channel_telegram(
    agent_arg: Option<String>,
    token_arg: Option<String>,
    pairing_code_arg: Option<String>,
) -> Result<()> {
    terminal::print_banner();

    // --- Agent selection ---
    GuideSection::new("Telegram · Agent Selection")
        .text("Choose which agent this Telegram bot should connect to.")
        .open();

    let agent_name = match agent_arg {
        Some(name) => {
            println!("  Agent: {}", style(&name).cyan());
            name
        }
        None => inquire::Text::new("Agent name:")
            .with_default("default")
            .with_help_message("Which agent should this Telegram bot connect to?")
            .with_render_config(bordered_render_config())
            .prompt()?,
    };
    guide_bar();
    close_section();

    use crate::platform::{NativePlatform, Platform};
    let agent_dir = NativePlatform::data_dir().join("agents").join(&agent_name);

    if !agent_dir.exists() {
        print_error(&format!(
            "Agent '{}' does not exist. Run 'moxxy init' first.",
            agent_name
        ));
        return Ok(());
    }

    let memory_sys = crate::core::memory::MemorySystem::new(&agent_dir).await?;
    let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
    vault.initialize().await?;

    let has_token = matches!(vault.get_secret("telegram_token").await, Ok(Some(_)));
    let paired_id = match vault.get_secret("telegram_chat_id").await {
        Ok(Some(id)) => Some(id),
        _ => None,
    };
    let has_pairing_code = matches!(vault.get_secret("telegram_pairing_code").await, Ok(Some(_)));

    if let Some(ref id) = paired_id
        && has_token
        && token_arg.is_none()
        && pairing_code_arg.is_none()
    {
        GuideSection::new("Telegram · Status")
            .status(
                "Telegram",
                &format!(
                    "{} (chat_id: {})",
                    style("PAIRED").green().bold(),
                    style(id).dim()
                ),
            )
            .open();
        let action = inquire::Select::new(
            "What would you like to do?",
            vec!["Re-pair with a new device", "Disconnect Telegram", "Cancel"],
        )
        .with_render_config(bordered_render_config())
        .prompt()?;
        guide_bar();
        close_section();
        match action {
            "Disconnect Telegram" => {
                vault.remove_secret("telegram_token").await?;
                vault.remove_secret("telegram_chat_id").await?;
                vault.remove_secret("telegram_pairing_code").await.ok();
                vault.remove_secret("telegram_pairing_chat_id").await.ok();
                print_info(
                    "Telegram disconnected. Restart the gateway for changes to take effect.",
                );
                return Ok(());
            }
            "Re-pair with a new device" => {
                vault.remove_secret("telegram_chat_id").await?;
                vault.remove_secret("telegram_pairing_code").await.ok();
                vault.remove_secret("telegram_pairing_chat_id").await.ok();
                print_info("Existing pairing cleared. Proceeding to re-pair...");
            }
            _ => return Ok(()),
        }
    } else if has_pairing_code && token_arg.is_none() && pairing_code_arg.is_none() {
        GuideSection::new("Telegram · Status")
            .status(
                "Telegram",
                &format!("{}", style("PENDING PAIRING").yellow().bold()),
            )
            .open();
        let action = inquire::Select::new(
            "What would you like to do?",
            vec!["Enter pairing code", "Revoke Pairing Request", "Cancel"],
        )
        .with_render_config(bordered_render_config())
        .prompt()?;
        guide_bar();
        close_section();
        match action {
            "Revoke Pairing Request" => {
                vault.remove_secret("telegram_pairing_code").await.ok();
                vault.remove_secret("telegram_pairing_chat_id").await.ok();
                print_info("Telegram pairing request revoked.");
                return Ok(());
            }
            "Enter pairing code" => {
                // Continue to the code entry below
            }
            _ => return Ok(()),
        }
    } else if has_token
        && paired_id.is_none()
        && !has_pairing_code
        && token_arg.is_none()
        && pairing_code_arg.is_none()
    {
        GuideSection::new("Telegram · Status")
            .status(
                "Telegram",
                &format!("{}", style("TOKEN SET (not paired)").yellow().bold()),
            )
            .open();
        let action = inquire::Select::new(
            "What would you like to do?",
            vec![
                "Continue to pairing",
                "Replace token",
                "Disconnect Telegram",
                "Cancel",
            ],
        )
        .with_render_config(bordered_render_config())
        .prompt()?;
        guide_bar();
        close_section();
        match action {
            "Disconnect Telegram" => {
                vault.remove_secret("telegram_token").await?;
                print_info("Telegram disconnected.");
                return Ok(());
            }
            "Replace token" => {
                vault.remove_secret("telegram_token").await?;
                print_info("Existing token cleared. Proceeding to set a new one...");
                // Fall through to token entry below
            }
            "Continue to pairing" => {
                // Fall through to pairing steps below
            }
            _ => return Ok(()),
        }
    } else if paired_id.is_some() && (token_arg.is_some() || pairing_code_arg.is_some()) {
        vault.remove_secret("telegram_chat_id").await.ok();
        vault.remove_secret("telegram_pairing_code").await.ok();
        vault.remove_secret("telegram_pairing_chat_id").await.ok();
        print_info("Existing pairing cleared. Proceeding to bind Telegram to this agent.");
    }

    let mut has_token = matches!(vault.get_secret("telegram_token").await, Ok(Some(_)));
    if let Some(token) = token_arg {
        if token.trim().is_empty() {
            print_error("Telegram token cannot be empty.");
            return Ok(());
        }
        if let Some(owner) = find_agent_using_secret("telegram_token", &token, &agent_name).await? {
            print_error(&format!(
                "This Telegram bot token is already bound to agent '{}'. One bot per agent.",
                owner
            ));
            return Ok(());
        }
        vault.set_secret("telegram_token", &token).await?;
        has_token = true;
        print_success(&format!("Token saved for agent '{}'.", agent_name));
    }

    if !has_token {
        GuideSection::new("Telegram · Bot Token")
            .text(&format!(
                "No Telegram bot token found for agent '{}'.",
                agent_name
            ))
            .blank()
            .text("To get a token, talk to @BotFather on Telegram and create a new bot.")
            .open();

        let token = inquire::Password::new("Telegram bot token:")
            .without_confirmation()
            .with_help_message("Paste the token from @BotFather")
            .with_render_config(bordered_render_config())
            .prompt()?;
        guide_bar();
        close_section();

        if token.is_empty() {
            print_info("No token provided. Aborting.");
            return Ok(());
        }
        if let Some(owner) = find_agent_using_secret("telegram_token", &token, &agent_name).await? {
            print_error(&format!(
                "This Telegram bot token is already bound to agent '{}'. One bot per agent.",
                owner
            ));
            return Ok(());
        }
        vault.set_secret("telegram_token", &token).await?;
        print_success("Token saved.");
    }

    GuideSection::new("Pairing Guide")
        .numbered(
            1,
            &format!(
                "Make sure the gateway is running: {}",
                style("moxxy gateway start").cyan()
            ),
        )
        .numbered(
            2,
            &format!(
                "Open Telegram and send {} to your bot",
                style("/start").cyan()
            ),
        )
        .numbered(3, "The bot will reply with a 6-digit pairing code")
        .numbered(4, "Enter that code below")
        .open();

    let code = match pairing_code_arg {
        Some(code) => code,
        None => inquire::Text::new("Pairing code:")
            .with_help_message("Enter the 6-digit code from your Telegram bot")
            .with_render_config(bordered_render_config())
            .prompt()?,
    };
    guide_bar();
    close_section();

    let stored_code = match vault.get_secret("telegram_pairing_code").await {
        Ok(Some(c)) => c,
        _ => {
            print_error(
                "No pairing code found. Make sure the gateway is running and you've sent /start to the bot.",
            );
            return Ok(());
        }
    };

    if code.trim() != stored_code.trim() {
        print_error("Pairing code does not match. Please try again.");
        return Ok(());
    }

    let chat_id = match vault.get_secret("telegram_pairing_chat_id").await {
        Ok(Some(id)) => id,
        _ => {
            print_error("No chat ID found for pairing. Send /start to the bot again.");
            return Ok(());
        }
    };

    if let Ok(Some(token)) = vault.get_secret("telegram_token").await
        && let Some(owner) = find_agent_using_secret("telegram_token", &token, &agent_name).await?
    {
        print_error(&format!(
            "This Telegram bot token is already bound to agent '{}'. One bot per agent.",
            owner
        ));
        return Ok(());
    }

    vault.set_secret("telegram_chat_id", &chat_id).await?;
    vault.remove_secret("telegram_pairing_code").await.ok();
    vault.remove_secret("telegram_pairing_chat_id").await.ok();

    print_success(&format!(
        "Telegram paired successfully! (chat_id: {})",
        chat_id
    ));
    print_info(&format!("Telegram is now bound to agent '{}'.", agent_name));
    terminal::print_bullet("Telegram replies are mirrored into the shared web/TUI session.");

    // --- Voice Recognition (STT) Configuration ---
    GuideSection::new("Voice Recognition")
        .text("Optionally enable voice transcription for Telegram voice messages.")
        .text("This uses OpenAI's Whisper API to convert speech to text.")
        .open();

    let enable_stt = inquire::Confirm::new("Enable Voice Recognition (OpenAI Whisper)?")
        .with_default(false)
        .with_help_message("Transcribes voice messages received on Telegram")
        .with_render_config(bordered_render_config())
        .prompt()?;

    if enable_stt {
        vault.set_secret("telegram_stt_enabled", "true").await?;

        let has_openai =
            matches!(vault.get_secret("openai_api_key").await, Ok(Some(ref v)) if !v.is_empty());
        if has_openai {
            bordered_info("Using existing OpenAI API Key for voice transcription.");
        } else {
            let stt_key = inquire::Password::new("OpenAI API key for Whisper:")
                .without_confirmation()
                .with_help_message("Stored locally in the agent's vault")
                .with_render_config(bordered_render_config())
                .prompt()?;
            if !stt_key.is_empty() {
                vault.set_secret("telegram_stt_token", &stt_key).await?;
                bordered_success("STT API key saved.");
            }
        }
        bordered_success("Voice Recognition enabled.");
    } else {
        vault.set_secret("telegram_stt_enabled", "false").await?;
    }
    guide_bar();
    close_section();

    Ok(())
}
