use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;
use teloxide::net::Download;
use teloxide::prelude::*;
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::core::container::AgentContainer;
use crate::core::lifecycle::LifecycleComponent;
use crate::core::llm::LlmManager;
use crate::core::memory::MemorySystem;
use crate::skills::SkillManager;

async fn transcribe_audio(api_key: &str, buf: Vec<u8>) -> Result<String> {
    let client = reqwest::Client::new();
    let file = reqwest::multipart::Part::bytes(buf)
        .file_name("audio.ogg")
        .mime_str("audio/ogg")?;

    let form = reqwest::multipart::Form::new()
        .text("model", "whisper-1")
        .part("file", file);

    let res = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await?;

    if !res.status().is_success() {
        return Err(anyhow::anyhow!("Whisper API error: {}", res.text().await?));
    }

    let parsed: serde_json::Value = res.json().await?;
    if let Some(text) = parsed.get("text").and_then(|t| t.as_str()) {
        Ok(text.to_string())
    } else {
        Err(anyhow::anyhow!("No text in Whisper response"))
    }
}

pub struct TelegramInterface {
    agent_name: String,
    token: String,
    llm_manager: Arc<Mutex<LlmManager>>,
    memory_sys: Arc<Mutex<MemorySystem>>,
    skill_sys: Arc<Mutex<SkillManager>>,
    wasm_container: Option<Arc<AgentContainer>>,
}

impl TelegramInterface {
    pub fn new(
        agent_name: String,
        token: String,
        llm_manager: Arc<Mutex<LlmManager>>,
        memory_sys: Arc<Mutex<MemorySystem>>,
        skill_sys: Arc<Mutex<SkillManager>>,
        wasm_container: Option<Arc<AgentContainer>>,
    ) -> Self {
        Self {
            agent_name,
            token,
            llm_manager,
            memory_sys,
            skill_sys,
            wasm_container,
        }
    }

    async fn start_bot(&self) -> Result<()> {
        let bot_client = Bot::new(&self.token);

        let commands = vec![
            teloxide::types::BotCommand::new("new", "Clear agent's short-term memory"),
            teloxide::types::BotCommand::new("skills", "List available skills"),
            teloxide::types::BotCommand::new("skill", "List available skills"),
        ];
        if let Err(e) = bot_client.set_my_commands(commands).await {
            error!("Failed to set telegram bot commands: {}", e);
        }

        let agent_name = self.agent_name.clone();
        let llm = self.llm_manager.clone();
        let memory = self.memory_sys.clone();
        let skills = self.skill_sys.clone();
        let container = self.wasm_container.clone();

        tokio::spawn(async move {
            teloxide::repl(bot_client, move |bot: Bot, msg: Message| {
                let agent_name = agent_name.clone();
                let llm = llm.clone();
                let memory = memory.clone();
                let skills = skills.clone();
                let container = container.clone();
                async move {
                    let chat_id = msg.chat.id.0;
                    let vault = {
                        let mem = memory.lock().await;
                        crate::core::vault::SecretsVault::new(mem.get_db())
                    };

                    let mut final_text = None;

                    if let Some(text) = msg.text() {
                        final_text = Some(text.to_string());
                    } else if let Some(voice) = msg.voice() {
                        // Check if STT is enabled
                        let _stm_entries = memory.lock().await.read_stm_structured(20, true).await.unwrap_or_default();
                        let is_enabled = match vault.get_secret("telegram_stt_enabled").await {
                            Ok(Some(val)) => val == "true",
                            _ => false,
                        };

                        if !is_enabled {
                            let _ = bot.send_message(msg.chat.id, "🎤 Voice messages are currently disabled. You can enable them in the Web Interface or CLI.").await;
                            return Ok(());
                        }

                        let stt_token = match vault.get_secret("telegram_stt_token").await {
                            Ok(Some(token)) if !token.trim().is_empty() => token,
                            _ => match vault.get_secret("openai_api_key").await {
                                Ok(Some(token)) if !token.trim().is_empty() => token,
                                _ => String::new(),
                            }
                        };

                        if stt_token.is_empty() {
                            let _ = bot.send_message(msg.chat.id, "⚠️ OpenAI API Key is missing for Voice Recognition. Please configure it inside moxxy.").await;
                            return Ok(());
                        }

                        let _ = bot.send_chat_action(msg.chat.id, teloxide::types::ChatAction::Typing).await;

                        match bot.get_file(voice.file.id.clone()).await {
                            Ok(file) => {
                                let mut buf = vec![];
                                if let Err(e) = bot.download_file(&file.path, &mut buf).await {
                                    error!("Failed to download voice message: {}", e);
                                    let _ = bot.send_message(msg.chat.id, "❌ Failed to download voice message.").await;
                                    return Ok(());
                                }

                                match transcribe_audio(&stt_token, buf).await {
                                    Ok(transcribed) => {
                                        info!("Transcribed voice message: {}", transcribed);
                                        final_text = Some(transcribed);
                                    }
                                    Err(e) => {
                                        error!("Failed to transcribe audio: {}", e);
                                        let _ = bot.send_message(msg.chat.id, "❌ Failed to transcribe voice message (Whisper API Error).").await;
                                        return Ok(());
                                    }
                                }
                            }
                            Err(e) => {
                                error!("Failed to get voice file info: {}", e);
                                let _ = bot.send_message(msg.chat.id, "❌ Failed to access voice message.").await;
                                return Ok(());
                            }
                        }
                    }

                    if let Some(text) = final_text {
                        info!("Received telegram message to process: {}", text);

                        if text.trim().starts_with("/start") {
                            info!("[{}] Processing /start pairing request for chat_id: {}", agent_name, chat_id);
                            let _ = bot.send_chat_action(msg.chat.id, teloxide::types::ChatAction::Typing).await;

                            // Generate a cryptographically strong 8-char alphanumeric code
                            let code: String = rand::Rng::sample_iter(rand::thread_rng(), &rand::distributions::Alphanumeric)
                                .take(8)
                                .map(char::from)
                                .collect();
                            // Do NOT log the pairing code to prevent exposure via SSE logs
                            info!("[{}] Generated pairing code for chat_id: {}", agent_name, chat_id);
                            if let Err(e) = vault.set_secret("telegram_pairing_code", &code.to_string()).await {
                                error!("[{}] Failed to store pairing code in vault: {}", agent_name, e);
                                let _ = bot.send_message(msg.chat.id, "❌ System error: failed to generate pairing code.").await;
                                return Ok(());
                            }
                            if let Err(e) = vault.set_secret("telegram_pairing_chat_id", &chat_id.to_string()).await {
                                error!("[{}] Failed to store pairing chat ID in vault: {}", agent_name, e);
                            }

                            let reply = format!(
                                "🔐 moxxy Pairing\n\nYour pairing code is: {}\n\nEnter this code in moxxy CLI/Web to complete pairing.",
                                code
                            );
                            if let Err(e) = bot.send_message(msg.chat.id, reply).await {
                                error!("[{}] Failed to send pairing code message: {}", agent_name, e);
                            } else {
                                info!("[{}] Pairing code sent to chat_id: {}", agent_name, chat_id);
                            }
                            return Ok(());
                        }

                        let paired_chat_id: Option<i64> = match vault.get_secret("telegram_chat_id").await {
                            Ok(Some(id)) => id.parse().ok(),
                            _ => None,
                        };
                        if paired_chat_id != Some(chat_id) {
                            let _ = bot.send_message(
                                msg.chat.id,
                                "⚠️ This chat is not paired yet. Send /start to get a pairing code.",
                            ).await;
                            return Ok(());
                        }

                        let text = if text.trim() == "/skills" || text.trim() == "/skill" {
                            let _ = bot.send_message(msg.chat.id, "🔍 Checking available skills...").await;
                            "skill list".to_string()
                        } else if text.trim() == "/new" {
                            {
                                let mut mem = memory.lock().await;
                                let _ = mem.new_session();
                            }
                            let _ = bot.send_message(msg.chat.id, "🔄 Agent's short-term memory cleared. Starting fresh!").await;
                            return Ok(());
                        } else {
                            text
                        };

                        let typing_bot = bot.clone();
                        let typing_chat = msg.chat.id;
                        let (typing_stop_tx, mut typing_stop_rx) = tokio::sync::oneshot::channel::<()>();
                        let typing_task = tokio::spawn(async move {
                            loop {
                                let _ = typing_bot
                                    .send_chat_action(typing_chat, teloxide::types::ChatAction::Typing)
                                    .await;

                                tokio::select! {
                                    _ = &mut typing_stop_rx => break,
                                    _ = tokio::time::sleep(Duration::from_secs(4)) => {}
                                }
                            }
                        });

                        let result = if let Some(ref container) = container {
                            container.execute(&text, llm.clone(), memory.clone(), skills.clone(), None).await
                        } else {
                            let src = format!("TELEGRAM_{}", chat_id);
                            crate::core::brain::AutonomousBrain::execute_react_loop(&text, &src, llm.clone(), memory.clone(), skills.clone(), None, &agent_name).await
                        };

                        let _ = typing_stop_tx.send(());
                        let _ = typing_task.await;

                        match result {
                            Ok(response) => {
                                let _ = bot.send_message(msg.chat.id, response).await;
                            }
                            Err(e) => {
                                error!("Brain execution failed: {}", e);
                                let _ = bot.send_message(msg.chat.id, "❌ moxxy failed to process this message. Check gateway logs.").await;
                            }
                        }
                    }
                    Ok(())
                }
            })
            .await;
        });
        Ok(())
    }
}

#[async_trait]
impl LifecycleComponent for TelegramInterface {
    async fn on_init(&mut self) -> Result<()> {
        info!("[{}] Telegram Interface initializing...", self.agent_name);
        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        info!("[{}] Telegram Interface starting...", self.agent_name);
        if let Err(e) = self.start_bot().await {
            error!("[{}] Telegram Bot crashed: {}", self.agent_name, e);
        }
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!("[{}] Telegram Interface shutting down...", self.agent_name);
        Ok(())
    }
}
