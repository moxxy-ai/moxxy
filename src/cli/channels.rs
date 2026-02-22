use anyhow::Result;
use console::style;

use crate::core::terminal::{self, print_info, print_success};

pub async fn find_agent_using_secret(
    secret_key: &str,
    value: &str,
    exclude_agent: &str,
) -> Result<Option<String>> {
    let home = dirs::home_dir().expect("Could not find home directory");
    let agents_dir = home.join(".moxxy").join("agents");
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
    println!("  {}\n", style("Channel Setup: Discord").bold());

    let agent_name = match agent_arg {
        Some(name) => name,
        None => inquire::Text::new("Agent name:")
            .with_default("default")
            .with_help_message("Which agent should this Discord bot connect to?")
            .prompt()?,
    };

    let home = dirs::home_dir().expect("Could not find home directory");
    let agent_dir = home.join(".moxxy").join("agents").join(&agent_name);

    if !agent_dir.exists() {
        println!(
            "  Error: Agent '{}' does not exist. Run 'moxxy init' first.",
            agent_name
        );
        return Ok(());
    }

    let memory_sys = crate::core::memory::MemorySystem::new(&agent_dir).await?;
    let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
    vault.initialize().await?;

    let has_token = matches!(vault.get_secret("discord_token").await, Ok(Some(_)));

    if has_token && token_arg.is_none() {
        println!("  Status: Discord bot token is CONFIGURED");
        let action = inquire::Select::new(
            "What would you like to do?",
            vec!["Replace token", "Disconnect Discord", "Cancel"],
        )
        .prompt()?;
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
            print_info("To get a Discord bot token:");
            println!("  1. Go to https://discord.com/developers/applications");
            println!("  2. Create a New Application → go to Bot section");
            println!("  3. Click 'Reset Token' to get a bot token");
            println!("  4. Enable 'Message Content Intent' under Privileged Gateway Intents");
            println!(
                "  5. Invite the bot to your server with the Bot scope + Send Messages permission\n"
            );
            inquire::Password::new("Discord bot token:")
                .without_confirmation()
                .with_help_message("Paste the token from the Discord Developer Portal")
                .prompt()?
        }
    };

    if token.is_empty() {
        println!("  No token provided. Aborting.");
        return Ok(());
    }

    if let Some(owner) = find_agent_using_secret("discord_token", &token, &agent_name).await? {
        println!(
            "  Error: This Discord bot token is already bound to agent '{}'. One Discord bot can only be bound to one agent.",
            owner
        );
        return Ok(());
    }

    vault.set_secret("discord_token", &token).await?;
    print_success(&format!(
        "Discord bot token saved for agent '{}'.",
        agent_name
    ));

    println!("\n  Next steps:");
    println!("  1. Make sure the bot is invited to your Discord server");
    println!("  2. Restart the moxxy gateway: moxxy gateway restart");
    println!("  3. Send a message in any channel the bot has access to\n");

    Ok(())
}

pub async fn run_channel_telegram(
    agent_arg: Option<String>,
    token_arg: Option<String>,
    pairing_code_arg: Option<String>,
) -> Result<()> {
    terminal::print_banner();
    println!("  {}\n", style("Channel Setup: Telegram").bold());

    let agent_name = match agent_arg {
        Some(name) => name,
        None => inquire::Text::new("Agent name:")
            .with_default("default")
            .with_help_message("Which agent should this Telegram bot connect to?")
            .prompt()?,
    };

    let home = dirs::home_dir().expect("Could not find home directory");
    let agent_dir = home.join(".moxxy").join("agents").join(&agent_name);

    if !agent_dir.exists() {
        println!(
            "  Error: Agent '{}' does not exist. Run 'moxxy init' first.",
            agent_name
        );
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
        println!("  Status: Telegram is PAIRED (chat_id: {})", id);
        let action = inquire::Select::new(
            "What would you like to do?",
            vec!["Re-pair with a new device", "Disconnect Telegram", "Cancel"],
        )
        .prompt()?;
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
        println!("  Status: Telegram has a PENDING pairing request.");
        let action = inquire::Select::new(
            "What would you like to do?",
            vec!["Enter pairing code", "Revoke Pairing Request", "Cancel"],
        )
        .prompt()?;
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
    } else if paired_id.is_some() && (token_arg.is_some() || pairing_code_arg.is_some()) {
        vault.remove_secret("telegram_chat_id").await.ok();
        vault.remove_secret("telegram_pairing_code").await.ok();
        vault.remove_secret("telegram_pairing_chat_id").await.ok();
        print_info("Existing pairing cleared. Proceeding to bind Telegram to this agent.");
    }

    let mut has_token = matches!(vault.get_secret("telegram_token").await, Ok(Some(_)));
    if let Some(token) = token_arg {
        if token.trim().is_empty() {
            println!("  Error: Telegram token cannot be empty.");
            return Ok(());
        }
        if let Some(owner) = find_agent_using_secret("telegram_token", &token, &agent_name).await? {
            println!(
                "  Error: This Telegram bot token is already bound to agent '{}'. One Telegram channel can only be bound to one agent.",
                owner
            );
            return Ok(());
        }
        vault.set_secret("telegram_token", &token).await?;
        has_token = true;
        print_success(&format!("Token saved for agent '{}'.", agent_name));
    }

    if !has_token {
        print_info(&format!(
            "No Telegram bot token found for agent '{}'.",
            agent_name
        ));
        println!("  To get a token, talk to @BotFather on Telegram and create a new bot.\n");
        let token = inquire::Password::new("Telegram bot token:")
            .without_confirmation()
            .with_help_message("Paste the token from @BotFather")
            .prompt()?;
        if token.is_empty() {
            println!("  No token provided. Aborting.");
            return Ok(());
        }
        if let Some(owner) = find_agent_using_secret("telegram_token", &token, &agent_name).await? {
            println!(
                "  Error: This Telegram bot token is already bound to agent '{}'. One Telegram channel can only be bound to one agent.",
                owner
            );
            return Ok(());
        }
        vault.set_secret("telegram_token", &token).await?;
        print_success("Token saved.");
    }

    println!("\n  Next steps:");
    println!("  1. Make sure the moxxy gateway is running: moxxy gateway start");
    println!("  2. Open Telegram and send /start to your bot");
    println!("  3. The bot will reply with a 6-digit pairing code");
    println!("  4. Enter that code below\n");

    let code = match pairing_code_arg {
        Some(code) => code,
        None => inquire::Text::new("Pairing code:")
            .with_help_message("Enter the 6-digit code from your Telegram bot")
            .prompt()?,
    };

    let stored_code = match vault.get_secret("telegram_pairing_code").await {
        Ok(Some(c)) => c,
        _ => {
            println!(
                "  Error: No pairing code found. Make sure the gateway is running and you've sent /start to the bot."
            );
            return Ok(());
        }
    };

    if code.trim() != stored_code.trim() {
        println!("  Error: Pairing code does not match. Please try again.");
        return Ok(());
    }

    let chat_id = match vault.get_secret("telegram_pairing_chat_id").await {
        Ok(Some(id)) => id,
        _ => {
            println!("  Error: No chat ID found for pairing. Please send /start to the bot again.");
            return Ok(());
        }
    };

    if let Ok(Some(token)) = vault.get_secret("telegram_token").await
        && let Some(owner) = find_agent_using_secret("telegram_token", &token, &agent_name).await?
    {
        println!(
            "  Error: This Telegram bot token is already bound to agent '{}'. One Telegram channel can only be bound to one agent.",
            owner
        );
        return Ok(());
    }

    // We allow multiple agents to be paired with the same Telegram user (same chat_id)
    // as long as they use different bot tokens. This is already enforced by the token check.
    /*
    if let Some(owner) = find_agent_using_secret("telegram_chat_id", &chat_id, &agent_name).await? {
        println!(
            "  Error: This Telegram chat is already paired with agent '{}'. One Telegram channel can only be bound to one agent.",
            owner
        );
        return Ok(());
    }
    */

    vault.set_secret("telegram_chat_id", &chat_id).await?;
    vault.remove_secret("telegram_pairing_code").await.ok();
    vault.remove_secret("telegram_pairing_chat_id").await.ok();

    print_success(&format!(
        "Telegram paired successfully! (chat_id: {})",
        chat_id
    ));
    print_info(&format!("Telegram is now bound to agent '{}'.", agent_name));
    println!("  Telegram replies are mirrored into the shared web/TUI session.\n");

    // --- Voice Recognition (STT) Configuration ---
    let enable_stt = inquire::Confirm::new("Enable Voice Recognition (OpenAI Whisper)?")
        .with_default(false)
        .with_help_message("Transcribes voice messages received on Telegram")
        .prompt()?;

    if enable_stt {
        vault.set_secret("telegram_stt_enabled", "true").await?;

        let has_openai =
            matches!(vault.get_secret("openai_api_key").await, Ok(Some(ref v)) if !v.is_empty());
        if has_openai {
            print_info("Using existing OpenAI API Key for voice transcription.");
        } else {
            let stt_key = inquire::Password::new("OpenAI API key for Whisper:")
                .without_confirmation()
                .with_help_message("Stored locally in the agent's vault")
                .prompt()?;
            if !stt_key.is_empty() {
                vault.set_secret("telegram_stt_token", &stt_key).await?;
                print_success("STT API key saved.");
            }
        }
        print_success("Voice Recognition enabled.");
    } else {
        vault.set_secret("telegram_stt_enabled", "false").await?;
    }

    Ok(())
}
