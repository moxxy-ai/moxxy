use async_trait::async_trait;
use moxxy_types::{ChannelError, MessageContent};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::commands::CommandDefinition;
use crate::transport::{ChannelTransport, IncomingMessage, OutgoingMessage};

const WHATSAPP_API_BASE: &str = "https://graph.facebook.com/v21.0";

/// WhatsApp message length limit (4096 chars for text messages).
const WHATSAPP_MAX_MESSAGE_LEN: usize = 4096;

pub struct WhatsAppTransport {
    /// The Phone Number ID from the WhatsApp Business API.
    phone_number_id: String,
    /// Permanent access token for the WhatsApp Business API.
    access_token: String,
    http_client: reqwest::Client,
    /// Incoming messages pushed by the webhook handler.
    webhook_rx: Arc<tokio::sync::Mutex<Option<mpsc::Receiver<IncomingMessage>>>>,
    webhook_tx: mpsc::Sender<IncomingMessage>,
}

/// Configuration stored alongside the channel document.
#[derive(Debug, Clone, Deserialize)]
pub struct WhatsAppConfig {
    pub phone_number_id: String,
    /// The verify token used to validate the webhook endpoint.
    #[serde(default)]
    pub verify_token: Option<String>,
}

impl WhatsAppTransport {
    pub fn new(phone_number_id: String, access_token: String) -> Self {
        let (tx, rx) = mpsc::channel(256);
        Self {
            phone_number_id,
            access_token,
            http_client: reqwest::Client::new(),
            webhook_rx: Arc::new(tokio::sync::Mutex::new(Some(rx))),
            webhook_tx: tx,
        }
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/{}{}", WHATSAPP_API_BASE, self.phone_number_id, path)
    }

    /// Get a sender handle that the webhook route can use to push incoming messages.
    pub fn incoming_sender(&self) -> mpsc::Sender<IncomingMessage> {
        self.webhook_tx.clone()
    }

    /// Mark an incoming message as read.
    #[allow(dead_code)]
    async fn mark_read(&self, message_id: &str) -> Result<(), ChannelError> {
        let body = serde_json::json!({
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
        });

        let _ = self
            .http_client
            .post(self.api_url("/messages"))
            .bearer_auth(&self.access_token)
            .json(&body)
            .timeout(Duration::from_secs(10))
            .send()
            .await;

        Ok(())
    }

    async fn send_text_message(
        &self,
        to: &str,
        text: &str,
    ) -> Result<Option<String>, ChannelError> {
        // WhatsApp Cloud API expects the recipient phone number in `to`
        let chunks = split_message(text, WHATSAPP_MAX_MESSAGE_LEN);
        let mut last_id = None;

        for chunk in chunks {
            let body = serde_json::json!({
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to,
                "type": "text",
                "text": {
                    "preview_url": false,
                    "body": chunk,
                }
            });

            let resp = self
                .http_client
                .post(self.api_url("/messages"))
                .bearer_auth(&self.access_token)
                .json(&body)
                .timeout(Duration::from_secs(15))
                .send()
                .await
                .map_err(|e| ChannelError::TransportError(format!("WhatsApp send: {e}")))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body_text = resp.text().await.unwrap_or_default();
                return Err(ChannelError::TransportError(format!(
                    "WhatsApp send failed ({}): {}",
                    status, body_text
                )));
            }

            let resp_body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| ChannelError::TransportError(format!("WhatsApp decode: {e}")))?;

            last_id = resp_body
                .get("messages")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|m| m.get("id"))
                .and_then(|v| v.as_str())
                .map(String::from);
        }

        Ok(last_id)
    }
}

#[async_trait]
impl ChannelTransport for WhatsAppTransport {
    fn transport_name(&self) -> &str {
        "whatsapp"
    }

    async fn start_receiving(
        &self,
        sender: tokio::sync::mpsc::Sender<IncomingMessage>,
        shutdown: CancellationToken,
    ) -> Result<(), ChannelError> {
        // Take ownership of the webhook receiver
        let mut webhook_rx =
            self.webhook_rx.lock().await.take().ok_or_else(|| {
                ChannelError::TransportError("start_receiving already called".into())
            })?;

        tracing::info!(
            phone_number_id = %self.phone_number_id,
            "WhatsApp transport started, waiting for webhook messages"
        );

        loop {
            tokio::select! {
                _ = shutdown.cancelled() => break,
                msg = webhook_rx.recv() => {
                    match msg {
                        Some(incoming) => {
                            if sender.send(incoming).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
            }
        }

        Ok(())
    }

    async fn send_message(&self, msg: OutgoingMessage) -> Result<(), ChannelError> {
        let text = self.format_content(&msg.content);
        self.send_text_message(&msg.external_chat_id, &text).await?;
        Ok(())
    }

    async fn send_message_returning_id(
        &self,
        msg: OutgoingMessage,
    ) -> Result<Option<String>, ChannelError> {
        let text = self.format_content(&msg.content);
        self.send_text_message(&msg.external_chat_id, &text).await
    }

    fn webhook_sender(&self) -> Option<tokio::sync::mpsc::Sender<IncomingMessage>> {
        Some(self.webhook_tx.clone())
    }

    async fn send_typing(&self, _external_chat_id: &str) -> Result<(), ChannelError> {
        // WhatsApp doesn't have a typing indicator API — no-op.
        Ok(())
    }

    async fn register_commands(&self, _commands: &[CommandDefinition]) -> Result<(), ChannelError> {
        // WhatsApp doesn't support slash command menus — no-op.
        Ok(())
    }

    fn format_content(&self, content: &MessageContent) -> String {
        // WhatsApp supports basic formatting: *bold*, _italic_, ~strikethrough~, ```code```
        match content {
            MessageContent::Text(s) => markdown_to_whatsapp(s),
            MessageContent::ToolInvocation { name, arguments } => match arguments {
                Some(args) => format!("⚙ *{name}*\n```{args}```"),
                None => format!("⚙ *{name}*"),
            },
            MessageContent::ToolResult { name, result } => match result {
                Some(r) => format!("✅ *{name}*\n```{r}```"),
                None => format!("✅ *{name}*"),
            },
            MessageContent::ToolError { name, error } => format!("❌ *{name}*\n```{error}```"),
            MessageContent::RunCompleted => "✅ *Run completed*".into(),
            MessageContent::RunStarted => "🔄 *Working...*".into(),
            MessageContent::RunFailed { error } => format!("❌ *Run failed*\n```{error}```"),
            MessageContent::SubagentSpawned { name, task } => match task {
                Some(t) => format!("🤖 *{name}* spawned\n   └ {t}"),
                None => format!("🤖 *{name}* spawned"),
            },
            MessageContent::SubagentCompleted { name } => format!("✅ *{name}* completed"),
            MessageContent::SubagentFailed { name, error } => {
                format!("❌ *{name}* failed\n```{error}```")
            }
        }
    }
}

/// Convert standard markdown to WhatsApp formatting.
/// WhatsApp uses: *bold*, _italic_, ~strikethrough~, ```code```
fn markdown_to_whatsapp(md: &str) -> String {
    let mut result = String::with_capacity(md.len());
    let lines: Vec<&str> = md.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        // Fenced code blocks: ```lang\n...\n``` → ```\n...\n```
        if line.starts_with("```") {
            result.push_str("```\n");
            i += 1;
            while i < lines.len() && !lines[i].starts_with("```") {
                result.push_str(lines[i]);
                result.push('\n');
                i += 1;
            }
            result.push_str("```");
            result.push('\n');
            if i < lines.len() {
                i += 1; // skip closing ```
            }
            continue;
        }

        // Headings: # ... → *bold*
        if let Some(heading) = line
            .strip_prefix("### ")
            .or_else(|| line.strip_prefix("## "))
            .or_else(|| line.strip_prefix("# "))
        {
            result.push('*');
            result.push_str(heading.trim());
            result.push('*');
            result.push('\n');
            i += 1;
            continue;
        }

        // Inline: convert **bold** to *bold*, ~~strike~~ to ~strike~
        let converted = convert_inline_whatsapp(line);
        result.push_str(&converted);
        result.push('\n');
        i += 1;
    }

    if result.ends_with('\n') {
        result.pop();
    }
    result
}

fn convert_inline_whatsapp(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let chars: Vec<char> = line.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Inline code: `code` → `code` (WhatsApp doesn't have single-backtick, but it works)
        if chars[i] == '`' {
            out.push('`');
            i += 1;
            continue;
        }

        // **bold** → *bold*
        if i + 1 < len && chars[i] == '*' && chars[i + 1] == '*' {
            out.push('*');
            i += 2;
            continue;
        }

        // ~~strike~~ → ~strike~
        if i + 1 < len && chars[i] == '~' && chars[i + 1] == '~' {
            out.push('~');
            i += 2;
            continue;
        }

        // [text](url) → text (url)
        if chars[i] == '['
            && let Some((text, url, end)) = parse_link(&chars, i)
        {
            out.push_str(&text);
            out.push_str(" (");
            out.push_str(&url);
            out.push(')');
            i = end;
            continue;
        }

        out.push(chars[i]);
        i += 1;
    }
    out
}

fn parse_link(chars: &[char], start: usize) -> Option<(String, String, usize)> {
    let text_end = (start + 1..chars.len()).find(|&j| chars[j] == ']')?;
    if text_end + 1 >= chars.len() || chars[text_end + 1] != '(' {
        return None;
    }
    let url_end = (text_end + 2..chars.len()).find(|&j| chars[j] == ')')?;
    let text: String = chars[start + 1..text_end].iter().collect();
    let url: String = chars[text_end + 2..url_end].iter().collect();
    Some((text, url, url_end + 1))
}

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

        let split_at = remaining[..max_len].rfind('\n').unwrap_or(max_len);

        let (chunk, rest) = remaining.split_at(split_at);
        chunks.push(chunk.to_string());
        remaining = rest.strip_prefix('\n').unwrap_or(rest);
    }

    chunks
}

/// Parse an incoming WhatsApp webhook payload into `IncomingMessage` items.
/// The Cloud API sends notifications in a specific nested format.
pub fn parse_webhook_payload(payload: &serde_json::Value) -> Vec<IncomingMessage> {
    let mut messages = Vec::new();

    let Some(entries) = payload.get("entry").and_then(|v| v.as_array()) else {
        return messages;
    };

    for entry in entries {
        let Some(changes) = entry.get("changes").and_then(|v| v.as_array()) else {
            continue;
        };

        for change in changes {
            let Some(value) = change.get("value") else {
                continue;
            };

            // Extract contact info for sender name lookup
            let contacts: Vec<WhatsAppContact> = value
                .get("contacts")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();

            let Some(msgs) = value.get("messages").and_then(|v| v.as_array()) else {
                continue;
            };

            for msg in msgs {
                let Some(wa_msg) = serde_json::from_value::<WhatsAppMessage>(msg.clone()).ok()
                else {
                    continue;
                };

                // Only handle text messages for now
                let text = match wa_msg.message_type.as_str() {
                    "text" => wa_msg
                        .text
                        .as_ref()
                        .map(|t| t.body.clone())
                        .unwrap_or_default(),
                    _ => continue,
                };

                if text.is_empty() {
                    continue;
                }

                let sender_name = contacts
                    .iter()
                    .find(|c| c.wa_id == wa_msg.from)
                    .and_then(|c| c.profile.as_ref())
                    .map(|p| p.name.clone())
                    .unwrap_or_else(|| wa_msg.from.clone());

                let timestamp = wa_msg
                    .timestamp
                    .parse::<i64>()
                    .unwrap_or_else(|_| chrono::Utc::now().timestamp());

                messages.push(IncomingMessage {
                    external_chat_id: wa_msg.from.clone(),
                    sender_id: wa_msg.from,
                    sender_name,
                    text,
                    timestamp,
                    audio: None,
                    attachments: Vec::new(),
                });
            }
        }
    }

    messages
}

#[derive(Debug, Deserialize)]
struct WhatsAppMessage {
    from: String,
    #[serde(default)]
    timestamp: String,
    #[serde(rename = "type")]
    message_type: String,
    text: Option<WhatsAppTextBody>,
}

#[derive(Debug, Deserialize)]
struct WhatsAppTextBody {
    body: String,
}

#[derive(Debug, Deserialize)]
struct WhatsAppContact {
    wa_id: String,
    profile: Option<WhatsAppProfile>,
}

#[derive(Debug, Deserialize)]
struct WhatsAppProfile {
    name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_name() {
        let transport = WhatsAppTransport::new("123".into(), "token".into());
        assert_eq!(transport.transport_name(), "whatsapp");
    }

    #[test]
    fn parse_webhook_text_message() {
        let payload = serde_json::json!({
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "BIZ_ACCOUNT_ID",
                "changes": [{
                    "value": {
                        "messaging_product": "whatsapp",
                        "metadata": {
                            "display_phone_number": "15551234567",
                            "phone_number_id": "PHONE_ID"
                        },
                        "contacts": [{
                            "profile": { "name": "Alice" },
                            "wa_id": "15559876543"
                        }],
                        "messages": [{
                            "from": "15559876543",
                            "id": "wamid.xxx",
                            "timestamp": "1700000000",
                            "text": { "body": "Hello bot!" },
                            "type": "text"
                        }]
                    },
                    "field": "messages"
                }]
            }]
        });

        let messages = parse_webhook_payload(&payload);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].text, "Hello bot!");
        assert_eq!(messages[0].sender_name, "Alice");
        assert_eq!(messages[0].external_chat_id, "15559876543");
        assert_eq!(messages[0].timestamp, 1700000000);
    }

    #[test]
    fn parse_webhook_ignores_non_text() {
        let payload = serde_json::json!({
            "object": "whatsapp_business_account",
            "entry": [{
                "changes": [{
                    "value": {
                        "contacts": [],
                        "messages": [{
                            "from": "15559876543",
                            "id": "wamid.xxx",
                            "timestamp": "1700000000",
                            "type": "image"
                        }]
                    }
                }]
            }]
        });

        let messages = parse_webhook_payload(&payload);
        assert!(messages.is_empty());
    }

    #[test]
    fn parse_webhook_empty_payload() {
        let payload = serde_json::json!({});
        assert!(parse_webhook_payload(&payload).is_empty());
    }

    #[test]
    fn markdown_to_whatsapp_bold() {
        assert_eq!(markdown_to_whatsapp("**hello**"), "*hello*");
    }

    #[test]
    fn markdown_to_whatsapp_heading() {
        assert_eq!(markdown_to_whatsapp("# Title"), "*Title*");
    }

    #[test]
    fn markdown_to_whatsapp_code_block() {
        let input = "```rust\nfn main() {}\n```";
        let expected = "```\nfn main() {}\n```";
        assert_eq!(markdown_to_whatsapp(input), expected);
    }

    #[test]
    fn markdown_to_whatsapp_strikethrough() {
        assert_eq!(markdown_to_whatsapp("~~deleted~~"), "~deleted~");
    }

    #[test]
    fn markdown_to_whatsapp_link() {
        assert_eq!(
            markdown_to_whatsapp("[click](https://example.com)"),
            "click (https://example.com)"
        );
    }

    #[test]
    fn format_content_run_started() {
        let transport = WhatsAppTransport::new("123".into(), "token".into());
        let result = transport.format_content(&MessageContent::RunStarted);
        assert_eq!(result, "🔄 *Working...*");
    }

    #[test]
    fn split_short_message() {
        let chunks = split_message("hello", 4096);
        assert_eq!(chunks, vec!["hello"]);
    }
}
