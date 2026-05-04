use async_trait::async_trait;
use moxxy_types::{ChannelError, MediaKind, MessageContent};
use serde::Deserialize;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

use crate::commands::CommandDefinition;
use crate::transport::{
    ChannelTransport, IncomingAttachment, IncomingAudio, IncomingMessage, OutgoingMessage,
};

/// Hard cap on voice/audio file size downloaded from Telegram. The bridge
/// enforces its own (configurable) cap on top of this, but we refuse to spool
/// anything larger than 25 MB into memory — matches Whisper's upload limit.
const TELEGRAM_AUDIO_MAX_BYTES: u64 = 25 * 1024 * 1024;
/// Hard cap for Telegram image downloads before MediaStore validation.
const TELEGRAM_IMAGE_MAX_BYTES: u64 = 25 * 1024 * 1024;
/// Hard cap for Telegram document downloads before MediaStore validation.
const TELEGRAM_DOCUMENT_MAX_BYTES: u64 = 25 * 1024 * 1024;
/// Telegram Bot API rejects text messages above 4096 characters.
const TELEGRAM_MAX_MESSAGE_CHARS: usize = 4096;
/// Keep chunks comfortably below Telegram's hard cap after markdown conversion.
const TELEGRAM_SAFE_MESSAGE_CHARS: usize = 3500;

#[derive(Debug, Clone, PartialEq, Eq)]
struct TelegramMessageChunk {
    text: String,
    parse_mode: Option<&'static str>,
    plain_fallback: String,
}

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

    /// Resolve a `file_id` to a downloadable file path via `getFile`.
    async fn get_file(&self, file_id: &str) -> Result<TelegramFile, ChannelError> {
        let resp = self
            .http_client
            .get(self.api_url("getFile"))
            .query(&[("file_id", file_id)])
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(format!("getFile: {e}")))?;

        let body: TelegramResponse<TelegramFile> = resp
            .json()
            .await
            .map_err(|e| ChannelError::TransportError(format!("getFile decode: {e}")))?;

        if !body.ok {
            return Err(ChannelError::TransportError(
                body.description.unwrap_or_else(|| "getFile failed".into()),
            ));
        }
        body.result
            .ok_or_else(|| ChannelError::TransportError("getFile: empty result".into()))
    }

    /// Download the raw bytes of a resolved Telegram file.
    async fn download_file(&self, file_path: &str) -> Result<Vec<u8>, ChannelError> {
        let url = format!(
            "https://api.telegram.org/file/bot{}/{}",
            self.bot_token, file_path
        );
        let resp = self
            .http_client
            .get(&url)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| ChannelError::TransportError(format!("downloadFile: {e}")))?;

        if !resp.status().is_success() {
            return Err(ChannelError::TransportError(format!(
                "downloadFile: HTTP {}",
                resp.status()
            )));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| ChannelError::TransportError(format!("downloadFile read: {e}")))?;
        Ok(bytes.to_vec())
    }

    /// Try to download an audio payload (voice note or audio file) from a
    /// Telegram message. Returns `None` if neither is present. Returns `Err`
    /// if the download fails or exceeds the size cap.
    async fn fetch_incoming_audio(
        &self,
        msg: &TelegramMessage,
    ) -> Result<Option<IncomingAudio>, ChannelError> {
        let (file_id, duration, mime, file_size, default_ext) = if let Some(v) = &msg.voice {
            (
                v.file_id.as_str(),
                v.duration,
                v.mime_type.clone().unwrap_or_else(|| "audio/ogg".into()),
                v.file_size,
                "ogg",
            )
        } else if let Some(a) = &msg.audio {
            (
                a.file_id.as_str(),
                a.duration,
                a.mime_type.clone().unwrap_or_else(|| "audio/mpeg".into()),
                a.file_size,
                "mp3",
            )
        } else {
            return Ok(None);
        };

        if let Some(size) = file_size
            && size > TELEGRAM_AUDIO_MAX_BYTES
        {
            return Err(ChannelError::TransportError(format!(
                "audio file too large: {} bytes",
                size
            )));
        }

        let file = self.get_file(file_id).await?;
        if let Some(size) = file.file_size
            && size > TELEGRAM_AUDIO_MAX_BYTES
        {
            return Err(ChannelError::TransportError(format!(
                "audio file too large: {} bytes",
                size
            )));
        }
        let Some(file_path) = file.file_path else {
            return Err(ChannelError::TransportError(
                "getFile returned no file_path".into(),
            ));
        };

        let data = self.download_file(&file_path).await?;

        let filename = std::path::Path::new(&file_path)
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("voice.{default_ext}"));

        Ok(Some(IncomingAudio {
            data,
            mime,
            filename,
            duration_secs: Some(duration),
        }))
    }

    async fn fetch_incoming_attachments(
        &self,
        msg: &TelegramMessage,
    ) -> Result<Vec<IncomingAttachment>, ChannelError> {
        let mut attachments = Vec::new();

        let Some(photos) = &msg.photo else {
            return self.fetch_incoming_document_attachment(msg).await;
        };

        if let Some(photo) = photos.iter().max_by_key(|photo| {
            photo
                .file_size
                .unwrap_or((photo.width as u64).saturating_mul(photo.height as u64))
        }) {
            if let Some(size) = photo.file_size
                && size > TELEGRAM_IMAGE_MAX_BYTES
            {
                return Err(ChannelError::TransportError(format!(
                    "image file too large: {} bytes",
                    size
                )));
            }

            let file = self.get_file(&photo.file_id).await?;
            if let Some(size) = file.file_size
                && size > TELEGRAM_IMAGE_MAX_BYTES
            {
                return Err(ChannelError::TransportError(format!(
                    "image file too large: {} bytes",
                    size
                )));
            }
            let Some(file_path) = file.file_path else {
                return Err(ChannelError::TransportError(
                    "getFile returned no file_path".into(),
                ));
            };

            let data = self.download_file(&file_path).await?;
            if data.len() as u64 > TELEGRAM_IMAGE_MAX_BYTES {
                return Err(ChannelError::TransportError(format!(
                    "image file too large: {} bytes",
                    data.len()
                )));
            }

            let filename = std::path::Path::new(&file_path)
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "telegram-photo.jpg".into());
            let mime = infer_image_mime_from_path(&file_path).unwrap_or("image/jpeg");

            attachments.push(IncomingAttachment {
                kind: MediaKind::Image,
                data,
                mime: mime.into(),
                filename,
                source: serde_json::json!({
                    "channel": "telegram",
                    "telegram_file_id": photo.file_id,
                    "telegram_file_unique_id": photo.file_unique_id,
                    "width": photo.width,
                    "height": photo.height,
                }),
            });
        }

        Ok(attachments)
    }

    async fn fetch_incoming_document_attachment(
        &self,
        msg: &TelegramMessage,
    ) -> Result<Vec<IncomingAttachment>, ChannelError> {
        let Some(document) = &msg.document else {
            return Ok(Vec::new());
        };

        if let Some(size) = document.file_size
            && size > TELEGRAM_DOCUMENT_MAX_BYTES
        {
            return Err(ChannelError::TransportError(format!(
                "document file too large: {} bytes",
                size
            )));
        }

        let file = self.get_file(&document.file_id).await?;
        if let Some(size) = file.file_size
            && size > TELEGRAM_DOCUMENT_MAX_BYTES
        {
            return Err(ChannelError::TransportError(format!(
                "document file too large: {} bytes",
                size
            )));
        }
        let Some(file_path) = file.file_path else {
            return Err(ChannelError::TransportError(
                "getFile returned no file_path".into(),
            ));
        };

        let data = self.download_file(&file_path).await?;
        if data.len() as u64 > TELEGRAM_DOCUMENT_MAX_BYTES {
            return Err(ChannelError::TransportError(format!(
                "document file too large: {} bytes",
                data.len()
            )));
        }

        let filename = document
            .file_name
            .clone()
            .or_else(|| {
                std::path::Path::new(&file_path)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "telegram-document".into());
        let mime = document
            .mime_type
            .clone()
            .or_else(|| infer_document_mime_from_path(&filename).map(str::to_string))
            .unwrap_or_else(|| "application/octet-stream".into());

        Ok(vec![IncomingAttachment {
            kind: MediaKind::Document,
            data,
            mime,
            filename,
            source: serde_json::json!({
                "channel": "telegram",
                "telegram_file_id": document.file_id,
                "telegram_file_unique_id": document.file_unique_id,
            }),
        }])
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

    fn message_chunks(&self, content: &MessageContent) -> Vec<TelegramMessageChunk> {
        match content {
            MessageContent::Text(text) => split_message(text, TELEGRAM_SAFE_MESSAGE_CHARS)
                .into_iter()
                .map(|chunk| {
                    let formatted = markdown_to_telegram_html(&chunk);
                    if telegram_char_len(&formatted) <= TELEGRAM_MAX_MESSAGE_CHARS {
                        TelegramMessageChunk {
                            text: formatted,
                            parse_mode: Some("HTML"),
                            plain_fallback: chunk,
                        }
                    } else {
                        TelegramMessageChunk {
                            text: chunk.clone(),
                            parse_mode: None,
                            plain_fallback: chunk,
                        }
                    }
                })
                .collect(),
            _ => {
                let text = self.format_content(content);
                let parse_mode = Some("MarkdownV2");
                if telegram_char_len(&text) <= TELEGRAM_MAX_MESSAGE_CHARS {
                    vec![TelegramMessageChunk {
                        text: text.clone(),
                        parse_mode,
                        plain_fallback: text,
                    }]
                } else {
                    split_message(&text, TELEGRAM_SAFE_MESSAGE_CHARS)
                        .into_iter()
                        .map(|chunk| TelegramMessageChunk {
                            text: chunk.clone(),
                            parse_mode: None,
                            plain_fallback: chunk,
                        })
                        .collect()
                }
            }
        }
    }

    async fn send_chunk(
        &self,
        chat_id: &str,
        chunk: &TelegramMessageChunk,
    ) -> Result<Option<i64>, ChannelError> {
        match self.send_text(chat_id, &chunk.text, chunk.parse_mode).await {
            Ok(id) => Ok(id),
            Err(e) if chunk.parse_mode.is_some() => {
                tracing::warn!(
                    chat_id,
                    error = %e,
                    "Formatted Telegram message chunk failed, retrying as plain text"
                );
                self.send_text(chat_id, &chunk.plain_fallback, None).await
            }
            Err(e) => Err(e),
        }
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

/// Convert standard markdown (as produced by LLMs) to Telegram HTML.
///
/// Supported conversions:
/// - `**bold**` / `__bold__` → `<b>bold</b>`
/// - `*italic*` / `_italic_` → `<i>italic</i>`
/// - `` `inline code` `` → `<code>inline code</code>`
/// - ```lang\ncode\n``` → `<pre>code</pre>`
/// - `~~strikethrough~~` → `<s>strikethrough</s>`
/// - `[text](url)` → `<a href="url">text</a>`
/// - `# heading` → `<b>heading</b>`
/// - HTML special chars (`<`, `>`, `&`) are escaped first.
fn markdown_to_telegram_html(md: &str) -> String {
    // First, escape HTML entities in the raw markdown
    let escaped = md
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");

    let mut result = String::with_capacity(escaped.len());
    let lines: Vec<&str> = escaped.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        // Fenced code blocks: ```lang\n...\n```
        if line.starts_with("```") {
            i += 1;
            let mut code_lines = Vec::new();
            while i < lines.len() && !lines[i].starts_with("```") {
                code_lines.push(lines[i]);
                i += 1;
            }
            if i < lines.len() {
                i += 1; // skip closing ```
            }
            result.push_str("<pre>");
            result.push_str(&code_lines.join("\n"));
            result.push_str("</pre>");
            result.push('\n');
            continue;
        }

        // Headings: # ... → bold
        if let Some(heading) = line
            .strip_prefix("### ")
            .or_else(|| line.strip_prefix("## "))
            .or_else(|| line.strip_prefix("# "))
        {
            result.push_str("<b>");
            result.push_str(heading.trim());
            result.push_str("</b>");
            result.push('\n');
            i += 1;
            continue;
        }

        // Regular line - apply inline formatting
        result.push_str(&convert_inline_markdown(line));
        result.push('\n');
        i += 1;
    }

    // Remove trailing newline
    if result.ends_with('\n') {
        result.pop();
    }
    result
}

fn telegram_char_len(text: &str) -> usize {
    text.chars().count()
}

fn split_message(text: &str, max_chars: usize) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    if telegram_char_len(text) <= max_chars {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        if telegram_char_len(remaining) <= max_chars {
            chunks.push(remaining.to_string());
            break;
        }

        let max_byte = byte_index_after_chars(remaining, max_chars);
        let split_at = best_split_index(&remaining[..max_byte]).unwrap_or(max_byte);
        let (chunk, rest) = remaining.split_at(split_at);
        let chunk = chunk.trim_end();
        if !chunk.is_empty() {
            chunks.push(chunk.to_string());
        }
        remaining = rest.trim_start_matches(|c: char| c.is_whitespace());
    }

    chunks
}

fn byte_index_after_chars(text: &str, max_chars: usize) -> usize {
    text.char_indices()
        .nth(max_chars)
        .map(|(idx, _)| idx)
        .unwrap_or(text.len())
}

fn best_split_index(text: &str) -> Option<usize> {
    for needle in ["\n\n", "\n", " "] {
        if let Some(idx) = text.rfind(needle)
            && idx > 0
        {
            return Some(idx);
        }
    }
    None
}

/// Convert inline markdown patterns within a single line.
fn convert_inline_markdown(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let chars: Vec<char> = line.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Inline code: `...`
        if chars[i] == '`'
            && let Some(end) = find_closing(&chars, i + 1, '`')
        {
            let inner: String = chars[i + 1..end].iter().collect();
            out.push_str("<code>");
            out.push_str(&inner);
            out.push_str("</code>");
            i = end + 1;
            continue;
        }

        // Links: [text](url)
        if chars[i] == '['
            && let Some((text, url, end)) = parse_markdown_link(&chars, i)
        {
            out.push_str(&format!("<a href=\"{url}\">{text}</a>"));
            i = end;
            continue;
        }

        // Strikethrough: ~~text~~
        if i + 1 < len
            && chars[i] == '~'
            && chars[i + 1] == '~'
            && let Some(end) = find_double_closing(&chars, i + 2, '~')
        {
            let inner: String = chars[i + 2..end].iter().collect();
            out.push_str("<s>");
            out.push_str(&inner);
            out.push_str("</s>");
            i = end + 2;
            continue;
        }

        // Bold: **text**
        if i + 1 < len
            && chars[i] == '*'
            && chars[i + 1] == '*'
            && let Some(end) = find_double_closing(&chars, i + 2, '*')
        {
            let inner: String = chars[i + 2..end].iter().collect();
            out.push_str("<b>");
            out.push_str(&convert_inline_markdown(&inner));
            out.push_str("</b>");
            i = end + 2;
            continue;
        }

        // Bold: __text__
        if i + 1 < len
            && chars[i] == '_'
            && chars[i + 1] == '_'
            && let Some(end) = find_double_closing(&chars, i + 2, '_')
        {
            let inner: String = chars[i + 2..end].iter().collect();
            out.push_str("<b>");
            out.push_str(&convert_inline_markdown(&inner));
            out.push_str("</b>");
            i = end + 2;
            continue;
        }

        // Italic: *text* (single asterisk, only if not **)
        if chars[i] == '*'
            && (i + 1 >= len || chars[i + 1] != '*')
            && let Some(end) = find_closing_not_double(&chars, i + 1, '*')
        {
            let inner: String = chars[i + 1..end].iter().collect();
            out.push_str("<i>");
            out.push_str(&convert_inline_markdown(&inner));
            out.push_str("</i>");
            i = end + 1;
            continue;
        }

        // Italic: _text_ (single underscore, only if not __)
        if chars[i] == '_'
            && (i + 1 >= len || chars[i + 1] != '_')
            && let Some(end) = find_closing_not_double(&chars, i + 1, '_')
        {
            let inner: String = chars[i + 1..end].iter().collect();
            out.push_str("<i>");
            out.push_str(&convert_inline_markdown(&inner));
            out.push_str("</i>");
            i = end + 1;
            continue;
        }

        out.push(chars[i]);
        i += 1;
    }
    out
}

fn find_closing(chars: &[char], start: usize, marker: char) -> Option<usize> {
    (start..chars.len()).find(|&j| chars[j] == marker)
}

fn find_double_closing(chars: &[char], start: usize, marker: char) -> Option<usize> {
    let mut j = start;
    while j + 1 < chars.len() {
        if chars[j] == marker && chars[j + 1] == marker {
            return Some(j);
        }
        j += 1;
    }
    None
}

fn find_closing_not_double(chars: &[char], start: usize, marker: char) -> Option<usize> {
    for j in start..chars.len() {
        if chars[j] == marker && (j + 1 >= chars.len() || chars[j + 1] != marker) {
            // Make sure there's actual content
            if j > start {
                return Some(j);
            }
        }
    }
    None
}

fn parse_markdown_link(chars: &[char], start: usize) -> Option<(String, String, usize)> {
    // [text](url)
    let text_end = find_closing(chars, start + 1, ']')?;
    if text_end + 1 >= chars.len() || chars[text_end + 1] != '(' {
        return None;
    }
    let url_end = find_closing(chars, text_end + 2, ')')?;
    let text: String = chars[start + 1..text_end].iter().collect();
    let url: String = chars[text_end + 2..url_end].iter().collect();
    Some((text, url, url_end + 1))
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
                                    let chat_id = msg.chat.id.to_string();
                                    let timestamp = msg.date;

                                    let audio = match self.fetch_incoming_audio(&msg).await {
                                        Ok(a) => a,
                                        Err(e) => {
                                            tracing::warn!(
                                                chat_id = %chat_id,
                                                error = %e,
                                                "Failed to fetch Telegram voice/audio payload"
                                            );
                                            None
                                        }
                                    };

                                    // If the message had audio but we failed to download it,
                                    // skip routing entirely — don't start a run with empty text.
                                    if (msg.voice.is_some() || msg.audio.is_some()) && audio.is_none() {
                                        continue;
                                    }

                                    let attachments = match self.fetch_incoming_attachments(&msg).await {
                                        Ok(a) => a,
                                        Err(e) => {
                                            tracing::warn!(
                                                chat_id = %chat_id,
                                                error = %e,
                                                "Failed to fetch Telegram photo payload"
                                            );
                                            Vec::new()
                                        }
                                    };

                                    // If the message had media but we failed to download it,
                                    // skip routing entirely — don't start a run that ignores the attachment.
                                    if (msg.photo.is_some() || msg.document.is_some()) && attachments.is_empty() {
                                        continue;
                                    }

                                    let text = msg.text.or(msg.caption).unwrap_or_default();
                                    // Ignore updates with neither text nor media (e.g. stickers).
                                    if text.is_empty() && audio.is_none() && attachments.is_empty() {
                                        continue;
                                    }

                                    let incoming = IncomingMessage {
                                        external_chat_id: chat_id,
                                        sender_id,
                                        sender_name,
                                        text,
                                        timestamp,
                                        audio,
                                        attachments,
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
        let chunks = self.message_chunks(&msg.content);
        if chunks.len() > 1 {
            tracing::info!(
                chat_id = %msg.external_chat_id,
                chunks = chunks.len(),
                "Splitting long Telegram message"
            );
        }
        for chunk in chunks {
            self.send_chunk(&msg.external_chat_id, &chunk).await?;
        }
        Ok(())
    }

    async fn send_message_returning_id(
        &self,
        msg: OutgoingMessage,
    ) -> Result<Option<String>, ChannelError> {
        let chunks = self.message_chunks(&msg.content);
        if chunks.len() > 1 {
            tracing::info!(
                chat_id = %msg.external_chat_id,
                chunks = chunks.len(),
                "Splitting long Telegram message"
            );
        }

        let mut first_msg_id = None;
        for chunk in chunks {
            let msg_id = self.send_chunk(&msg.external_chat_id, &chunk).await?;
            if first_msg_id.is_none() {
                first_msg_id = msg_id;
            }
        }

        Ok(first_msg_id.map(|id| id.to_string()))
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
            MessageContent::Text(s) => markdown_to_telegram_html(s),
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

fn infer_image_mime_from_path(path: &str) -> Option<&'static str> {
    match std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("png") => Some("image/png"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        _ => None,
    }
}

fn infer_document_mime_from_path(path: &str) -> Option<&'static str> {
    match std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("pdf") => Some("application/pdf"),
        Some("txt") => Some("text/plain"),
        Some("md") | Some("markdown") => Some("text/markdown"),
        Some("csv") => Some("text/csv"),
        Some("json") => Some("application/json"),
        Some("docx") => {
            Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        }
        Some("xlsx") => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        Some("pptx") => {
            Some("application/vnd.openxmlformats-officedocument.presentationml.presentation")
        }
        _ => None,
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
    caption: Option<String>,
    photo: Option<Vec<TelegramPhotoSize>>,
    document: Option<TelegramDocument>,
    voice: Option<TelegramVoice>,
    audio: Option<TelegramAudio>,
}

#[derive(Debug, Deserialize)]
struct TelegramVoice {
    file_id: String,
    #[serde(default)]
    duration: u32,
    #[serde(default)]
    mime_type: Option<String>,
    #[serde(default)]
    file_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TelegramAudio {
    file_id: String,
    #[serde(default)]
    duration: u32,
    #[serde(default)]
    mime_type: Option<String>,
    #[serde(default)]
    file_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TelegramPhotoSize {
    file_id: String,
    #[serde(default)]
    file_unique_id: Option<String>,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    file_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TelegramDocument {
    file_id: String,
    #[serde(default)]
    file_unique_id: Option<String>,
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    mime_type: Option<String>,
    #[serde(default)]
    file_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TelegramFile {
    #[allow(dead_code)]
    file_id: String,
    #[serde(default)]
    file_size: Option<u64>,
    file_path: Option<String>,
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
    fn parse_telegram_document_update() {
        let json = r#"{
            "ok": true,
            "result": [{
                "update_id": 123,
                "message": {
                    "message_id": 1,
                    "from": {"id": 456, "is_bot": false, "first_name": "Alice"},
                    "chat": {"id": 789, "type": "private"},
                    "date": 1700000000,
                    "caption": "Please analyze",
                    "document": {
                        "file_id": "file_123",
                        "file_unique_id": "unique_123",
                        "file_name": "brief.pdf",
                        "mime_type": "application/pdf",
                        "file_size": 1234
                    }
                }
            }]
        }"#;

        let resp: TelegramResponse<Vec<TelegramUpdate>> = serde_json::from_str(json).unwrap();
        let updates = resp.result.unwrap();
        let msg = updates[0].message.as_ref().unwrap();
        let doc = msg.document.as_ref().unwrap();
        assert_eq!(msg.caption.as_deref(), Some("Please analyze"));
        assert_eq!(doc.file_id, "file_123");
        assert_eq!(doc.file_name.as_deref(), Some("brief.pdf"));
        assert_eq!(doc.mime_type.as_deref(), Some("application/pdf"));
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

    #[test]
    fn telegram_text_chunks_short_message_as_one_chunk() {
        let transport = TelegramTransport::new("123:ABC".into());

        let chunks = transport.message_chunks(&moxxy_types::MessageContent::Text("hello".into()));

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "hello");
        assert_eq!(chunks[0].parse_mode, Some("HTML"));
    }

    #[test]
    fn telegram_text_chunks_long_message_under_limit() {
        let transport = TelegramTransport::new("123:ABC".into());
        let text = "a".repeat(TELEGRAM_SAFE_MESSAGE_CHARS + 250);

        let chunks = transport.message_chunks(&moxxy_types::MessageContent::Text(text));

        assert!(chunks.len() >= 2);
        for chunk in chunks {
            assert!(
                telegram_char_len(&chunk.text) <= TELEGRAM_MAX_MESSAGE_CHARS,
                "chunk too long: {}",
                telegram_char_len(&chunk.text)
            );
        }
    }

    #[test]
    fn split_message_handles_unicode_boundaries() {
        let text = "ą🙂".repeat(TELEGRAM_SAFE_MESSAGE_CHARS / 2 + 5);

        let chunks = split_message(&text, TELEGRAM_SAFE_MESSAGE_CHARS);

        assert!(chunks.len() >= 2);
        assert_eq!(chunks.concat(), text);
        for chunk in chunks {
            assert!(telegram_char_len(&chunk) <= TELEGRAM_SAFE_MESSAGE_CHARS);
        }
    }

    #[test]
    fn markdown_to_html_bold() {
        assert_eq!(markdown_to_telegram_html("**hello**"), "<b>hello</b>");
        assert_eq!(markdown_to_telegram_html("__hello__"), "<b>hello</b>");
    }

    #[test]
    fn markdown_to_html_italic() {
        assert_eq!(markdown_to_telegram_html("*hello*"), "<i>hello</i>");
        assert_eq!(markdown_to_telegram_html("_hello_"), "<i>hello</i>");
    }

    #[test]
    fn markdown_to_html_inline_code() {
        assert_eq!(markdown_to_telegram_html("`code`"), "<code>code</code>");
    }

    #[test]
    fn markdown_to_html_code_block() {
        let input = "```rust\nfn main() {}\n```";
        assert_eq!(markdown_to_telegram_html(input), "<pre>fn main() {}</pre>");
    }

    #[test]
    fn markdown_to_html_heading() {
        assert_eq!(markdown_to_telegram_html("# Title"), "<b>Title</b>");
        assert_eq!(markdown_to_telegram_html("## Subtitle"), "<b>Subtitle</b>");
        assert_eq!(markdown_to_telegram_html("### Section"), "<b>Section</b>");
    }

    #[test]
    fn markdown_to_html_link() {
        assert_eq!(
            markdown_to_telegram_html("[click](https://example.com)"),
            "<a href=\"https://example.com\">click</a>"
        );
    }

    #[test]
    fn markdown_to_html_strikethrough() {
        assert_eq!(markdown_to_telegram_html("~~deleted~~"), "<s>deleted</s>");
    }

    #[test]
    fn markdown_to_html_escapes_html_entities() {
        assert_eq!(
            markdown_to_telegram_html("a < b & c > d"),
            "a &lt; b &amp; c &gt; d"
        );
    }

    #[test]
    fn markdown_to_html_mixed_content() {
        let input = "Here is **bold** and *italic* with `code`";
        let expected = "Here is <b>bold</b> and <i>italic</i> with <code>code</code>";
        assert_eq!(markdown_to_telegram_html(input), expected);
    }

    #[test]
    fn markdown_to_html_plain_text_unchanged() {
        assert_eq!(markdown_to_telegram_html("Hello, world!"), "Hello, world!");
    }

    #[test]
    fn markdown_to_html_bold_then_italic() {
        // LLMs typically produce separate markers, not nested
        assert_eq!(
            markdown_to_telegram_html("**bold** and *italic*"),
            "<b>bold</b> and <i>italic</i>"
        );
    }
}
