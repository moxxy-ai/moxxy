use async_trait::async_trait;
use moxxy_types::{ChannelError, MessageContent};
use serde::Deserialize;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

use crate::commands::CommandDefinition;
use crate::transport::{ChannelTransport, IncomingMessage, OutgoingMessage};

pub struct TelegramTransport {
    bot_token: String,
    http_client: reqwest::Client,
}

impl TelegramTransport {
    pub fn new(bot_token: String) -> Self {
        Self {
            bot_token,
            http_client: reqwest::Client::new(),
        }
    }

    fn api_url(&self, method: &str) -> String {
        format!("https://api.telegram.org/bot{}/{}", self.bot_token, method)
    }

    async fn get_updates(
        &self,
        offset: i64,
        timeout: u64,
    ) -> Result<Vec<TelegramUpdate>, ChannelError> {
        let resp = self
            .http_client
            .get(self.api_url("getUpdates"))
            .query(&[
                ("offset", offset.to_string()),
                ("timeout", timeout.to_string()),
            ])
            .timeout(Duration::from_secs(timeout + 5))
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        let body: TelegramResponse<Vec<TelegramUpdate>> = resp
            .json()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        if !body.ok {
            return Err(ChannelError::TransportError(
                body.description.unwrap_or_else(|| "unknown error".into()),
            ));
        }

        Ok(body.result.unwrap_or_default())
    }

    /// Clear any webhook and force Telegram into getUpdates mode.
    /// Prevents conflicts when restarting with a stale long-poll from a previous process.
    async fn delete_webhook(&self) -> Result<(), ChannelError> {
        let resp = self
            .http_client
            .post(self.api_url("deleteWebhook"))
            .json(&serde_json::json!({}))
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        let body: TelegramResponse<bool> = resp
            .json()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        if body.ok {
            tracing::info!("Telegram: webhook cleared, using long polling");
        } else {
            tracing::warn!(
                "Telegram: deleteWebhook returned error: {}",
                body.description.unwrap_or_default()
            );
        }
        Ok(())
    }

    async fn send_text(
        &self,
        chat_id: &str,
        text: &str,
        parse_mode: Option<&str>,
    ) -> Result<Option<i64>, ChannelError> {
        let mut body = serde_json::json!({
            "chat_id": chat_id,
            "text": text,
        });
        if let Some(mode) = parse_mode {
            body["parse_mode"] = serde_json::Value::String(mode.to_string());
        }

        let resp = self
            .http_client
            .post(self.api_url("sendMessage"))
            .json(&body)
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        let resp_body: TelegramResponse<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        if !resp_body.ok {
            return Err(ChannelError::TransportError(
                resp_body
                    .description
                    .unwrap_or_else(|| "send failed".into()),
            ));
        }

        let message_id = resp_body
            .result
            .and_then(|v| v.get("message_id").and_then(|id| id.as_i64()));
        Ok(message_id)
    }

    async fn edit_text(
        &self,
        chat_id: &str,
        message_id: i64,
        text: &str,
        parse_mode: Option<&str>,
    ) -> Result<(), ChannelError> {
        let mut body = serde_json::json!({
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
        });
        if let Some(mode) = parse_mode {
            body["parse_mode"] = serde_json::Value::String(mode.to_string());
        }

        let resp = self
            .http_client
            .post(self.api_url("editMessageText"))
            .json(&body)
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        let resp_body: TelegramResponse<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        if !resp_body.ok {
            let desc = resp_body.description.unwrap_or_default();
            // "message is not modified" is not a real error = silently ignore
            if !desc.contains("message is not modified") {
                return Err(ChannelError::TransportError(desc));
            }
        }

        Ok(())
    }
}

/// Escape special characters for Telegram MarkdownV2.
fn telegram_escape(s: &str) -> String {
    let special = [
        '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!',
    ];
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        if special.contains(&c) {
            result.push('\\');
        }
        result.push(c);
    }
    result
}

#[async_trait]
impl ChannelTransport for TelegramTransport {
    fn transport_name(&self) -> &str {
        "telegram"
    }

    async fn start_receiving(
        &self,
        sender: tokio::sync::mpsc::Sender<IncomingMessage>,
        shutdown: CancellationToken,
    ) -> Result<(), ChannelError> {
        // Clear any existing webhook to avoid conflicts with other instances.
        // This also resolves the "terminated by other getUpdates request" error
        // that occurs when a previous process's long-poll is still pending.
        if let Err(e) = self.delete_webhook().await {
            tracing::warn!("Failed to clear Telegram webhook on startup: {}", e);
        }

        let mut offset: i64 = 0;
        let mut conflict_retries: u32 = 0;

        loop {
            tokio::select! {
                _ = shutdown.cancelled() => break,
                result = self.get_updates(offset, 30) => {
                    match result {
                        Ok(updates) => {
                            conflict_retries = 0;
                            for update in updates {
                                offset = update.update_id + 1;
                                if let Some(msg) = update.message {
                                    let sender_id = msg.from.as_ref().map(|u| u.id.to_string()).unwrap_or_default();
                                    let sender_name = msg.from.as_ref().map(|u| u.first_name.clone()).unwrap_or_default();
                                    let incoming = IncomingMessage {
                                        external_chat_id: msg.chat.id.to_string(),
                                        sender_id,
                                        sender_name,
                                        text: msg.text.unwrap_or_default(),
                                        timestamp: msg.date,
                                    };
                                    if sender.send(incoming).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                        Err(ref e) if e.to_string().contains("Conflict") => {
                            conflict_retries += 1;
                            tracing::warn!(
                                retries = conflict_retries,
                                "Telegram polling conflict = another instance may be running. Retrying in {}s",
                                conflict_retries.min(30)
                            );
                            tokio::time::sleep(Duration::from_secs(conflict_retries.min(30) as u64)).await;
                        }
                        Err(e) => {
                            tracing::warn!("Telegram getUpdates error: {}", e);
                            tokio::time::sleep(Duration::from_secs(5)).await;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    async fn send_typing(&self, external_chat_id: &str) -> Result<(), ChannelError> {
        let body = serde_json::json!({
            "chat_id": external_chat_id,
            "action": "typing",
        });

        let _ = self
            .http_client
            .post(self.api_url("sendChatAction"))
            .json(&body)
            .send()
            .await;

        Ok(())
    }

    async fn send_message(&self, msg: OutgoingMessage) -> Result<(), ChannelError> {
        let text = self.format_content(&msg.content);
        let parse_mode = match &msg.content {
            MessageContent::Text(_) => None,
            _ => Some("MarkdownV2"),
        };
        self.send_text(&msg.external_chat_id, &text, parse_mode)
            .await
            .map(|_| ())
    }

    async fn send_message_returning_id(
        &self,
        msg: OutgoingMessage,
    ) -> Result<Option<String>, ChannelError> {
        let text = self.format_content(&msg.content);
        let parse_mode = match &msg.content {
            MessageContent::Text(_) => None,
            _ => Some("MarkdownV2"),
        };
        let msg_id = self
            .send_text(&msg.external_chat_id, &text, parse_mode)
            .await?;
        Ok(msg_id.map(|id| id.to_string()))
    }

    async fn edit_message(
        &self,
        external_chat_id: &str,
        message_id: &str,
        text: &str,
    ) -> Result<(), ChannelError> {
        let msg_id: i64 = message_id.parse().map_err(|e: std::num::ParseIntError| {
            ChannelError::TransportError(format!("invalid message_id: {e}"))
        })?;
        self.edit_text(external_chat_id, msg_id, text, None).await
    }

    async fn register_commands(&self, commands: &[CommandDefinition]) -> Result<(), ChannelError> {
        let bot_commands: Vec<serde_json::Value> = commands
            .iter()
            .map(|c| {
                serde_json::json!({
                    "command": c.command,
                    "description": c.description,
                })
            })
            .collect();

        let body = serde_json::json!({ "commands": bot_commands });

        let resp = self
            .http_client
            .post(self.api_url("setMyCommands"))
            .json(&body)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        let resp_body: TelegramResponse<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| ChannelError::TransportError(e.to_string()))?;

        if !resp_body.ok {
            return Err(ChannelError::TransportError(
                resp_body
                    .description
                    .unwrap_or_else(|| "setMyCommands failed".into()),
            ));
        }

        tracing::info!("Telegram: registered {} bot commands", commands.len());
        Ok(())
    }

    fn format_content(&self, content: &MessageContent) -> String {
        match content {
            MessageContent::Text(s) => s.clone(),
            MessageContent::ToolInvocation { name, arguments } => match arguments {
                Some(args) => format!("⚙ *{name}*\n`{args}`"),
                None => format!("⚙ *{name}*"),
            },
            MessageContent::ToolResult { name, result } => match result {
                Some(r) => format!("✅ *{name}*\n```\n{r}\n```"),
                None => format!("✅ *{name}*"),
            },
            MessageContent::ToolError { name, error } => format!("❌ *{name}*\n`{error}`"),
            MessageContent::RunCompleted => "✅ *Run completed*".into(),
            MessageContent::RunStarted => "🔄 *Working\\.\\.\\.*".into(),
            MessageContent::RunFailed { error } => {
                let escaped = telegram_escape(error);
                format!("❌ *Run failed*\n`{escaped}`")
            }
            MessageContent::SubagentSpawned { name, task } => {
                let escaped_name = telegram_escape(name);
                match task {
                    Some(t) => {
                        let escaped_task = telegram_escape(t);
                        format!("🤖 *{escaped_name}* spawned\n   └ {escaped_task}")
                    }
                    None => format!("🤖 *{escaped_name}* spawned"),
                }
            }
            MessageContent::SubagentCompleted { name } => {
                let escaped = telegram_escape(name);
                format!("✅ *{escaped}* completed")
            }
            MessageContent::SubagentFailed { name, error } => {
                let escaped_name = telegram_escape(name);
                let escaped_error = telegram_escape(error);
                format!("❌ *{escaped_name}* failed\n`{escaped_error}`")
            }
        }
    }
}

// Internal Telegram API types

#[derive(Debug, Deserialize)]
struct TelegramResponse<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramUpdate {
    update_id: i64,
    message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize)]
struct TelegramMessage {
    #[allow(dead_code)]
    message_id: i64,
    from: Option<TelegramUser>,
    chat: TelegramChat,
    date: i64,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramUser {
    id: i64,
    first_name: String,
}

#[derive(Debug, Deserialize)]
struct TelegramChat {
    id: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_telegram_update() {
        let json = r#"{
            "ok": true,
            "result": [{
                "update_id": 123,
                "message": {
                    "message_id": 1,
                    "from": {"id": 456, "is_bot": false, "first_name": "Alice"},
                    "chat": {"id": 789, "type": "private"},
                    "date": 1700000000,
                    "text": "Hello bot"
                }
            }]
        }"#;

        let resp: TelegramResponse<Vec<TelegramUpdate>> = serde_json::from_str(json).unwrap();
        assert!(resp.ok);
        let updates = resp.result.unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].update_id, 123);
        let msg = updates[0].message.as_ref().unwrap();
        assert_eq!(msg.chat.id, 789);
        assert_eq!(msg.text.as_deref(), Some("Hello bot"));
        assert_eq!(msg.from.as_ref().unwrap().first_name, "Alice");
    }

    #[test]
    fn parse_telegram_error_response() {
        let json = r#"{"ok": false, "description": "Unauthorized"}"#;
        let resp: TelegramResponse<Vec<TelegramUpdate>> = serde_json::from_str(json).unwrap();
        assert!(!resp.ok);
        assert_eq!(resp.description.as_deref(), Some("Unauthorized"));
    }

    #[test]
    fn api_url_formats_correctly() {
        let transport = TelegramTransport::new("123:ABC".into());
        assert_eq!(
            transport.api_url("getUpdates"),
            "https://api.telegram.org/bot123:ABC/getUpdates"
        );
    }
}
