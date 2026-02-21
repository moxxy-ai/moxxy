use anyhow::Result;
use async_trait::async_trait;
use serenity::Client;
use serenity::all::{Context, EventHandler, GatewayIntents, Message, Ready};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

use crate::core::brain::AutonomousBrain;
use crate::core::lifecycle::LifecycleComponent;
use crate::core::llm::LlmManager;
use crate::core::memory::MemorySystem;
use crate::skills::SkillManager;

struct Handler {
    agent_name: String,
    memory: Arc<Mutex<MemorySystem>>,
    skills: Arc<Mutex<SkillManager>>,
    llms: Arc<Mutex<LlmManager>>,
}

#[async_trait]
impl EventHandler for Handler {
    async fn message(&self, ctx: Context, msg: Message) {
        if msg.author.bot {
            return;
        }

        let trigger_text = msg.content.clone();
        if trigger_text.trim().is_empty() {
            return;
        }

        let src_label = format!("DISCORD_{}", msg.author.id);

        info!(
            "[{}] Received Discord message from {}: {}",
            self.agent_name, msg.author.name, trigger_text
        );

        match AutonomousBrain::execute_react_loop(
            &trigger_text,
            &src_label,
            self.llms.clone(),
            self.memory.clone(),
            self.skills.clone(),
            None,
        )
        .await
        {
            Ok(response) => {
                if let Err(e) = msg.channel_id.say(&ctx.http, response).await {
                    error!("[{}] Failed to send Discord reply: {}", self.agent_name, e);
                }
            }
            Err(e) => {
                error!("[{}] ReAct loop failed: {}", self.agent_name, e);
                if let Err(send_err) = msg
                    .channel_id
                    .say(&ctx.http, format!("Error processing request: {}", e))
                    .await
                {
                    error!(
                        "[{}] Failed to send error reply: {}",
                        self.agent_name, send_err
                    );
                }
            }
        }
    }

    async fn ready(&self, _: Context, ready: Ready) {
        info!(
            "[{}] Discord Bot connected as {}",
            self.agent_name, ready.user.name
        );
    }
}

pub struct DiscordChannel {
    agent_name: String,
    registry: Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>,
    skill_registry: Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>,
    llm_registry: Arc<Mutex<HashMap<String, Arc<Mutex<LlmManager>>>>>,
}

impl DiscordChannel {
    pub fn new(
        agent_name: String,
        registry: Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>,
        skill_registry: Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>,
        llm_registry: Arc<Mutex<HashMap<String, Arc<Mutex<LlmManager>>>>>,
    ) -> Self {
        Self {
            agent_name,
            registry,
            skill_registry,
            llm_registry,
        }
    }
}

#[async_trait]
impl LifecycleComponent for DiscordChannel {
    async fn on_init(&mut self) -> Result<()> {
        info!(
            "Discord Channel Interface initializing for [{}]...",
            self.agent_name
        );
        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        let registry = self.registry.lock().await;
        if let Some(mem_mutex) = registry.get(&self.agent_name) {
            let mem = mem_mutex.lock().await;
            let vault = crate::core::vault::SecretsVault::new(mem.get_db());

            if let Ok(Some(token)) = vault.get_secret("discord_token").await {
                info!(
                    "Found discord_token for [{}]. Starting Serenity client...",
                    self.agent_name
                );

                let skill_reg = self.skill_registry.lock().await;
                let llm_reg = self.llm_registry.lock().await;

                let skills = match skill_reg.get(&self.agent_name) {
                    Some(s) => s.clone(),
                    None => {
                        error!(
                            "[{}] Skills not found in registry, Discord disabled.",
                            self.agent_name
                        );
                        return Ok(());
                    }
                };
                let llms = match llm_reg.get(&self.agent_name) {
                    Some(l) => l.clone(),
                    None => {
                        error!(
                            "[{}] LLMs not found in registry, Discord disabled.",
                            self.agent_name
                        );
                        return Ok(());
                    }
                };
                let memory = mem_mutex.clone();

                let handler = Handler {
                    agent_name: self.agent_name.clone(),
                    memory,
                    skills,
                    llms,
                };

                let intents = GatewayIntents::GUILD_MESSAGES
                    | GatewayIntents::DIRECT_MESSAGES
                    | GatewayIntents::MESSAGE_CONTENT;

                match Client::builder(&token, intents)
                    .event_handler(handler)
                    .await
                {
                    Ok(mut client) => {
                        tokio::spawn(async move {
                            if let Err(why) = client.start().await {
                                error!("Discord client error: {:?}", why);
                            }
                        });
                    }
                    Err(e) => {
                        error!(
                            "[{}] Failed to create Discord client: {}. Discord disabled.",
                            self.agent_name, e
                        );
                    }
                }
            } else {
                warn!(
                    "[{}] No discord_token found in vault. Discord Channel disabled.",
                    self.agent_name
                );
            }
        }
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!(
            "Discord Channel Interface shutting down for [{}]...",
            self.agent_name
        );
        Ok(())
    }
}
