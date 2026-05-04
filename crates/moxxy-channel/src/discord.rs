use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use moxxy_types::{ChannelError, MessageContent};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_util::sync::CancellationToken;

use crate::commands::CommandDefinition;
use crate::transport::{ChannelTransport, IncomingMessage, OutgoingMessage};

const DISCORD_API_BASE: &str = "https://discord.com/api/v10";
const DISCORD_GATEWAY_URL: &str = "wss://gateway.discord.gg/?v=10&encoding=json";

/// Discord message length limit (2000 chars).
const DISCORD_MAX_MESSAGE_LEN: usize = 2000;

pub struct DiscordTransport {
    bot_token: String,
    http_client: reqwest::Client,
    /// Session ID for resuming gateway connections.
    session_id: Arc<RwLock<Option<String>>>,
    /// Sequence number for heartbeating.
    sequence: Arc<RwLock<Option<u64>>>,
}

impl DiscordTransport {
    pub fn new(bot_token: String) -> Self {
        Self {
            bot_token,
            http_client: reqwest::Client::new(),
            session_id: Arc::new(RwLock::new(None)),
            sequence: Arc::new(RwLock::new(None)),
        }
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}{}", DISCORD_API_BASE, path)
    }

    fn auth_header(&self) -> String {
        format!("Bot {}", self.bot_token)
    }

    async fn send_text(
        &self,
        channel_id: &str,
        text: &str,
    ) -> Result<Option<String>, ChannelError> {
        // Discord has a 2000 char limit — split if needed
        let chunks = split_message(text, DISCORD_MAX_MESSAGE_LEN);
        let mut last_id = None;

        for chunk in chunks {
            let body = serde_json::json!({ "content": chunk });

            let resp = self
                .http_client
                .post(self.api_url(&format!("/channels/{}/messages", channel_id)))
                .header("Authorization", self.auth_header())
                .json(&body)
                .timeout(Duration::from_secs(15))
                .send()
                .await
                .map_err(|e| ChannelError::TransportError(format!("Discord send: {e}")))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body_text = resp.text().await.unwrap_or_default();
                return Err(ChannelError::TransportError(format!(
                    "Discord send failed ({}): {}",
                    status, body_text
                )));
            }

            let resp_body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| ChannelError::TransportError(format!("Discord decode: {e}")))?;

            last_id = resp_body
                .get("id")
                .and_then(|v| v.as_str())
                .map(String::from);
        }

        Ok(last_id)
    }

    async fn edit_discord_message(
        &self,
        channel_id: &str,
        message_id: &str,
        text: &str,
    ) -> Result<(), ChannelError> {
        let body = serde_json::json!({ "content": text });

        let resp = self
            .http_client
            .patch(self.api_url(&format!("/channels/{}/messages/{}", channel_id, message_id)))
            .header("Authorization", self.auth_header())
            .json(&body)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(format!("Discord edit: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(ChannelError::TransportError(format!(
                "Discord edit failed ({}): {}",
                status, body_text
            )));
        }

        Ok(())
    }

    async fn send_typing_indicator(&self, channel_id: &str) -> Result<(), ChannelError> {
        let _ = self
            .http_client
            .post(self.api_url(&format!("/channels/{}/typing", channel_id)))
            .header("Authorization", self.auth_header())
            .timeout(Duration::from_secs(5))
            .send()
            .await;
        Ok(())
    }

    async fn register_global_commands(
        &self,
        commands: &[CommandDefinition],
    ) -> Result<(), ChannelError> {
        // Get bot application ID first
        let resp = self
            .http_client
            .get(self.api_url("/users/@me"))
            .header("Authorization", self.auth_header())
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(format!("Discord get user: {e}")))?;

        let user: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| ChannelError::TransportError(format!("Discord decode user: {e}")))?;

        let app_id = user
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ChannelError::TransportError("no bot user id".into()))?;

        let slash_commands: Vec<serde_json::Value> = commands
            .iter()
            .map(|c| {
                serde_json::json!({
                    "name": c.command,
                    "description": c.description,
                    "type": 1,
                })
            })
            .collect();

        let resp = self
            .http_client
            .put(self.api_url(&format!("/applications/{}/commands", app_id)))
            .header("Authorization", self.auth_header())
            .json(&slash_commands)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(format!("Discord register commands: {e}")))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ChannelError::TransportError(format!(
                "Discord register commands failed: {body}"
            )));
        }

        tracing::info!("Discord: registered {} slash commands", commands.len());
        Ok(())
    }
}

#[async_trait]
impl ChannelTransport for DiscordTransport {
    fn transport_name(&self) -> &str {
        "discord"
    }

    async fn start_receiving(
        &self,
        sender: tokio::sync::mpsc::Sender<IncomingMessage>,
        shutdown: CancellationToken,
    ) -> Result<(), ChannelError> {
        let mut gateway_url = DISCORD_GATEWAY_URL.to_string();
        let mut resume = false;

        loop {
            if shutdown.is_cancelled() {
                break;
            }

            let connect_result = tokio_tungstenite::connect_async(&gateway_url).await;

            let (ws_stream, _) = match connect_result {
                Ok(pair) => pair,
                Err(e) => {
                    tracing::warn!("Discord WebSocket connect failed: {e}");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };

            let (mut ws_sink, mut ws_stream_rx) = ws_stream.split();

            // Read Hello event to get heartbeat interval
            let hello = match read_gateway_event(&mut ws_stream_rx).await {
                Some(ev) => ev,
                None => {
                    tracing::warn!("Discord: no Hello event received");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };

            let heartbeat_interval = hello
                .d
                .as_ref()
                .and_then(|d| d.get("heartbeat_interval"))
                .and_then(|v| v.as_u64())
                .unwrap_or(41250);

            // Send Identify or Resume
            if resume {
                let session_id = self.session_id.read().await.clone();
                let seq = *self.sequence.read().await;
                if let Some(sid) = session_id {
                    let resume_payload = serde_json::json!({
                        "op": 6,
                        "d": {
                            "token": self.bot_token,
                            "session_id": sid,
                            "seq": seq,
                        }
                    });
                    let _ = ws_sink
                        .send(WsMessage::Text(resume_payload.to_string()))
                        .await;
                } else {
                    resume = false;
                }
            }

            if !resume {
                let identify = serde_json::json!({
                    "op": 2,
                    "d": {
                        "token": self.bot_token,
                        "intents": 512 | 32768, // GUILD_MESSAGES | MESSAGE_CONTENT
                        "properties": {
                            "os": "linux",
                            "browser": "moxxy",
                            "device": "moxxy"
                        }
                    }
                });
                if let Err(e) = ws_sink.send(WsMessage::Text(identify.to_string())).await {
                    tracing::warn!("Discord: failed to send Identify: {e}");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
            }

            // Heartbeat loop + message receive loop
            let sequence = self.sequence.clone();
            let session_id = self.session_id.clone();
            let mut heartbeat_ticker =
                tokio::time::interval(Duration::from_millis(heartbeat_interval));
            heartbeat_ticker.tick().await; // consume initial tick

            let reconnect;
            resume = true;

            loop {
                tokio::select! {
                    _ = shutdown.cancelled() => {
                        let _ = ws_sink.send(WsMessage::Close(None)).await;
                        return Ok(());
                    }
                    _ = heartbeat_ticker.tick() => {
                        let seq = *sequence.read().await;
                        let hb = serde_json::json!({ "op": 1, "d": seq });
                        if ws_sink.send(WsMessage::Text(hb.to_string())).await.is_err() {
                            reconnect = true;
                            break;
                        }
                    }
                    msg = ws_stream_rx.next() => {
                        match msg {
                            Some(Ok(WsMessage::Text(text))) => {
                                let Ok(event) = serde_json::from_str::<GatewayEvent>(&text) else {
                                    continue;
                                };

                                // Update sequence
                                if let Some(s) = event.s {
                                    *sequence.write().await = Some(s);
                                }

                                match event.op {
                                    // Dispatch
                                    0 => {
                                        if let Some(ref t) = event.t {
                                            match t.as_str() {
                                                "READY" => {
                                                    if let Some(ref d) = event.d {
                                                        if let Some(sid) = d.get("session_id").and_then(|v| v.as_str()) {
                                                            *session_id.write().await = Some(sid.to_string());
                                                        }
                                                        if let Some(url) = d.get("resume_gateway_url").and_then(|v| v.as_str()) {
                                                            gateway_url = format!("{}/?v=10&encoding=json", url);
                                                        }
                                                    }
                                                    tracing::info!("Discord: connected and ready");
                                                }
                                                "MESSAGE_CREATE" => {
                                                    if let Some(ref d) = event.d
                                                        && let Some(incoming) = parse_discord_message(d)
                                                        && sender.send(incoming).await.is_err()
                                                    {
                                                        return Ok(());
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                    // Heartbeat ACK
                                    11 => {}
                                    // Heartbeat request
                                    1 => {
                                        let seq = *sequence.read().await;
                                        let hb = serde_json::json!({ "op": 1, "d": seq });
                                        let _ = ws_sink.send(WsMessage::Text(hb.to_string())).await;
                                    }
                                    // Reconnect
                                    7 => {
                                        tracing::info!("Discord: server requested reconnect");
                                        reconnect = true;
                                        break;
                                    }
                                    // Invalid Session
                                    9 => {
                                        let resumable = event.d.as_ref().and_then(|d| d.as_bool()).unwrap_or(false);
                                        if !resumable {
                                            resume = false;
                                            *session_id.write().await = None;
                                            *sequence.write().await = None;
                                        }
                                        tracing::warn!("Discord: invalid session (resumable={})", resumable);
                                        reconnect = true;
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                            Some(Ok(WsMessage::Close(_))) | None => {
                                tracing::warn!("Discord: WebSocket closed");
                                reconnect = true;
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }

            if reconnect {
                tracing::info!("Discord: reconnecting in 5s...");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }

        Ok(())
    }

    async fn send_message(&self, msg: OutgoingMessage) -> Result<(), ChannelError> {
        let text = self.format_content(&msg.content);
        self.send_text(&msg.external_chat_id, &text).await?;
        Ok(())
    }

    async fn send_message_returning_id(
        &self,
        msg: OutgoingMessage,
    ) -> Result<Option<String>, ChannelError> {
        let text = self.format_content(&msg.content);
        self.send_text(&msg.external_chat_id, &text).await
    }

    async fn edit_message(
        &self,
        external_chat_id: &str,
        message_id: &str,
        text: &str,
    ) -> Result<(), ChannelError> {
        self.edit_discord_message(external_chat_id, message_id, text)
            .await
    }

    async fn send_typing(&self, external_chat_id: &str) -> Result<(), ChannelError> {
        self.send_typing_indicator(external_chat_id).await
    }

    async fn register_commands(&self, commands: &[CommandDefinition]) -> Result<(), ChannelError> {
        self.register_global_commands(commands).await
    }

    fn format_content(&self, content: &MessageContent) -> String {
        match content {
            MessageContent::Text(s) => markdown_to_discord(s),
            MessageContent::ToolInvocation { name, arguments } => match arguments {
                Some(args) => format!("⚙ **{name}**\n```\n{args}\n```"),
                None => format!("⚙ **{name}**"),
            },
            MessageContent::ToolResult { name, result } => match result {
                Some(r) => format!("✅ **{name}**\n```\n{r}\n```"),
                None => format!("✅ **{name}**"),
            },
            MessageContent::ToolError { name, error } => format!("❌ **{name}**\n`{error}`"),
            MessageContent::RunCompleted => "✅ **Run completed**".into(),
            MessageContent::RunStarted => "🔄 **Working...**".into(),
            MessageContent::RunFailed { error } => format!("❌ **Run failed**\n`{error}`"),
            MessageContent::SubagentSpawned { name, task } => match task {
                Some(t) => format!("🤖 **{name}** spawned\n   └ {t}"),
                None => format!("🤖 **{name}** spawned"),
            },
            MessageContent::SubagentCompleted { name } => format!("✅ **{name}** completed"),
            MessageContent::SubagentFailed { name, error } => {
                format!("❌ **{name}** failed\n`{error}`")
            }
        }
    }
}

/// Discord supports a subset of markdown natively, so we mostly pass through.
/// Just ensure code blocks and formatting work properly.
fn markdown_to_discord(md: &str) -> String {
    // Discord natively supports markdown, so we pass through as-is.
    md.to_string()
}

/// Split a message into chunks that fit within Discord's character limit.
fn split_message(text: &str, max_len: usize) -> Vec<String> {
    if text.len() <= max_len {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        if remaining.len() <= max_len {
            chunks.push(remaining.to_string());
            break;
        }

        // Try to split at a newline
        let split_at = remaining[..max_len].rfind('\n').unwrap_or(max_len);

        let (chunk, rest) = remaining.split_at(split_at);
        chunks.push(chunk.to_string());
        remaining = rest.strip_prefix('\n').unwrap_or(rest);
    }

    chunks
}

fn parse_discord_message(data: &serde_json::Value) -> Option<IncomingMessage> {
    let author = data.get("author")?;

    // Ignore bot messages
    if author.get("bot").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }

    let content = data.get("content")?.as_str()?;
    if content.is_empty() {
        return None;
    }

    let channel_id = data.get("channel_id")?.as_str()?;
    let sender_id = author.get("id")?.as_str()?;
    let sender_name = author
        .get("global_name")
        .or_else(|| author.get("username"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown");

    let timestamp = data
        .get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp())
        .unwrap_or_else(|| chrono::Utc::now().timestamp());

    Some(IncomingMessage {
        external_chat_id: channel_id.to_string(),
        sender_id: sender_id.to_string(),
        sender_name: sender_name.to_string(),
        text: content.to_string(),
        timestamp,
        audio: None,
        attachments: Vec::new(),
    })
}

async fn read_gateway_event(
    stream: &mut futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
) -> Option<GatewayEvent> {
    while let Some(msg) = stream.next().await {
        match msg {
            Ok(WsMessage::Text(text)) => {
                return serde_json::from_str(&text).ok();
            }
            Err(_) => return None,
            _ => continue,
        }
    }
    None
}

/// Discord Gateway event structure.
#[derive(Debug, Deserialize)]
struct GatewayEvent {
    op: u8,
    d: Option<serde_json::Value>,
    s: Option<u64>,
    t: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_types::MessageContent;

    #[test]
    fn discord_transport_name() {
        let transport = DiscordTransport::new("token".into());
        assert_eq!(transport.transport_name(), "discord");
    }

    #[test]
    fn parse_discord_message_basic() {
        let data = serde_json::json!({
            "id": "1234567890",
            "channel_id": "9876543210",
            "author": {
                "id": "111222333",
                "username": "testuser",
                "global_name": "Test User",
                "bot": false
            },
            "content": "Hello bot!",
            "timestamp": "2025-01-01T00:00:00+00:00"
        });

        let msg = parse_discord_message(&data).unwrap();
        assert_eq!(msg.external_chat_id, "9876543210");
        assert_eq!(msg.sender_id, "111222333");
        assert_eq!(msg.sender_name, "Test User");
        assert_eq!(msg.text, "Hello bot!");
    }

    #[test]
    fn parse_discord_message_ignores_bots() {
        let data = serde_json::json!({
            "id": "1234567890",
            "channel_id": "9876543210",
            "author": {
                "id": "111222333",
                "username": "botuser",
                "bot": true
            },
            "content": "I am a bot",
            "timestamp": "2025-01-01T00:00:00+00:00"
        });

        assert!(parse_discord_message(&data).is_none());
    }

    #[test]
    fn parse_discord_message_ignores_empty() {
        let data = serde_json::json!({
            "id": "1234567890",
            "channel_id": "9876543210",
            "author": {
                "id": "111222333",
                "username": "testuser",
                "bot": false
            },
            "content": "",
            "timestamp": "2025-01-01T00:00:00+00:00"
        });

        assert!(parse_discord_message(&data).is_none());
    }

    #[test]
    fn split_message_short() {
        let chunks = split_message("hello", 2000);
        assert_eq!(chunks, vec!["hello"]);
    }

    #[test]
    fn split_message_long() {
        let text = "a\n".repeat(1500);
        let chunks = split_message(&text, 2000);
        assert!(chunks.len() >= 2);
        for chunk in &chunks {
            assert!(chunk.len() <= 2000);
        }
    }

    #[test]
    fn format_content_text() {
        let transport = DiscordTransport::new("token".into());
        let result = transport.format_content(&MessageContent::Text("**bold**".into()));
        assert_eq!(result, "**bold**");
    }

    #[test]
    fn format_content_tool_invocation() {
        let transport = DiscordTransport::new("token".into());
        let result = transport.format_content(&MessageContent::ToolInvocation {
            name: "search".into(),
            arguments: Some("query".into()),
        });
        assert!(result.contains("**search**"));
        assert!(result.contains("query"));
    }

    #[test]
    fn format_content_run_completed() {
        let transport = DiscordTransport::new("token".into());
        let result = transport.format_content(&MessageContent::RunCompleted);
        assert!(result.contains("Run completed"));
    }
}
